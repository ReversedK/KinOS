import type { ReactNode } from "react";

import "./globals.css";
import { TopNav } from "../components/TopNav";

export const metadata = {
  title: "KinOS — operator console",
  description: "Local-first trust infrastructure for personal and collective AI agents inside human Spheres.",
};

export const viewport = { themeColor: "#0e7a5c" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopNav />
        <main>{children}</main>
      </body>
    </html>
  );
}
