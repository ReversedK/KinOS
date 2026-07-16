#!/usr/bin/env python3
"""
Harness TUI bridge (ADR-008 §6) — a websocket <-> PTY relay inside the Hermes
container, so the operator console can attach a real terminal to an agent's
governed profile.

WHAT THIS IS NOT: it is not an authorization point. ADR-008 §5 is explicit that
the Harness is never the governance boundary, so this process decides nothing.
It cannot: the only thing it accepts from the network is an opaque ticket, which
it hands straight back to KinOS to redeem. KinOS answers with an AGENT ID — never
a path — and the bridge maps that id to the profile directory itself. A caller
therefore cannot name a directory, and a compromised bridge cannot widen its own
access: it still reaches capabilities only through the agent's Sphere-MCP token,
policy-checked per call.

Why in-container rather than `docker exec` from the API: exec would require the
docker socket in the API container, which is the one component that IS the
authorization boundary — a compromise there would become host root. Hermes ships
`websockets` and a PTY is a local concern, so the bridge lives where the terminal
does and KinOS keeps no host privilege at all.

The spawned session runs `hermes chat --tui` with HERMES_HOME pointed at the
agent's profile. A Hermes profile IS a HERMES_HOME (hermes_cli/profiles.py: "Each
profile is a fully independent HERMES_HOME directory"); there is no --profile
flag. That profile is the one KinOS wrote via runtime.config.project, so the
session runs on the governed model and the governed tool surface.

Env:
  TUI_BRIDGE_PORT    (default 8788)   websocket listen port
  TUI_BRIDGE_HOST    (default 0.0.0.0)
  KINOS_API_URL      (default http://api:8787)  where tickets are redeemed
  HERMES_HOME        (default /opt/data)        profiles live under <home>/profiles
"""
import asyncio
import fcntl
import json
import os
import pty
import re
import signal
import struct
import termios
import urllib.error
import urllib.parse
import urllib.request

import websockets

PORT = int(os.environ.get("TUI_BRIDGE_PORT", "8788"))
HOST = os.environ.get("TUI_BRIDGE_HOST", "0.0.0.0")
API_URL = os.environ.get("KINOS_API_URL", "http://api:8787").rstrip("/")
HERMES_HOME = os.environ.get("HERMES_HOME", "/opt/data")

# Hermes' own profile id rule (hermes_cli/profiles.py::validate_profile_name).
# Re-checked here so a redeemed id can never escape the profiles root, even if
# KinOS were to return something unexpected: defence in depth, not the boundary.
PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def redeem(ticket: str) -> dict | None:
    """Exchange a ticket for the agent it authorizes. None on any refusal."""
    body = json.dumps({"ticket": ticket}).encode()
    req = urllib.request.Request(
        f"{API_URL}/tui/redeem",
        data=body,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError:
        # 403 = unknown/expired/replayed. Deny by default; never guess a profile.
        return None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def profile_home(agent_id: str) -> str | None:
    """Map an agent id to its profile HERMES_HOME, or None if it is not ours."""
    canon = agent_id.strip().lower()
    if not PROFILE_ID_RE.match(canon):
        return None
    path = os.path.join(HERMES_HOME, "profiles", canon)
    # The profile must already exist: KinOS writes it via runtime.config.project.
    # Refusing to create one here is what keeps "governed profile" true — the
    # bridge can only ever open a profile KinOS itself projected.
    return path if os.path.isdir(path) else None


def set_winsize(fd: int, rows: int, cols: int) -> None:
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


async def attach(ws):
    query = getattr(ws, "request", None)
    raw = query.path if query is not None else ws.path
    ticket = ""
    if "?" in raw:
        for part in raw.split("?", 1)[1].split("&"):
            if part.startswith("ticket="):
                ticket = urllib.parse.unquote(part[len("ticket="):])
    if not ticket:
        await ws.close(code=1008, reason="a ticket is required")
        return

    redeemed = await asyncio.to_thread(redeem, ticket)
    if redeemed is None:
        await ws.close(code=1008, reason="invalid or expired ticket")
        return

    agent_id = str(redeemed.get("agentId", ""))
    home = profile_home(agent_id)
    if home is None:
        await ws.send(
            f"\r\n\x1b[31mNo governed profile for {agent_id}.\x1b[0m\r\n"
            "Project the agent's runtime config in KinOS first, then reattach.\r\n"
        )
        await ws.close(code=1011, reason="no governed profile")
        return

    pid, fd = pty.fork()
    if pid == 0:  # child
        env = {
            **os.environ,
            "HERMES_HOME": home,  # a profile IS a HERMES_HOME
            "TERM": "xterm-256color",
        }
        # Never inherit the bridge's own knobs into the session.
        for leak in ("TUI_BRIDGE_PORT", "TUI_BRIDGE_HOST", "KINOS_API_URL"):
            env.pop(leak, None)
        os.execvpe("hermes", ["hermes", "chat", "--tui"], env)
        os._exit(1)  # unreachable unless exec fails

    set_winsize(fd, 24, 80)
    loop = asyncio.get_running_loop()
    reader = asyncio.Queue()

    def on_readable() -> None:
        try:
            data = os.read(fd, 65536)
        except OSError:
            data = b""
        reader.put_nowait(data)

    loop.add_reader(fd, on_readable)

    async def pty_to_ws() -> None:
        while True:
            data = await reader.get()
            if not data:
                return
            await ws.send(data.decode("utf-8", "replace"))

    async def ws_to_pty() -> None:
        async for message in ws:
            # Control frames (resize) are JSON; everything else is keystrokes.
            if isinstance(message, str) and message.startswith("\x00resize:"):
                try:
                    rows, cols = (int(n) for n in message[len("\x00resize:"):].split(","))
                    set_winsize(fd, rows, cols)
                except (ValueError, OSError):
                    pass
                continue
            os.write(fd, message.encode() if isinstance(message, str) else message)

    try:
        done, pending = await asyncio.wait(
            [asyncio.create_task(pty_to_ws()), asyncio.create_task(ws_to_pty())],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        loop.remove_reader(fd)
        try:
            os.close(fd)
        except OSError:
            pass
        # The session dies with the socket: no detached agent process survives an
        # operator closing the tab.
        try:
            os.kill(pid, signal.SIGHUP)
            await asyncio.to_thread(os.waitpid, pid, 0)
        except (ProcessLookupError, ChildProcessError):
            pass


async def main() -> None:
    async with websockets.serve(attach, HOST, PORT, ping_interval=20):
        print(f"[tui-bridge] listening on {HOST}:{PORT}, profiles under {HERMES_HOME}/profiles", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
