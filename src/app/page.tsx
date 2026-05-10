"use client";

import * as React from "react";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { Trash2, Calendar, CheckCircle2, ClipboardCheck, UserCheck, UserPlus, RefreshCw } from "lucide-react";
import { PageShell } from "@/components/layout/PageShell";
import { ParticipantCombobox, type Participant } from "@/components/participant-combobox";
import { AddParticipantDialog } from "@/components/add-participant-dialog";
import { SiteShell } from "@/components/site/SiteShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDeviceId } from "@/lib/device";
import { safeJson } from "@/lib/http";
import { useToast } from "@/components/ui/use-toast";
import { PinGate } from "@/components/pin-gate";
import { AttendanceOcrScanCard } from "@/components/attendance-ocr-scan-card";

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
      const res = await fetch(`/api/attendance?date=${sessionDate}&limit=500`);
      const data = await safeJson<{ data?: AttendanceEntry[] }>(res);
      setAttendance(data?.data ?? []);
    } catch (error) {
      console.error(error);
    }
  }, [sessionDate]);

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
          description: `${selected.name} sudah hadir pada ${sessionDate}.`,
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
        <PageShell
          eyebrow="Presensi"
          title="Catat Kehadiran Jamaah"
          description={
            <>
              Hari ini <span className="font-semibold text-[hsl(var(--foreground))]">{today}</span>. Data tersimpan
              pada tanggal kajian yang dipilih.
            </>
          }
        >
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="site-stat space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Calendar size={15} className="text-primary" />
                    <label className="site-label" htmlFor="session-date">
                      Tanggal Kajian
                    </label>
                  </div>
                  <Input
                    id="session-date"
                    type="date"
                    value={sessionDate}
                    onChange={(e) => setSessionDate(e.target.value)}
                    className="shadow-sm"
                  />
                </div>

                <div className="site-stat space-y-2.5">
                  <div className="flex items-center gap-2">
                    <UserCheck size={15} className="text-primary" />
                    <p className="site-label">Nama Peserta</p>
                  </div>
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
              </div>

              <div className="rounded-[calc(var(--radius)+2px)] border border-[hsl(var(--border))] bg-[hsl(var(--card))/0.88] px-4 py-4">
                {selected ? (
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <CheckCircle2 size={20} />
                    </div>
                    <div className="min-w-0">
                      <p className="site-label">Siap Dicatat</p>
                      <p className="mt-1 truncate text-lg font-bold text-[hsl(var(--foreground))]">{selected.name}</p>
                      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Tanggal: {sessionDate}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 text-[hsl(var(--muted-foreground))]">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/70">
                      <UserCheck size={20} />
                    </div>
                    <div>
                      <p className="font-semibold text-[hsl(var(--foreground))]">Belum ada peserta dipilih</p>
                      <p className="mt-1 text-sm">Cari nama jamaah atau tambah nama baru jika belum terdaftar.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <aside className="site-soft-card p-4">
              <p className="site-label mb-3 flex items-center gap-2">
                <ClipboardCheck size={14} />
                Aksi
              </p>
              <div className="grid gap-3">
                <Button
                  onClick={markAttendance}
                  disabled={loading || !selected}
                  className="h-14 w-full text-base font-bold shadow-lg"
                  size="lg"
                >
                  {loading ? (
                    <>
                      <RefreshCw size={18} className="animate-spin" />
                      Menyimpan...
                    </>
                  ) : (
                    <>
                      <UserCheck size={18} />
                      Catat Hadir
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="h-12 w-full font-semibold"
                  onClick={() => {
                    setPresetName("");
                    setModalOpen(true);
                  }}
                >
                  <UserPlus size={16} />
                  Tambah Nama Baru
                </Button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-[calc(var(--radius)+1px)] border border-[hsl(var(--border))] bg-muted/35 px-3 py-3">
                  <p className="site-label">Hadir</p>
                  <p className="mt-1 text-2xl font-bold text-[hsl(var(--foreground))]">{attendance.length}</p>
                </div>
                <div className="rounded-[calc(var(--radius)+1px)] border border-[hsl(var(--border))] bg-muted/35 px-3 py-3">
                  <p className="site-label">Tanggal</p>
                  <p className="mt-1 text-sm font-bold text-[hsl(var(--foreground))]">{sessionDate}</p>
                </div>
              </div>
            </aside>
          </div>
        </PageShell>

        <AttendanceOcrScanCard
          eventDate={sessionDate}
          deviceId={deviceId}
          onCompleted={refreshAttendance}
          onDetectedDate={setSessionDate}
        />

        <section className="site-soft-card mt-6 p-4 sm:mt-8 sm:p-5 md:p-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <UserCheck size={20} className="text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">
                  Daftar Hadir
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {sessionDate} - {attendance.length} peserta hadir
                </p>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={refreshAttendance}
              className="w-full gap-2 font-semibold sm:w-auto"
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>

          <div className="mt-5 max-h-[min(62vh,560px)] space-y-3 overflow-y-auto pr-1">
            {attendance.length === 0 ? (
              <div className="rounded-[calc(var(--radius)+2px)] border border-dashed border-border/80 bg-muted/25 px-5 py-10 text-center">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
                  <UserCheck size={28} className="text-muted-foreground/50" />
                </div>
                <p className="text-base font-semibold text-muted-foreground">Belum ada presensi untuk tanggal ini</p>
                <p className="mt-1 text-sm text-muted-foreground/70">Nama yang dicatat akan muncul di sini.</p>
              </div>
            ) : (
              attendance.map((item, index) => (
                <div
                  key={item.id}
                  className="group site-card-list-row flex flex-col gap-3 px-4 py-4 transition-all hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-[hsl(var(--foreground))] text-base">
                        {item.participant.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Calendar size={12} className="text-muted-foreground" />
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {dayjs(item.createdAt).tz("Asia/Jakarta").format("HH:mm")} WIB
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">
                      <UserCheck size={12} />
                      Hadir
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-[hsl(var(--danger))] hover:bg-danger/10 hover:text-[hsl(var(--danger))]"
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
