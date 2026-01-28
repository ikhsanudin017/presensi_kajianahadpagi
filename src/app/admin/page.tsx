"use client";

import * as React from "react";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { PinGate } from "@/components/pin-gate";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ParticipantCombobox, type Participant } from "@/components/participant-combobox";
import { useToast } from "@/components/ui/use-toast";
import { PenLine, Trash2, ChevronDown } from "lucide-react";

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
      const json = await res.json();
      setData(json.data ?? []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [date, query, range]);

  const fetchParticipants = React.useCallback(async () => {
    setParticipantLoading(true);
    try {
      const res = await fetch(
        `/api/participants?q=${encodeURIComponent(participantSearch)}&limit=200`
      );
      const json = await res.json();
      setParticipants(json.data ?? []);
      setParticipantTotal(json.meta?.total ?? (json.data?.length ?? 0));
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
      const json = await res.json();
      if (!json.ok) {
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
      const json = await res.json().catch(() => ({ ok: false }));
      if (!json.ok) {
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
      const json = await res.json();
      if (!json.ok) {
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
      const json = await res.json();
      if (!json.ok) {
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
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-6 pb-16 pt-10">
        <section className="glass rounded-[calc(var(--radius)+6px)] p-6 shadow-lg">
          <h2 className="font-[var(--font-display)] text-2xl text-[hsl(var(--foreground))]">
            Admin Presensi
          </h2>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Filter presensi berdasarkan tanggal dan pencarian nama.
          </p>
          <div className="mt-6 grid gap-4 md:grid-cols-[200px_1fr_auto]">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]">
                Rentang
              </label>
              <select
                className="rounded-[var(--radius)] border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
                value={range}
                onChange={(e) => setRange(e.target.value as typeof range)}
              >
                <option value="single">Tanggal tertentu</option>
                <option value="last30">30 hari terakhir</option>
                <option value="year">Tahun ini</option>
                <option value="all">Semua</option>
              </select>
              {range === "single" && (
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              )}
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]">
                Cari Nama
              </label>
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
        </section>

        <section className="mt-8 rounded-[calc(var(--radius)+6px)] border border-[hsl(var(--border))] bg-white/70 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-[var(--font-display)] text-xl text-[hsl(var(--foreground))]">
              Daftar Presensi
            </h3>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              Total: {data.length}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {data.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Belum ada data untuk tanggal ini.
              </p>
            ) : (
              data.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-col gap-2 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-semibold">{row.participant.name}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {row.participant.address ?? "Alamat tidak tersedia"} -{" "}
                      {row.participant.gender ?? "N/A"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right text-xs text-[hsl(var(--muted-foreground))]">
                    <div>{dayjs(row.createdAt).tz("Asia/Jakarta").format("HH:mm")} WIB</div>
                    <div className="truncate">Device: {row.deviceId ?? "-"}</div>
                    <div className="flex gap-1 text-[hsl(var(--foreground))]">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={() => openEditAttendance(row)}
                      >
                        <PenLine size={14} /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-red-700 hover:text-red-800"
                        onClick={() => deleteAttendance(row)}
                        disabled={deleteAttendanceId === row.id}
                      >
                        <Trash2 size={14} />
                        {deleteAttendanceId === row.id ? "Menghapus..." : "Hapus"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-8 rounded-[calc(var(--radius)+6px)] border border-[hsl(var(--border))] bg-white/70 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-[var(--font-display)] text-xl text-[hsl(var(--foreground))]">
              Daftar Peserta
            </h3>
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              Total: {participantTotal}
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-3 md:flex-row md:items-center">
              <Input
                placeholder="Cari peserta..."
                value={participantSearch}
                onChange={(e) => setParticipantSearch(e.target.value)}
              />
              <Button variant="secondary" onClick={fetchParticipants} disabled={participantLoading}>
                {participantLoading ? "Memuat..." : "Cari / Muat"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setParticipantsOpen((v) => !v)}
                className="flex items-center gap-2"
              >
                <ChevronDown
                  size={16}
                  className={`transition-transform ${participantsOpen ? "rotate-180" : ""}`}
                />
                {participantsOpen ? "Sembunyikan" : "Tampilkan"} daftar
              </Button>
            </div>
            {participantsOpen && (
              <div className="space-y-2">
                {participants.length === 0 ? (
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    Belum ada peserta atau hasil pencarian kosong.
                  </p>
                ) : (
                  participants.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-col gap-1 rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="font-semibold">{p.name}</p>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {p.address ?? "Alamat tidak tersedia"} - {p.gender ?? "N/A"}
                        </p>
                      </div>
                      <div className="flex gap-1 text-[hsl(var(--foreground))]">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1"
                          onClick={() => openEditParticipant(p)}
                        >
                          <PenLine size={14} /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 text-red-700 hover:text-red-800"
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
            )}
          </div>
        </section>
      </main>

      <Dialog
        open={editAttendanceOpen}
        onOpenChange={(open) => {
          setEditAttendanceOpen(open);
          if (!open) {
            setEditAttendanceTarget(null);
            setEditAttendanceParticipant(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Presensi</DialogTitle>
            <DialogDescription>
              Ubah peserta atau tanggal untuk entri presensi ini (termasuk hari sebelumnya).
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]">
              Peserta
            </label>
            <ParticipantCombobox
              value={editAttendanceParticipant ?? undefined}
              onSelect={(p) => setEditAttendanceParticipant(p)}
            />
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]">
                Tanggal Presensi
              </label>
              <Input
                type="date"
                value={editAttendanceDate}
                onChange={(e) => setEditAttendanceDate(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditAttendanceOpen(false)} disabled={savingAttendance}>
                Batal
              </Button>
              <Button onClick={saveAttendance} disabled={savingAttendance}>
                {savingAttendance ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editParticipantOpen}
        onOpenChange={(open) => {
          setEditParticipantOpen(open);
          if (!open) {
            setEditParticipantTarget(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Peserta</DialogTitle>
            <DialogDescription>Perbaiki nama/alamat/jenis kelamin peserta.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]">
                Nama
              </label>
              <Input value={editParticipantName} onChange={(e) => setEditParticipantName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]">
                Alamat
              </label>
              <Input
                value={editParticipantAddress}
                onChange={(e) => setEditParticipantAddress(e.target.value)}
                placeholder="Opsional"
              />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]">
                Jenis Kelamin (L/P)
              </label>
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
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditParticipantOpen(false)} disabled={savingParticipant}>
                Batal
              </Button>
              <Button onClick={saveParticipant} disabled={savingParticipant}>
                {savingParticipant ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PinGate>
  );
}
