import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="header-plain border-b border-[hsl(var(--border))]">
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-[hsl(var(--muted-foreground))]">
            <span className="inline-block h-1 w-10 rounded-full bg-[hsl(var(--primary))]" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.26em]">
              Kajian Ahad Pagi
            </p>
          </div>
          <div className="flex items-baseline gap-3">
            <h1 className="font-[var(--font-display)] text-3xl font-semibold leading-tight text-[hsl(var(--foreground))] md:text-4xl">
              Masjid Al Irsyad
            </h1>
            <span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1 text-[11px] font-semibold text-[hsl(var(--muted-foreground))]">
              Sawit
            </span>
          </div>
        </div>
        <nav className="flex items-center gap-2 text-sm font-semibold">
          <Link className="nav-pill rounded-full px-3 py-2 hover:bg-[hsl(var(--muted))]" href="/">
            Presensi
          </Link>
          <Link className="nav-pill rounded-full px-3 py-2 hover:bg-[hsl(var(--muted))]" href="/leaderboard">
            Leaderboard
          </Link>
          <Link className="nav-pill rounded-full px-3 py-2 hover:bg-[hsl(var(--muted))]" href="/admin">
            Admin
          </Link>
        </nav>
      </div>
    </header>
  );
}
