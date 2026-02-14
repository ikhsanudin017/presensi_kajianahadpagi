"use client";

import * as React from "react";
import { PageShell } from "@/components/layout/PageShell";
import { SiteShell } from "@/components/site/SiteShell";
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
    "“Datanglah, walau sebentar; Allah melihat kesungguhan hamba-Nya.”",
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
    <SiteShell>
      <PageShell
        eyebrow="Ringkasan Kehadiran"
        title="Leaderboard Paling Rajin"
        description="Rekap kehadiran dan streak kajian Ahad pagi."
        actions={
          <div className="flex flex-wrap gap-2 md:justify-end">
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
        }
      >
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Menampilkan data yang sudah tervalidasi dari presensi peserta.
        </p>
      </PageShell>

      <section className="mt-7 grid gap-6 lg:grid-cols-2">
        <div className="site-soft-card p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">Top Total Hadir</h3>
            <Button variant="ghost" size="sm" onClick={fetchTotal} disabled={loadingTotal}>
              Refresh
            </Button>
          </div>

          <div className="mt-4 md:hidden space-y-3">
            {total.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{loadingTotal ? "Memuat..." : "Belum ada data."}</p>
            ) : (
              total.map((row, index) => (
                <div key={row.participantId} className="site-card-list-row flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="site-label">#{index + 1}</p>
                    <p className="truncate font-semibold text-[hsl(var(--foreground))]">{row.name}</p>
                  </div>
                  <span className="site-chip">{row.total} hadir</span>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 hidden md:block overflow-x-auto">
            <table className="w-full min-w-[360px] text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] text-left text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                  <th className="py-2 pr-2">Rank</th>
                  <th className="py-2 pr-2">Nama</th>
                  <th className="py-2 text-right">Total Hadir</th>
                </tr>
              </thead>
              <tbody>
                {total.map((row, index) => (
                  <tr key={row.participantId} className="border-b border-[hsl(var(--border))/0.7] last:border-b-0">
                    <td className="py-3 pr-2 font-semibold">#{index + 1}</td>
                    <td className="py-3 pr-2">{row.name}</td>
                    <td className="py-3 text-right font-semibold">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {total.length === 0 ? (
              <p className="py-4 text-sm text-[hsl(var(--muted-foreground))]">{loadingTotal ? "Memuat..." : "Belum ada data."}</p>
            ) : null}
          </div>
        </div>

        <div className="site-soft-card p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">Top Best Streak</h3>
            <Button variant="ghost" size="sm" onClick={fetchStreak} disabled={loadingStreak}>
              Refresh
            </Button>
          </div>

          <div className="mt-4 md:hidden space-y-3">
            {streak.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{loadingStreak ? "Memuat..." : "Belum ada data."}</p>
            ) : (
              streak.map((row, index) => (
                <div key={row.participantId} className="site-card-list-row px-4 py-3">
                  <p className="site-label">#{index + 1}</p>
                  <p className="font-semibold text-[hsl(var(--foreground))]">{row.name}</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">Best: {row.bestStreak} · Current: {row.currentStreak}</p>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 hidden md:block overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] text-left text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                  <th className="py-2 pr-2">Rank</th>
                  <th className="py-2 pr-2">Nama</th>
                  <th className="py-2 pr-2 text-right">Best</th>
                  <th className="py-2 text-right">Current</th>
                </tr>
              </thead>
              <tbody>
                {streak.map((row, index) => (
                  <tr key={row.participantId} className="border-b border-[hsl(var(--border))/0.7] last:border-b-0">
                    <td className="py-3 pr-2 font-semibold">#{index + 1}</td>
                    <td className="py-3 pr-2">{row.name}</td>
                    <td className="py-3 pr-2 text-right font-semibold">{row.bestStreak}</td>
                    <td className="py-3 text-right font-semibold">{row.currentStreak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {streak.length === 0 ? (
              <p className="py-4 text-sm text-[hsl(var(--muted-foreground))]">{loadingStreak ? "Memuat..." : "Belum ada data."}</p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="site-soft-card mt-7 p-4 sm:p-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">Perlu Semangat Lagi</h3>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Peserta yang tercatat tidak hadir pada sesi kajian yang benar-benar berlangsung di rentang ini.
            </p>
          </div>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            Rentang: {ranges.find((r) => r.value === range)?.label}
            {absentMeta ? ` · ${absentMeta.sessions} sesi` : null}
          </span>
        </div>

        <div className="mt-4 md:hidden space-y-3">
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
              <div key={row.participantId} className="site-card-list-row space-y-2 px-4 py-3">
                <p className="site-label">#{idx + 1} paling jarang hadir</p>
                <p className="font-semibold text-[hsl(var(--foreground))]">{row.name}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Hadir {row.attended}x · Tidak hadir {row.absent}x
                </p>
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--accent))/0.14] px-3 py-2 text-xs text-[hsl(var(--accent-foreground))]">
                  {motivasiList[idx % motivasiList.length]}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 hidden md:block overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-[hsl(var(--border))] text-left text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                <th className="py-2 pr-2">Rank</th>
                <th className="py-2 pr-2">Nama</th>
                <th className="py-2 pr-2 text-right">Hadir</th>
                <th className="py-2 pr-2 text-right">Tidak Hadir</th>
                <th className="py-2">Motivasi</th>
              </tr>
            </thead>
            <tbody>
              {absent.map((row, idx) => (
                <tr key={row.participantId} className="border-b border-[hsl(var(--border))/0.7] align-top last:border-b-0">
                  <td className="py-3 pr-2 font-semibold">#{idx + 1}</td>
                  <td className="py-3 pr-2">{row.name}</td>
                  <td className="py-3 pr-2 text-right font-semibold">{row.attended}</td>
                  <td className="py-3 pr-2 text-right font-semibold">{row.absent}</td>
                  <td className="py-3 text-xs text-[hsl(var(--accent-foreground))]">{motivasiList[idx % motivasiList.length]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {absent.length === 0 ? (
            <p className="py-4 text-sm text-[hsl(var(--muted-foreground))]">
              {loadingAbsent
                ? "Memuat..."
                : absentMeta && absentMeta.sessions === 0
                  ? "Belum ada sesi kajian pada rentang ini."
                  : "Belum ada data absen pada rentang ini."}
            </p>
          ) : null}
        </div>
      </section>
    </SiteShell>
  );
}
