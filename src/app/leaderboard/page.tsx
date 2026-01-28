"use client";

import * as React from "react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";

type TotalRow = {
  participantId: string;
  name: string;
  total: number;
};

type StreakRow = {
  participantId: string;
  name: string;
  bestStreak: number;
  currentStreak: number;
};

const ranges = [
  { label: "30 hari terakhir", value: "30d" },
  { label: "3 bulan terakhir", value: "90d" },
  { label: "Semua", value: "all" },
];

export default function LeaderboardPage() {
  const [range, setRange] = React.useState("all");
  const [total, setTotal] = React.useState<TotalRow[]>([]);
  const [streak, setStreak] = React.useState<StreakRow[]>([]);
  const [loadingTotal, setLoadingTotal] = React.useState(false);
  const [loadingStreak, setLoadingStreak] = React.useState(false);

  const fetchTotal = React.useCallback(async () => {
    setLoadingTotal(true);
    try {
      const res = await fetch(`/api/leaderboard/total?range=${range}`);
      const data = await res.json();
      setTotal(data.data ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingTotal(false);
    }
  }, [range]);

  const fetchStreak = React.useCallback(async () => {
    setLoadingStreak(true);
    try {
      const res = await fetch("/api/leaderboard/streak");
      const data = await res.json();
      setStreak(data.data ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingStreak(false);
    }
  }, []);

  React.useEffect(() => {
    fetchTotal();
  }, [fetchTotal]);

  React.useEffect(() => {
    fetchStreak();
  }, [fetchStreak]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-6 pb-16 pt-10">
        <section className="glass rounded-[calc(var(--radius)+6px)] p-6 shadow-lg">
          <h2 className="font-[var(--font-display)] text-2xl text-[hsl(var(--foreground))]">
            Leaderboard Paling Rajin
          </h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Rekap kehadiran dan streak kajian Ahad pagi.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            {ranges.map((item) => (
              <Button
                key={item.value}
                variant={range === item.value ? "default" : "outline"}
                size="sm"
                onClick={() => setRange(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-[calc(var(--radius)+6px)] border border-[hsl(var(--border))] bg-white/70 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-[var(--font-display)] text-xl text-[hsl(var(--foreground))]">
                Top Total Hadir
              </h3>
              <Button variant="ghost" size="sm" onClick={fetchTotal} disabled={loadingTotal}>
                Refresh
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {total.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {loadingTotal ? "Memuat..." : "Belum ada data."}
                </p>
              ) : (
                total.map((row, index) => (
                  <div
                    key={row.participantId}
                    className="flex items-center justify-between rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">
                        #{index + 1}
                      </p>
                      <p className="font-semibold">{row.name}</p>
                    </div>
                    <span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1 text-xs font-semibold text-[hsl(var(--foreground))]">
                      {row.total} hadir
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-[calc(var(--radius)+6px)] border border-[hsl(var(--border))] bg-white/70 p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-[var(--font-display)] text-xl text-[hsl(var(--foreground))]">
                Top Best Streak
              </h3>
              <Button variant="ghost" size="sm" onClick={fetchStreak} disabled={loadingStreak}>
                Refresh
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {streak.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {loadingStreak ? "Memuat..." : "Belum ada data."}
                </p>
              ) : (
                streak.map((row, index) => (
                  <div
                    key={row.participantId}
                    className="flex items-center justify-between rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">
                        #{index + 1}
                      </p>
                      <p className="font-semibold">{row.name}</p>
                    </div>
                    <div className="text-right text-xs text-[hsl(var(--muted-foreground))]">
                      <div>Best: {row.bestStreak}</div>
                      <div>Current: {row.currentStreak}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
