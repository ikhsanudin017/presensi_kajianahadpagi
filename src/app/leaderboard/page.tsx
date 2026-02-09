"use client";

import * as React from "react";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { safeJson } from "@/lib/http";

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

type AbsentRow = {
  participantId: string;
  name: string;
  attended: number;
  absent: number;
};

type AbsentMeta = {
  sessions: number;
  sessionDates: string[];
};
const ranges = [
  { label: "30 hari terakhir", value: "30d", weeks: 4 },
  { label: "3 bulan terakhir", value: "90d", weeks: 12 },
  { label: "Semua", value: "all", weeks: 24 },
];

export default function LeaderboardPage() {
  const [range, setRange] = React.useState("all");
  const [total, setTotal] = React.useState<TotalRow[]>([]);
  const [streak, setStreak] = React.useState<StreakRow[]>([]);
  const [absent, setAbsent] = React.useState<AbsentRow[]>([]);
  const [absentMeta, setAbsentMeta] = React.useState<AbsentMeta | null>(null);
  const [loadingTotal, setLoadingTotal] = React.useState(false);
  const [loadingStreak, setLoadingStreak] = React.useState(false);
  const [loadingAbsent, setLoadingAbsent] = React.useState(false);
  const motivasiList = [
    "“Langkah kecil menuju majelis ilmu adalah jejak besar menuju ridha Allah.”",
    "“Hati yang diisi ilmu lebih tenang menghadapi lelahnya pekan.”",
    "“Setiap Ahad adalah kesempatan baru untuk memperbaiki diri.”",
    "“Datanglah, walau sebentar; Allah melihat kesungguhan hamba-Nya.”"
  ];

  const fetchTotal = React.useCallback(async () => {
    setLoadingTotal(true);
    try {
      const res = await fetch(`/api/leaderboard/total?range=all`);
      if (!res.ok) throw new Error(await res.text());
      const data = await safeJson<{ data?: TotalRow[] }>(res);
      setTotal(data?.data ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingTotal(false);
    }
  }, []);

  const fetchStreak = React.useCallback(async () => {
    setLoadingStreak(true);
    try {
      const res = await fetch("/api/leaderboard/streak");
      if (!res.ok) throw new Error(await res.text());
      const data = await safeJson<{ data?: StreakRow[] }>(res);
      setStreak(data?.data ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingStreak(false);
    }
  }, []);

  const fetchAbsent = React.useCallback(async () => {
    setLoadingAbsent(true);
    try {
      const weeks = ranges.find((r) => r.value === range)?.weeks ?? 4;
      const res = await fetch(`/api/leaderboard/absent?weeks=${weeks}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await safeJson<{ data?: AbsentRow[]; range?: AbsentMeta }>(res);
      setAbsent(data?.data ?? []);
      setAbsentMeta(
        data?.range
          ? {
              sessions: data.range?.sessions ?? 0,
              sessionDates: data.range?.sessionDates ?? [],
            }
          : null,
      );
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingAbsent(false);
    }
  }, [range]);

  React.useEffect(() => {
    fetchTotal();
  }, [fetchTotal]);

  React.useEffect(() => {
    fetchStreak();
  }, [fetchStreak]);

  React.useEffect(() => {
    fetchAbsent();
  }, [fetchAbsent]);

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

        <section className="mt-8 rounded-[calc(var(--radius)+6px)] border border-[hsl(var(--border))] bg-white/70 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-[var(--font-display)] text-xl text-[hsl(var(--foreground))]">
                Perlu Semangat Lagi
              </h3>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Peserta yang tercatat tidak hadir pada sesi kajian yang benar-benar berlangsung di rentang ini.
              </p>
            </div>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              Rentang: {ranges.find((r) => r.value === range)?.label}
              {absentMeta ? ` · ${absentMeta.sessions} sesi` : null}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {absent.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {loadingAbsent
                  ? "Memuat..."
                  : absentMeta && absentMeta.sessions === 0
                    ? "Belum ada sesi kajian pada rentang ini."
                    : "Belum ada data absen pada rentang ini."}
              </p>
            ) : (
              absent.map((row, idx) => (
                <div
                  key={row.participantId}
                  className="flex items-center justify-between rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
                      #{idx + 1} paling jarang hadir
                    </p>
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      Hadir {row.attended}x · Tidak hadir {row.absent}x (sesi kajian)
                    </p>
                  </div>
                  <div className="text-right text-xs text-[hsl(var(--muted-foreground))]">
                    <div className="rounded-full bg-[hsl(var(--accent))/0.15] px-3 py-1 text-[11px] font-semibold text-[hsl(var(--accent-foreground))]">
                      {motivasiList[idx % motivasiList.length]}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

      </main>
    </>
  );
}

