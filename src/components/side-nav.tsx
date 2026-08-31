"use client";

import {
  Bell,
  Crosshair,
  FolderKanban,
  Gauge,
  Settings,
  ShoppingBag,
  Store,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Command center", icon: Gauge },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/retailers", label: "Retailers", icon: Store },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/purchases", label: "Purchases", icon: ShoppingBag },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <Link className="brand" href="/">
        <span className="brand-mark">
          <Crosshair size={22} strokeWidth={2.4} />
        </span>
        <span>
          <strong>DealHunter</strong>
          <small>Signal before noise</small>
        </span>
      </Link>

      <nav className="nav-list" aria-label="Primary navigation">
        {links.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={active ? "nav-link nav-link-active" : "nav-link"}
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <span className="pulse-dot" />
        <div>
          <strong>Live monitoring</strong>
          <small>Mock URLs remain safely simulated</small>
        </div>
      </div>
    </aside>
  );
}
