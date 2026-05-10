"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ClipboardCheck, Settings2, Trophy, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { IslamicBackground } from "@/components/site/IslamicBackground";

const navItems = [
  { href: "/", label: "Presensi", icon: ClipboardCheck },
  { href: "/leaderboard", label: "Ranking", icon: Trophy },
  { href: "/admin", label: "Admin", icon: Settings2 },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="site-page">
      <IslamicBackground />

      <div className="relative z-10 pb-10 pt-3 sm:pb-14 sm:pt-5 md:pt-7">
        <header className="site-container">
          <div className="site-main-card relative overflow-hidden px-4 py-4 sm:px-5 sm:py-5 md:px-7 md:py-7">
            <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--accent))/0.6] to-transparent" />
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 space-y-3">
                <p className="site-eyebrow">Kajian Ahad Pagi</p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="site-title text-3xl leading-tight text-[hsl(var(--foreground))] sm:text-4xl lg:text-5xl">
                    Masjid Al Irsyad
                  </h1>
                  <span className="site-badge gap-1.5">
                    <MapPin size={14} />
                    Sawit
                  </span>
                </div>
                <p className="max-w-2xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))] md:text-[0.95rem]">
                  Presensi, rekap kehadiran, dan pengelolaan data jamaah dalam tampilan yang ringan dipakai di HP.
                </p>
              </div>

              <nav className="site-nav w-full lg:w-auto" aria-label="Navigasi halaman">
                {navItems.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn("site-nav-link", active && "site-nav-link-active")}
                    >
                      <Icon size={16} aria-hidden />
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </header>

        <main className="site-container pt-5 sm:pt-7 md:pt-8">{children}</main>
      </div>
    </div>
  );
}
