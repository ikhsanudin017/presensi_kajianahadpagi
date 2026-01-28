import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="header-plain border-b border-[hsl(var(--border))]">
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.24em] text-[hsl(var(--muted-foreground))]">
            Kajian Ahad Pagi
          </p>
          <h1 className="font-[var(--font-display)] text-3xl font-semibold text-[hsl(var(--foreground))] md:text-4xl">
            Masjid Al Irsyad
          </h1>
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
