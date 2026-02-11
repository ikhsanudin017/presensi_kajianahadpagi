"use client";

import * as React from "react";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { Trash2 } from "lucide-react";
import { ParticipantCombobox, type Participant } from "@/components/participant-combobox";
import { AddParticipantDialog } from "@/components/add-participant-dialog";
import { SiteShell } from "@/components/site/SiteShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeviceId } from "@/lib/device";
import { safeJson } from "@/lib/http";
import { useToast } from "@/components/ui/use-toast";
import { PinGate } from "@/components/pin-gate";

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
      <SiteShell>
        <section className="site-main-card relative overflow-hidden p-5 md:p-8">
          <div>
            <div className="space-y-2">
              <p className="site-label">Form Presensi</p>
              <h2 className="site-title text-2xl text-[hsl(var(--foreground))] md:text-3xl">
                Presensi Kajian Ahad Pagi
              </h2>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Hari ini: <span className="font-semibold text-[hsl(var(--foreground))]">{today}</span>
              </p>
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-4">
                <div>
                  <p className="site-label mb-2">Tanggal Kajian</p>
                  <Input
                    type="date"
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className="w-full sm:max-w-[340px]"
                  />
                </div>

                <div className="space-y-2">
                  <p className="site-label">Nama Peserta</p>
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
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center sm:max-w-[340px]"
                  onClick={() => setComboOpen(true)}
                >
                  Cari
                </Button>
              </div>

              <div className="flex flex-col gap-3 lg:justify-end">
                <Button onClick={markAttendance} disabled={loading} className="w-full">
                  {loading ? "Menyimpan..." : "Hadir"}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setPresetName("");
                    setModalOpen(true);
                  }}
                >
                  Tambah Nama Baru
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="site-soft-card mt-7 p-5 md:p-6">
          <div className="flex items-center justify-between gap-2">
            <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">
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
                  className="site-card-list-row flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[hsl(var(--foreground))]">{item.participant.name}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {dayjs(item.createdAt).tz("Asia/Jakarta").format("HH:mm")} WIB
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="site-chip">Hadir</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 text-[hsl(var(--danger))] hover:text-[hsl(var(--danger))]"
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
      </SiteShell>

      <AddParticipantDialog
        open={modalOpen}
        initialName={presetName}
        onOpenChange={setModalOpen}
        onCreated={(participant) => setSelected(participant)}
      />
    </PinGate>
  );
}
