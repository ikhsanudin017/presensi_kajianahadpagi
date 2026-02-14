"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IslamicBackground } from "@/components/site/IslamicBackground";

const navItems = [
  { href: "/", label: "Presensi" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/admin", label: "Admin" },
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

      <div className="relative z-10 pb-12 pt-3 sm:pb-16 sm:pt-4 md:pt-8">
        <header className="site-container">
          <div className="site-main-card relative overflow-hidden px-4 py-4 sm:px-5 sm:py-6 md:px-8 md:py-8">
            <div className="absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--accent))/0.65] to-transparent" />
            <div className="absolute inset-x-12 bottom-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--primary))/0.48] to-transparent" />
            <div className="flex flex-col gap-5 sm:gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2.5 sm:space-y-3">
                <p className="site-eyebrow">KAJIAN AHAD PAGI</p>
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                  <h1 className="site-title text-[clamp(1.75rem,7vw,3.15rem)] leading-tight text-[hsl(var(--foreground))]">
                    Masjid Al Irsyad
                  </h1>
                  <span className="site-badge">Sawit</span>
                </div>
                <p className="max-w-xl text-sm leading-relaxed text-[hsl(var(--muted-foreground))] md:text-[0.95rem]">
                  Presensi jamaah kajian dengan nuansa islami yang hangat, bersih, dan mudah digunakan.
                </p>
              </div>

              <nav className="site-nav w-full sm:w-auto" aria-label="Navigasi halaman">
                {navItems.map((item) => {
                  const active = isActivePath(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn("site-nav-link", active && "site-nav-link-active")}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        </header>

        <main className="site-container pt-6 sm:pt-8 md:pt-10">{children}</main>
      </div>
    </div>
  );
}
