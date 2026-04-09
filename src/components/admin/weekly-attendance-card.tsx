"use client";

import * as React from "react";
import { CalendarRange, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeJson } from "@/lib/http";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

type WeeklyParticipant = {
  mergeKey: string;
  participantIds: string[];
  name: string;
  address?: string | null;
  attendedSessions: number;
  attendedDates: string[];
  dateTargets: Array<{
    eventDate: string;
    participantIds: string[];
  }>;
};

type WeeklyGroup = {
  weekStart: string;
  weekEnd: string;
  sessionDates: string[];
  sessionsCount: number;
  uniqueParticipants: number;
  totalAttendance: number;
  participants: WeeklyParticipant[];
};

type WeeklyApiResponse = {
  ok?: boolean;
  data?: WeeklyGroup[];
};

type WeeklyAttendanceCardProps = {
  className?: string;
  weeks?: number;
};

function toShortDateLabel(dateString: string) {
  const parsed = new Date(`${dateString}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateString;
  }
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(parsed);
}

export function WeeklyAttendanceCard({ className, weeks = 12 }: WeeklyAttendanceCardProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [groups, setGroups] = React.useState<WeeklyGroup[]>([]);
  const [deletingKey, setDeletingKey] = React.useState<string | null>(null);
  const [deletingWeekKey, setDeletingWeekKey] = React.useState<string | null>(null);

  const fetchWeeklyAttendance = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/weekly-attendance?weeks=${weeks}`, { cache: "no-store" });
      const json = await safeJson<WeeklyApiResponse>(res);
      if (!res.ok || !json?.ok) {
        setGroups([]);
        return;
      }
      setGroups(json.data ?? []);
    } catch (error) {
      console.error(error);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [weeks]);

  React.useEffect(() => {
    fetchWeeklyAttendance();
  }, [fetchWeeklyAttendance]);

  const deleteAttendanceByDate = async (participant: WeeklyParticipant, eventDate: string) => {
    const target = participant.dateTargets.find((item) => item.eventDate === eventDate);
    if (!target || target.participantIds.length === 0) {
      showToast({ title: "Presensi tidak ditemukan" });
      return;
    }

    const confirmDelete = window.confirm(`Hapus presensi ${participant.name} tanggal ${eventDate}?`);
    if (!confirmDelete) {
      return;
    }

    const key = `${participant.mergeKey}:${eventDate}`;
    setDeletingKey(key);
    try {
      const res = await fetch("/api/admin/weekly-attendance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          participantIds: target.participantIds,
          eventDate,
        }),
      });
      const json = await safeJson<{ ok?: boolean; deletedCount?: number }>(res);
      if (!res.ok || !json?.ok) {
        showToast({ title: "Gagal menghapus presensi" });
        return;
      }
      showToast({
        title: "Presensi dihapus",
        description: `${participant.name} - ${eventDate}${json.deletedCount && json.deletedCount > 1 ? ` (${json.deletedCount} entri)` : ""}`,
      });
      await fetchWeeklyAttendance();
    } catch (error) {
      console.error(error);
      showToast({ title: "Terjadi error saat menghapus" });
    } finally {
      setDeletingKey(null);
    }
  };

  const deleteWeekGroup = async (group: WeeklyGroup) => {
    const confirmDelete = window.confirm(
      `Hapus semua presensi pekan ${group.weekStart} sampai ${group.weekEnd}? Tindakan ini akan menghapus ${group.totalAttendance} presensi yang tampil di rekap pekan ini.`,
    );
    if (!confirmDelete) {
      return;
    }

    setDeletingWeekKey(group.weekStart);
    try {
      const res = await fetch("/api/admin/weekly-attendance", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          weekStart: group.weekStart,
        }),
      });
      const json = await safeJson<{ ok?: boolean; deletedCount?: number }>(res);
      if (!res.ok || !json?.ok) {
        showToast({ title: "Gagal menghapus presensi mingguan" });
        return;
      }
      showToast({
        title: "Presensi mingguan dihapus",
        description: `${json.deletedCount ?? 0} entri dihapus untuk pekan ${group.weekStart} - ${group.weekEnd}.`,
      });
      await fetchWeeklyAttendance();
    } catch (error) {
      console.error(error);
      showToast({ title: "Terjadi error saat menghapus presensi mingguan" });
    } finally {
      setDeletingWeekKey(null);
    }
  };

  return (
    <section className={cn("site-soft-card p-5 md:p-6", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="site-label">Rekap Mingguan</p>
          <h3 className="site-title mt-1 text-xl text-[hsl(var(--foreground))] md:text-2xl">
            Kehadiran Per Pekan
          </h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchWeeklyAttendance}
          disabled={loading}
          className="w-full gap-2 sm:w-auto"
        >
          <RotateCcw size={14} />
          {loading ? "Memuat..." : "Refresh Rekap"}
        </Button>
      </div>

      <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
        Rekap menampilkan daftar hadir per pekan berdasarkan tanggal kajian yang tercatat.
      </p>

      {groups.length === 0 ? (
        <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
          {loading ? "Memuat rekap mingguan..." : "Belum ada data rekap mingguan."}
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {groups.map((group) => (
            <article
              key={group.weekStart}
              className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))/0.9] p-4"
            >
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
                    <CalendarRange size={14} />
                    Pekan {toShortDateLabel(group.weekStart)} - {toShortDateLabel(group.weekEnd)}
                  </div>
                  <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                    {group.uniqueParticipants} peserta unik - {group.sessionsCount} sesi kajian -{" "}
                    {group.totalAttendance} total presensi
                  </p>
                </div>
                <div className="flex flex-col items-start gap-2 md:items-end">
                  <span className="site-chip">Sesi: {group.sessionDates.join(", ") || "-"}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-2 text-[hsl(var(--danger))] hover:bg-danger/10 hover:text-[hsl(var(--danger))]"
                    onClick={() => deleteWeekGroup(group)}
                    disabled={deletingWeekKey === group.weekStart}
                  >
                    <Trash2 size={14} />
                    {deletingWeekKey === group.weekStart ? "Menghapus pekan..." : "Hapus Semua Presensi Pekan Ini"}
                  </Button>
                </div>
              </div>

              <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[hsl(var(--border))/0.8] bg-[hsl(var(--card))/0.7]">
                <div className="md:hidden divide-y divide-[hsl(var(--border))/0.7]">
                  {group.participants.map((participant) => (
                    <div key={participant.mergeKey} className="space-y-1 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-[hsl(var(--foreground))]">{participant.name}</p>
                        <span className="site-chip">{participant.attendedSessions}x</span>
                      </div>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {participant.address || "Alamat belum tersedia"}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {participant.attendedDates.map((date) => {
                          const key = `${participant.mergeKey}:${date}`;
                          return (
                            <Button
                              key={key}
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-[11px]"
                              onClick={() => deleteAttendanceByDate(participant, date)}
                              disabled={deletingKey === key}
                            >
                              <Trash2 size={12} />
                              {deletingKey === key ? "Menghapus..." : date}
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <table className="hidden w-full min-w-[680px] text-sm md:table">
                  <thead>
                    <tr className="border-b border-[hsl(var(--border))/0.8] text-left text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                      <th className="px-3 py-2">Nama Peserta</th>
                      <th className="px-3 py-2">Alamat</th>
                      <th className="px-3 py-2 text-right">Jumlah Hadir</th>
                      <th className="px-3 py-2">Tanggal Hadir</th>
                      <th className="px-3 py-2 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.participants.map((participant) => (
                      <tr
                        key={participant.mergeKey}
                        className="border-b border-[hsl(var(--border))/0.65] last:border-b-0"
                      >
                        <td className="px-3 py-2.5 font-semibold text-[hsl(var(--foreground))]">
                          {participant.name}
                        </td>
                        <td className="px-3 py-2.5 text-[hsl(var(--muted-foreground))]">
                          {participant.address || "-"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold">{participant.attendedSessions}</td>
                        <td className="px-3 py-2.5 text-[hsl(var(--muted-foreground))]">
                          {participant.attendedDates.join(", ")}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {participant.attendedDates.map((date) => {
                              const key = `${participant.mergeKey}:${date}`;
                              return (
                                <Button
                                  key={key}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 gap-1 px-2 text-[11px]"
                                  onClick={() => deleteAttendanceByDate(participant, date)}
                                  disabled={deletingKey === key}
                                >
                                  <Trash2 size={12} />
                                  {deletingKey === key ? "Menghapus..." : date}
                                </Button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
