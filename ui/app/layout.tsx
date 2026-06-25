import type { ReactNode } from "react";

export const metadata = {
  title: "KinOS",
  description: "Local-first trust infrastructure for personal and collective AI agents.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "2rem",
          background: "#0b0c10",
          color: "#e8eaed",
        }}
      >
        <header style={{ marginBottom: "2rem" }}>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>KinOS</h1>
          <p style={{ margin: "0.25rem 0 0", color: "#9aa0a6" }}>Spheres of trust</p>
        </header>
        {children}
      </body>
    </html>
  );
}
