"use client";

import * as React from "react";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { ParticipantCombobox, type Participant } from "@/components/participant-combobox";
import { AddParticipantDialog } from "@/components/add-participant-dialog";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { useDeviceId } from "@/lib/device";
import { safeJson } from "@/lib/http";
import { useToast } from "@/components/ui/use-toast";
import { PinGate } from "@/components/pin-gate";
import { Trash2 } from "lucide-react";

dayjs.extend(utc);
dayjs.extend(timezone);

type AttendanceEntry = {
  id: string;
  createdAt: string;
  participant: Participant;
};

export default function HomePage() {
  const { showToast } = useToast();
  const deviceId = useDeviceId();
  const [selected, setSelected] = React.useState<Participant | null>(null);
  const [attendance, setAttendance] = React.useState<AttendanceEntry[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [modalOpen, setModalOpen] = React.useState(false);
  const [presetName, setPresetName] = React.useState("");
  const [comboOpen, setComboOpen] = React.useState(false);
  const [deleteLoadingId, setDeleteLoadingId] = React.useState<string | null>(null);
  const today = dayjs().tz("Asia/Jakarta").format("YYYY-MM-DD");
  const [sessionDate, setSessionDate] = React.useState(today);

  const refreshAttendance = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/attendance?date=${today}&limit=20`);
      const data = await safeJson<{ data?: AttendanceEntry[] }>(res);
      setAttendance(data?.data ?? []);
    } catch (error) {
      console.error(error);
    }
  }, [today]);

  React.useEffect(() => {
    refreshAttendance();
  }, [refreshAttendance]);

  const markAttendance = async () => {
    if (!selected) {
      showToast({ title: "Pilih peserta terlebih dahulu" });
      return;
    }
    if (!deviceId) {
      showToast({ title: "Perangkat belum siap", description: "Coba lagi sebentar." });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: selected.id,
          deviceId,
          eventDate: sessionDate,
        }),
      });
      const data = await safeJson<{ ok?: boolean; status?: string; warning?: string | null }>(res);
      if (!data?.ok) {
        showToast({ title: "Gagal menyimpan presensi" });
        return;
      }
      if (data.status === "ALREADY_PRESENT") {
        showToast({
          title: "Sudah tercatat",
          description: `${selected.name} sudah hadir hari ini.`,
        });
      } else {
        showToast({
          title: "Presensi tersimpan",
      description: `${selected.name} tercatat hadir untuk ${sessionDate}`,
        });
      }
      if (data.warning) {
        showToast({
          title: "Tersimpan di database",
          description: "Sync ke sheet gagal.",
        });
      }
      refreshAttendance();
    } catch (error) {
      console.error(error);
      showToast({ title: "Terjadi error saat presensi" });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (entry: AttendanceEntry) => {
    const confirmed = window.confirm(`Hapus presensi atas nama ${entry.participant.name}?`);
    if (!confirmed) return;

    setDeleteLoadingId(entry.id);
    try {
      const res = await fetch(`/api/attendance?id=${encodeURIComponent(entry.id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      const data = await safeJson<{ ok?: boolean }>(res);
      if (!data?.ok) {
        showToast({ title: "Gagal menghapus presensi" });
        return;
      }
      showToast({ title: "Presensi dihapus" });
      setAttendance((prev) => prev.filter((item) => item.id !== entry.id));
    } catch (error) {
      console.error(error);
      showToast({ title: "Terjadi error saat menghapus" });
    } finally {
      setDeleteLoadingId(null);
    }
  };

  return (
    <PinGate>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-6 pb-16 pt-10">
        <section className="glass rounded-[calc(var(--radius)+6px)] p-6 shadow-lg">
          <div className="flex flex-col gap-2">
            <h2 className="font-[var(--font-display)] text-2xl text-[hsl(var(--foreground))]">
              Presensi Kajian Ahad Pagi
            </h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Hari ini: <span className="font-semibold text-[hsl(var(--foreground))]">{today}</span>
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-2">
              <div className="grid gap-2 md:grid-cols-1">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]">
                    Tanggal Kajian
                  </p>
                  <input
                    type="date"
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className="w-full rounded-[var(--radius)] border border-[hsl(var(--border))] bg-white px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Nama Peserta</p>
              <ParticipantCombobox
                value={selected ?? undefined}
                open={comboOpen}
                onOpenChange={setComboOpen}
                onSelect={(participant) => setSelected(participant)}
                onCreateNew={(name) => {
                  setPresetName(name);
                  setModalOpen(true);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center"
                onClick={() => setComboOpen(true)}
              >
                Cari
              </Button>
            </div>
            <div className="flex flex-col gap-2 md:items-end">
              <Button onClick={markAttendance} disabled={loading} className="w-full md:w-auto">
                {loading ? "Menyimpan..." : "Hadir"}
              </Button>
              <Button
                variant="outline"
                className="w-full md:w-auto"
                onClick={() => {
                  setPresetName("");
                  setModalOpen(true);
                }}
              >
                Tambah Nama Baru
              </Button>
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-[calc(var(--radius)+6px)] border border-[hsl(var(--border))] bg-white/70 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-[var(--font-display)] text-xl text-[hsl(var(--foreground))]">
              Presensi Hari Ini
            </h3>
            <Button variant="ghost" size="sm" onClick={refreshAttendance}>
              Refresh
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {attendance.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">Belum ada presensi hari ini.</p>
            ) : (
              attendance.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-[var(--radius)] border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-3"
                >
                  <div>
                    <p className="font-semibold">{item.participant.name}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {dayjs(item.createdAt).tz("Asia/Jakarta").format("HH:mm")} WIB
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[hsl(var(--muted))] px-3 py-1 text-xs font-semibold text-[hsl(var(--foreground))]">
                      Hadir
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-red-700 hover:text-red-800"
                      onClick={() => handleDelete(item)}
                      disabled={deleteLoadingId === item.id}
                    >
                      <Trash2 size={14} />
                      {deleteLoadingId === item.id ? "Menghapus..." : "Hapus"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <AddParticipantDialog
        open={modalOpen}
        initialName={presetName}
        onOpenChange={setModalOpen}
        onCreated={(participant) => setSelected(participant)}
      />
    </PinGate>
  );
}
