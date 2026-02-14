"use client";

import * as React from "react";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import { Trash2, Calendar, UserCheck, UserPlus, RefreshCw } from "lucide-react";
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
        <PageShell
          eyebrow="Form Presensi"
          title="Presensi Kajian Ahad Pagi"
          description={
            <>
              Hari ini: <span className="font-semibold text-[hsl(var(--foreground))]">{today}</span>
            </>
          }
        >
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-stretch">
            {/* Form Input Presensi */}
            <div className="rounded-[22px] border border-border/75 bg-gradient-to-br from-card/70 via-card/60 to-card/50 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),_0_8px_24px_-12px_rgba(0,0,0,0.08)] sm:rounded-[28px] sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-border/65 bg-gradient-to-r from-muted/40 to-muted/25 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Calendar size={16} />
                  </div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                    Input Presensi
                  </p>
                </div>
                <span className="rounded-full border border-primary/30 bg-gradient-to-r from-primary/15 to-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary shadow-sm">
                  Langkah 1/2
                </span>
              </div>

              <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-1">
                <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Calendar size={14} className="text-primary" />
                <p className="site-label">Tanggal Kajian</p>
              </div>
              <Input 
                type="date" 
                value={sessionDate} 
                onChange={(e) => setSessionDate(e.target.value)} 
                className="h-12 w-full shadow-sm sm:h-11" 
              />
                </div>

                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <UserCheck size={14} className="text-primary" />
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

              <div className="mt-5 rounded-2xl border border-border/70 bg-gradient-to-r from-card/80 to-card/60 px-4 py-3.5 text-sm shadow-sm">
                {selected ? (
                  <div className="flex items-center gap-2">
                    <UserCheck size={16} className="text-primary" />
                    <span className="text-muted-foreground">Peserta dipilih:</span>
                    <span className="font-bold text-[hsl(var(--foreground))]">{selected.name}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <UserCheck size={16} className="opacity-50" />
                    <span>Belum ada peserta dipilih</span>
                  </div>
                )}
              </div>
            </div>

            {/* Panel Aksi */}
            <div className="flex flex-col rounded-[22px] border border-border/75 bg-gradient-to-br from-card/65 via-card/55 to-card/45 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.42),_0_8px_24px_-12px_rgba(0,0,0,0.08)] sm:rounded-[28px] sm:p-6">
              <p className="site-label mb-4 flex items-center gap-2">
                <UserCheck size={14} />
                Aksi Presensi
              </p>
              <div className="flex flex-col gap-2.5 sm:gap-3">
                <Button 
                  onClick={markAttendance} 
                  disabled={loading || !selected} 
                  className="h-14 w-full text-base font-bold shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100 sm:h-12"
                  size="lg"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <RefreshCw size={18} className="animate-spin" />
                      <span>Menyimpan...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <UserCheck size={18} />
                      <span>Hadir</span>
                    </div>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="h-12 w-full font-semibold transition-all hover:scale-[1.01] active:scale-[0.98] sm:h-11"
                  onClick={() => {
                    setPresetName("");
                    setModalOpen(true);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <UserPlus size={16} />
                    <span>Tambah Nama Baru</span>
                  </div>
                </Button>
              </div>
              <div className="mt-4 rounded-xl border border-border/60 bg-gradient-to-br from-muted/40 to-muted/25 px-4 py-3.5">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  💡 <span className="font-semibold">Petunjuk:</span> Pilih peserta dari dropdown, lalu klik tombol{" "}
                  <span className="font-bold text-[hsl(var(--primary))]">Hadir</span> untuk mencatat presensi hari ini.
                </p>
              </div>
            </div>
          </div>
        </PageShell>

        <section className="site-soft-card mt-6 p-4 sm:mt-8 sm:p-5 md:p-7">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/10">
                <UserCheck size={20} className="text-primary" />
              </div>
              <div>
                <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">
                  Presensi Hari Ini
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {attendance.length} {attendance.length === 1 ? 'peserta' : 'peserta'} hadir
                </p>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={refreshAttendance}
              className="gap-2 font-semibold"
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
          </div>

          <div className="mt-5 max-h-[min(60vh,560px)] space-y-3 overflow-y-auto pr-1.5">
            {attendance.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-12 text-center">
                <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
                  <UserCheck size={28} className="text-muted-foreground/50" />
                </div>
                <p className="text-base font-semibold text-muted-foreground">Belum ada presensi hari ini</p>
                <p className="mt-1 text-sm text-muted-foreground/70">Mulai tandai kehadiran jamaah</p>
              </div>
            ) : (
              attendance.map((item, index) => (
                <div
                  key={item.id}
                  className="group site-card-list-row flex flex-col gap-3 px-5 py-4 transition-all hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-primary/5 font-bold text-primary">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-[hsl(var(--foreground))] text-base">{item.participant.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Calendar size={12} className="text-muted-foreground" />
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">
                          {dayjs(item.createdAt).tz("Asia/Jakarta").format("HH:mm")} WIB
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-gradient-to-r from-primary/15 to-primary/10 px-3 py-1.5 text-xs font-bold text-primary">
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
