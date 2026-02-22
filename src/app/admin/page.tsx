"use client";

import * as React from "react";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { PenLine, Trash2, ChevronDown } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { PinGate } from "@/components/pin-gate";
import { SiteShell } from "@/components/site/SiteShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveDialog } from "@/components/ui/responsive-dialog";
import { ParticipantCombobox, type Participant } from "@/components/participant-combobox";
import { useToast } from "@/components/ui/use-toast";
import { LuckyDrawCard } from "@/components/admin/lucky-draw-card";
import { WeeklyAttendanceCard } from "@/components/admin/weekly-attendance-card";
import { safeJson } from "@/lib/http";

dayjs.extend(utc);
dayjs.extend(timezone);

type AttendanceRow = {
  id: string;
  createdAt: string;
  eventDate?: string;
  deviceId?: string | null;
  participant: {
    id: string;
    name: string;
    address?: string | null;
    gender?: "L" | "P" | null;
  };
};

type ParticipantRow = Participant;

export default function AdminPage() {
  const { showToast } = useToast();
  const today = dayjs().tz("Asia/Jakarta").format("YYYY-MM-DD");
  const [date, setDate] = React.useState(today);
  const [range, setRange] = React.useState<"single" | "last30" | "year" | "all">("single");
  const [query, setQuery] = React.useState("");
  const [data, setData] = React.useState<AttendanceRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [participants, setParticipants] = React.useState<ParticipantRow[]>([]);
  const [participantSearch, setParticipantSearch] = React.useState("");
  const [participantLoading, setParticipantLoading] = React.useState(false);
  const [participantTotal, setParticipantTotal] = React.useState(0);
  const [participantsOpen, setParticipantsOpen] = React.useState(false);
  const [editAttendanceOpen, setEditAttendanceOpen] = React.useState(false);
  const [editAttendanceTarget, setEditAttendanceTarget] = React.useState<AttendanceRow | null>(null);
  const [editAttendanceParticipant, setEditAttendanceParticipant] = React.useState<Participant | null>(null);
  const [editAttendanceDate, setEditAttendanceDate] = React.useState<string>(today);
  const [savingAttendance, setSavingAttendance] = React.useState(false);
  const [deleteAttendanceId, setDeleteAttendanceId] = React.useState<string | null>(null);

  const [editParticipantOpen, setEditParticipantOpen] = React.useState(false);
  const [editParticipantTarget, setEditParticipantTarget] = React.useState<ParticipantRow | null>(null);
  const [editParticipantName, setEditParticipantName] = React.useState("");
  const [editParticipantAddress, setEditParticipantAddress] = React.useState("");
  const [editParticipantGender, setEditParticipantGender] = React.useState<"L" | "P" | "">("");
  const [savingParticipant, setSavingParticipant] = React.useState(false);
  const [deleteParticipantId, setDeleteParticipantId] = React.useState<string | null>(null);

  const fetchAttendance = React.useCallback(async () => {
    setLoading(true);
    try {
      const params =
        range === "single"
          ? `date=${encodeURIComponent(date)}`
          : `range=${encodeURIComponent(range)}`;
      const res = await fetch(`/api/attendance?${params}&q=${encodeURIComponent(query)}`);
      const json = await safeJson<{ data?: AttendanceRow[] }>(res);
      setData(json?.data ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [date, query, range]);

  const downloadFile = async (url: string, filename: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      showToast({ title: "Gagal mengunduh", description: "Server mengembalikan error." });
      return;
    }
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(href);
  };

  const handleDownloadAttendance = () => {
    const params =
      range === "single"
        ? `range=single&date=${encodeURIComponent(date)}`
        : `range=${encodeURIComponent(range)}`;
    const url = `/api/admin/export/attendance?${params}&q=${encodeURIComponent(query)}`;
    downloadFile(url, `presensi-${range}.csv`);
  };

  const handleDownloadLeaderboard = () => {
    const { leaderboardRange, weeks } =
      range === "last30"
        ? { leaderboardRange: "30d", weeks: 4 }
        : range === "year"
          ? { leaderboardRange: "year", weeks: 52 }
          : { leaderboardRange: "all", weeks: 24 };
    const url = `/api/admin/export/leaderboard?range=${encodeURIComponent(
      range === "single" ? "all" : leaderboardRange,
    )}&weeks=${weeks}`;
    downloadFile(url, `leaderboard-${leaderboardRange}.csv`);
  };

  const fetchParticipants = React.useCallback(async () => {
    setParticipantLoading(true);
    try {
      const res = await fetch(`/api/participants?q=${encodeURIComponent(participantSearch)}&limit=200`, {
        cache: "no-store",
      });
      const json = await safeJson<{ data?: ParticipantRow[]; meta?: { total?: number } }>(res);
      setParticipants(json?.data ?? []);
      setParticipantTotal(json?.meta?.total ?? (json?.data?.length ?? 0));
    } catch (error) {
      console.error(error);
    } finally {
      setParticipantLoading(false);
    }
  }, [participantSearch]);

  React.useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  React.useEffect(() => {
    fetchParticipants();
  }, [fetchParticipants]);

  const openEditAttendance = (row: AttendanceRow) => {
    setEditAttendanceTarget(row);
    setEditAttendanceParticipant({
      id: row.participant?.id ?? "",
      name: row.participant.name,
    } as Participant);
    setEditAttendanceDate(row.eventDate ?? row.createdAt.slice(0, 10));
    setEditAttendanceOpen(true);
  };

  const saveAttendance = async () => {
    if (!editAttendanceTarget || !editAttendanceParticipant) {
      showToast({ title: "Pilih peserta terlebih dahulu" });
      return;
    }
    setSavingAttendance(true);
    try {
      const res = await fetch(`/api/attendance/${editAttendanceTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: editAttendanceParticipant.id,
          eventDate: editAttendanceDate,
        }),
      });
      const json = await safeJson<{ ok?: boolean }>(res);
      if (!json?.ok) {
        showToast({ title: "Gagal menyimpan perubahan" });
        return;
      }
      showToast({ title: "Presensi diperbarui" });
      setEditAttendanceOpen(false);
      fetchAttendance();
    } catch (error) {
      console.error(error);
      showToast({ title: "Terjadi error saat menyimpan" });
    } finally {
      setSavingAttendance(false);
    }
  };

  const deleteAttendance = async (row: AttendanceRow) => {
    const confirmed = window.confirm(`Hapus presensi ${row.participant.name}?`);
    if (!confirmed) return;
    setDeleteAttendanceId(row.id);
    try {
      const res = await fetch(`/api/attendance?id=${encodeURIComponent(row.id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const json = await safeJson<{ ok?: boolean }>(res);
      if (!json?.ok) {
        showToast({ title: "Gagal menghapus presensi" });
        return;
      }
      showToast({ title: "Presensi dihapus" });
      fetchAttendance();
    } catch (error) {
      console.error(error);
      showToast({ title: "Terjadi error saat menghapus" });
    } finally {
      setDeleteAttendanceId(null);
    }
  };

  const openEditParticipant = (p: ParticipantRow) => {
    setEditParticipantTarget(p);
    setEditParticipantName(p.name);
    setEditParticipantAddress(p.address ?? "");
    setEditParticipantGender((p.gender as "L" | "P" | null) ?? "");
    setEditParticipantOpen(true);
  };

  const saveParticipant = async () => {
    if (!editParticipantTarget) return;
    setSavingParticipant(true);
    try {
      const res = await fetch(`/api/participants/${editParticipantTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editParticipantName.trim(),
          address: editParticipantAddress.trim(),
          gender: editParticipantGender || null,
        }),
      });
      const json = await safeJson<{ ok?: boolean }>(res);
      if (!json?.ok) {
        showToast({ title: "Gagal menyimpan data peserta" });
        return;
      }
      showToast({ title: "Peserta diperbarui" });
      setEditParticipantOpen(false);
      fetchParticipants();
    } catch (error) {
      console.error(error);
      showToast({ title: "Terjadi error saat menyimpan peserta" });
    } finally {
      setSavingParticipant(false);
    }
  };

  const deleteParticipant = async (p: ParticipantRow) => {
    const confirmed = window.confirm(`Hapus peserta ${p.name}? Tindakan ini menghapus datanya.`);
    if (!confirmed) return;
    setDeleteParticipantId(p.id);
    try {
      const res = await fetch(`/api/participants/${p.id}`, { method: "DELETE" });
      const json = await safeJson<{ ok?: boolean }>(res);
      if (!json?.ok) {
        showToast({ title: "Gagal menghapus peserta" });
        return;
      }
      showToast({ title: "Peserta dihapus" });
      fetchParticipants();
    } catch (error) {
      console.error(error);
      showToast({ title: "Terjadi error saat menghapus peserta" });
    } finally {
      setDeleteParticipantId(null);
    }
  };

  return (
    <PinGate>
      <SiteShell>
        <PageShell
          eyebrow="Kontrol Data"
          title="Admin Presensi"
          description="Filter presensi berdasarkan tanggal dan pencarian nama."
          actions={
            <div className="flex w-full flex-col gap-2 sm:flex-row md:w-auto md:justify-end">
              <Button variant="outline" size="sm" onClick={handleDownloadAttendance} className="w-full sm:w-auto">
                Unduh Presensi (Excel)
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadLeaderboard} className="w-full sm:w-auto">
                Unduh Leaderboard (Excel)
              </Button>
            </div>
          }
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[220px_minmax(0,1fr)_180px]">
            <div className="space-y-2">
              <label className="site-label">Rentang</label>
              <select
                className="site-select w-full"
                value={range}
                onChange={(e) => setRange(e.target.value as typeof range)}
              >
                <option value="single">Tanggal tertentu</option>
                <option value="last30">30 hari terakhir</option>
                <option value="year">Tahun ini</option>
                <option value="all">Semua</option>
              </select>
              {range === "single" ? (
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="site-label">Cari Nama</label>
              <Input
                placeholder="Masukkan nama..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>

            <div className="flex items-end">
              <Button variant="secondary" onClick={fetchAttendance} disabled={loading} className="w-full">
                {loading ? "Memuat..." : "Terapkan"}
              </Button>
            </div>
          </div>
        </PageShell>

        <LuckyDrawCard className="mt-7" />
        <WeeklyAttendanceCard className="mt-7" weeks={12} />

        <section className="site-soft-card mt-7 p-5 md:p-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">Daftar Presensi</h3>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">Total: {data.length}</span>
          </div>

          <div className="mt-4 md:hidden space-y-3">
            {data.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Belum ada data untuk tanggal ini.</p>
            ) : (
              data.map((row) => (
                <div key={row.id} className="site-card-list-row space-y-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[hsl(var(--foreground))]">{row.participant.name}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {row.participant.address ?? "Alamat tidak tersedia"} - {row.participant.gender ?? "N/A"}
                    </p>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[hsl(var(--muted-foreground))]">
                    <span>{dayjs(row.createdAt).tz("Asia/Jakarta").format("HH:mm")} WIB</span>
                    <span className="max-w-[46vw] truncate">Device: {row.deviceId ?? "-"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" className="gap-1" onClick={() => openEditAttendance(row)}>
                      <PenLine size={14} /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-[hsl(var(--danger))] hover:text-[hsl(var(--danger))]"
                      onClick={() => deleteAttendance(row)}
                      disabled={deleteAttendanceId === row.id}
                    >
                      <Trash2 size={14} />
                      {deleteAttendanceId === row.id ? "Menghapus..." : "Hapus"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 hidden md:block overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border))] text-left text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                  <th className="py-2 pr-2">Peserta</th>
                  <th className="py-2 pr-2">Alamat / Gender</th>
                  <th className="py-2 pr-2">Waktu</th>
                  <th className="py-2 pr-2">Device</th>
                  <th className="py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.id} className="border-b border-[hsl(var(--border))/0.7] last:border-b-0">
                    <td className="py-3 pr-2 font-semibold">{row.participant.name}</td>
                    <td className="py-3 pr-2 text-[hsl(var(--muted-foreground))]">
                      {(row.participant.address ?? "Alamat tidak tersedia") + " - " + (row.participant.gender ?? "N/A")}
                    </td>
                    <td className="py-3 pr-2">{dayjs(row.createdAt).tz("Asia/Jakarta").format("HH:mm")} WIB</td>
                    <td className="max-w-[220px] truncate py-3 pr-2 text-[hsl(var(--muted-foreground))]">{row.deviceId ?? "-"}</td>
                    <td className="py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="gap-1" onClick={() => openEditAttendance(row)}>
                          <PenLine size={14} /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 text-[hsl(var(--danger))] hover:text-[hsl(var(--danger))]"
                          onClick={() => deleteAttendance(row)}
                          disabled={deleteAttendanceId === row.id}
                        >
                          <Trash2 size={14} />
                          {deleteAttendanceId === row.id ? "Menghapus..." : "Hapus"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.length === 0 ? (
              <p className="py-4 text-sm text-[hsl(var(--muted-foreground))]">Belum ada data untuk tanggal ini.</p>
            ) : null}
          </div>
        </section>

        <section className="site-soft-card mt-7 p-5 md:p-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">Daftar Peserta</h3>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">Total: {participantTotal}</span>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Input
                placeholder="Cari peserta..."
                value={participantSearch}
                onChange={(e) => setParticipantSearch(e.target.value)}
              />
              <Button
                variant="secondary"
                onClick={fetchParticipants}
                disabled={participantLoading}
                className="w-full md:w-auto"
              >
                {participantLoading ? "Memuat..." : "Cari / Muat"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setParticipantsOpen((v) => !v)}
                className="flex w-full items-center justify-center gap-2 md:w-auto"
              >
                <ChevronDown
                  size={16}
                  className={`transition-transform ${participantsOpen ? "rotate-180" : ""}`}
                />
                {participantsOpen ? "Sembunyikan" : "Tampilkan"} daftar
              </Button>
            </div>

            {participantsOpen && (
              <>
                <div className="space-y-2 md:hidden">
                  {participants.length === 0 ? (
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">
                      Belum ada peserta atau hasil pencarian kosong.
                    </p>
                  ) : (
                    participants.map((p) => (
                      <div key={p.id} className="site-card-list-row space-y-2 px-4 py-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[hsl(var(--foreground))]">{p.name}</p>
                          <p className="text-xs text-[hsl(var(--muted-foreground))]">
                            {p.address ?? "Alamat tidak tersedia"} - {p.gender ?? "N/A"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1 text-[hsl(var(--foreground))]">
                          <Button size="sm" variant="ghost" className="gap-1" onClick={() => openEditParticipant(p)}>
                            <PenLine size={14} /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1 text-[hsl(var(--danger))] hover:text-[hsl(var(--danger))]"
                            onClick={() => deleteParticipant(p)}
                            disabled={deleteParticipantId === p.id}
                          >
                            <Trash2 size={14} />
                            {deleteParticipantId === p.id ? "Menghapus..." : "Hapus"}
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full min-w-[700px] text-sm">
                    <thead>
                      <tr className="border-b border-[hsl(var(--border))] text-left text-[11px] uppercase tracking-[0.16em] text-[hsl(var(--muted-foreground))]">
                        <th className="py-2 pr-2">Nama</th>
                        <th className="py-2 pr-2">Alamat</th>
                        <th className="py-2 pr-2">Gender</th>
                        <th className="py-2 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {participants.map((p) => (
                        <tr key={p.id} className="border-b border-[hsl(var(--border))/0.7] last:border-b-0">
                          <td className="py-3 pr-2 font-semibold">{p.name}</td>
                          <td className="py-3 pr-2 text-[hsl(var(--muted-foreground))]">{p.address ?? "-"}</td>
                          <td className="py-3 pr-2">{p.gender ?? "N/A"}</td>
                          <td className="py-3 text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" className="gap-1" onClick={() => openEditParticipant(p)}>
                                <PenLine size={14} /> Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-1 text-[hsl(var(--danger))] hover:text-[hsl(var(--danger))]"
                                onClick={() => deleteParticipant(p)}
                                disabled={deleteParticipantId === p.id}
                              >
                                <Trash2 size={14} />
                                {deleteParticipantId === p.id ? "Menghapus..." : "Hapus"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {participants.length === 0 ? (
                    <p className="py-4 text-sm text-[hsl(var(--muted-foreground))]">
                      Belum ada peserta atau hasil pencarian kosong.
                    </p>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </section>
      </SiteShell>

      <ResponsiveDialog
        open={editAttendanceOpen}
        onOpenChange={(open) => {
          setEditAttendanceOpen(open);
          if (!open) {
            setEditAttendanceTarget(null);
            setEditAttendanceParticipant(null);
          }
        }}
        title="Edit Presensi"
        description="Ubah peserta atau tanggal untuk entri presensi ini (termasuk hari sebelumnya)."
      >
        <div className="space-y-3">
          <label className="site-label block">Peserta</label>
          <ParticipantCombobox
            value={editAttendanceParticipant ?? undefined}
            onSelect={(p) => setEditAttendanceParticipant(p)}
            onCreateNew={() => {}}
          />
          <div className="space-y-2">
            <label className="site-label block">Tanggal Presensi</label>
            <Input
              type="date"
              value={editAttendanceDate}
              onChange={(e) => setEditAttendanceDate(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setEditAttendanceOpen(false)} disabled={savingAttendance} className="w-full sm:w-auto">
              Batal
            </Button>
            <Button onClick={saveAttendance} disabled={savingAttendance} className="w-full sm:w-auto">
              {savingAttendance ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>

      <ResponsiveDialog
        open={editParticipantOpen}
        onOpenChange={(open) => {
          setEditParticipantOpen(open);
          if (!open) {
            setEditParticipantTarget(null);
          }
        }}
        title="Edit Peserta"
        description="Perbaiki nama/alamat/jenis kelamin peserta."
      >
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="site-label block">Nama</label>
            <Input value={editParticipantName} onChange={(e) => setEditParticipantName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="site-label block">Alamat</label>
            <Input
              value={editParticipantAddress}
              onChange={(e) => setEditParticipantAddress(e.target.value)}
              placeholder="Opsional"
            />
          </div>
          <div className="space-y-2">
            <label className="site-label block">Jenis Kelamin (L/P)</label>
            <Input
              value={editParticipantGender}
              onChange={(e) => {
                const val = e.target.value.toUpperCase();
                if (val === "L" || val === "P") {
                  setEditParticipantGender(val);
                } else if (val === "") {
                  setEditParticipantGender("");
                }
              }}
              placeholder="L atau P (kosongkan jika tidak diketahui)"
            />
          </div>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setEditParticipantOpen(false)} disabled={savingParticipant} className="w-full sm:w-auto">
              Batal
            </Button>
            <Button onClick={saveParticipant} disabled={savingParticipant} className="w-full sm:w-auto">
              {savingParticipant ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>
    </PinGate>
  );
}

