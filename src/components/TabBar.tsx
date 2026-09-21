"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Blossom } from "./Blossom";

const TABS = [
  { href: "/", label: "Hôm nay", icon: "☀️" },
  { href: "/du-an", label: "Dự án", icon: "🎯" },
  { href: "/giao-viec", label: "", icon: "" }, // bông mai
  { href: "/lich", label: "Lịch", icon: "🗓️" },
  { href: "/hop-duyet", label: "Duyệt", icon: "📥" },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav className="tabbar" aria-label="Điều hướng chính">
      {TABS.map((t) =>
        t.href === "/giao-viec" ? (
          <Link key={t.href} href={t.href} aria-label="Giao việc — chạm để gõ, giữ để nói">
            <span className="blossom-btn">
              <Blossom size={40} />
            </span>
          </Link>
        ) : (
          <Link key={t.href} href={t.href} className={path === t.href ? "on" : ""}>
            <span aria-hidden="true" style={{ display: "block", fontSize: 17 }}>
              {t.icon}
            </span>
            {t.label}
          </Link>
        ),
      )}
    </nav>
  );
}
