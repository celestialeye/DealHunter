import type { Metadata } from "next";
import { Activity, ShieldCheck } from "lucide-react";

import { SideNav } from "@/components/side-nav";

import "./globals.css";

export const metadata: Metadata = {
  title: "DealHunter",
  description: "Monitor products, qualify deals, and safely prepare purchases.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="app-frame">
          <SideNav />
          <div className="main-frame">
            <header className="topbar">
              <div className="topbar-title">
                <Activity size={17} />
                <span>Monitoring control plane</span>
              </div>
              <div className="topbar-meta">
                <span className="topbar-chip">
                  <span className="pulse-dot" />
                  60-second targets
                </span>
                <span className="topbar-chip">
                  <ShieldCheck size={15} />
                  Checkout guarded
                </span>
              </div>
            </header>
            <main className="content">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
