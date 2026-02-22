"use client";

import * as React from "react";
import { Gift, RotateCcw, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeJson } from "@/lib/http";
import { cn } from "@/lib/utils";

type LuckyDrawParticipant = {
  participantId: string;
  name: string;
  address?: string | null;
};

type LuckyDrawResponse = {
  ok?: boolean;
  sourceDate?: string | null;
  sourceDateEnd?: string | null;
  sourceSessionDates?: string[];
  participants?: LuckyDrawParticipant[];
  totalParticipants?: number;
  message?: string;
};

type LuckyDrawCardProps = {
  className?: string;
};

function toIndonesiaDateLabel(dateString?: string | null) {
  if (!dateString) return "-";
  const parsed = new Date(`${dateString}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateString;
  }
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(parsed);
}

function getRandomParticipant(participants: LuckyDrawParticipant[]) {
  if (participants.length === 0) {
    return null;
  }
  const index = Math.floor(Math.random() * participants.length);
  return participants[index] ?? null;
}

export function LuckyDrawCard({ className }: LuckyDrawCardProps) {
  const [loading, setLoading] = React.useState(false);
  const [drawing, setDrawing] = React.useState(false);
  const [participants, setParticipants] = React.useState<LuckyDrawParticipant[]>([]);
  const [sourceDate, setSourceDate] = React.useState<string | null>(null);
  const [sourceDateEnd, setSourceDateEnd] = React.useState<string | null>(null);
  const [sourceSessionDates, setSourceSessionDates] = React.useState<string[]>([]);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [rollingName, setRollingName] = React.useState("");
  const [winner, setWinner] = React.useState<LuckyDrawParticipant | null>(null);

  const rollingIntervalRef = React.useRef<number | null>(null);
  const rollingTimeoutRef = React.useRef<number | null>(null);

  const clearRollingTimer = React.useCallback(() => {
    if (rollingIntervalRef.current) {
      window.clearInterval(rollingIntervalRef.current);
      rollingIntervalRef.current = null;
    }
    if (rollingTimeoutRef.current) {
      window.clearTimeout(rollingTimeoutRef.current);
      rollingTimeoutRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => {
      clearRollingTimer();
    };
  }, [clearRollingTimer]);

  const fetchCandidates = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/lucky-draw", { cache: "no-store" });
      const json = await safeJson<LuckyDrawResponse>(res);
      if (!res.ok || !json?.ok) {
        setParticipants([]);
        setSourceDate(null);
        setSourceDateEnd(null);
        setSourceSessionDates([]);
        setStatusMessage("Data undian belum tersedia.");
        setRollingName("");
        return;
      }
      const nextParticipants = json.participants ?? [];
      setParticipants(nextParticipants);
      setSourceDate(json.sourceDate ?? null);
      setSourceDateEnd(json.sourceDateEnd ?? null);
      setSourceSessionDates(json.sourceSessionDates ?? []);
      setStatusMessage(json.message ?? null);
      setRollingName(nextParticipants[0]?.name ?? "");
      setWinner(null);
    } catch (error) {
      console.error(error);
      setParticipants([]);
      setSourceDate(null);
      setSourceDateEnd(null);
      setSourceSessionDates([]);
      setStatusMessage("Gagal memuat data undian.");
      setRollingName("");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const startDraw = () => {
    if (drawing || loading || participants.length === 0) {
      return;
    }

    clearRollingTimer();
    setDrawing(true);
    setWinner(null);

    rollingIntervalRef.current = window.setInterval(() => {
      const candidate = getRandomParticipant(participants);
      setRollingName(candidate?.name ?? "");
    }, 90);

    rollingTimeoutRef.current = window.setTimeout(() => {
      clearRollingTimer();
      const picked = getRandomParticipant(participants);
      setWinner(picked);
      setRollingName(picked?.name ?? "");
      setDrawing(false);
    }, 2300);
  };

  const canDraw = participants.length > 0 && !!sourceDate;

  return (
    <section className={cn("site-soft-card p-5 md:p-6", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="site-label">Undian Hadiah</p>
          <h3 className="site-title mt-1 text-xl text-[hsl(var(--foreground))] md:text-2xl">
            Lucky Draw Pekan Lalu
          </h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchCandidates}
          disabled={loading || drawing}
          className="w-full gap-2 sm:w-auto"
        >
          <RotateCcw size={14} />
          {loading ? "Memuat..." : "Muat Ulang Data"}
        </Button>
      </div>

      <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
        Pemenang dipilih dari presensi pekan{" "}
        <span className="font-semibold text-[hsl(var(--foreground))]">{toIndonesiaDateLabel(sourceDate)}</span>{" "}
        - <span className="font-semibold text-[hsl(var(--foreground))]">{toIndonesiaDateLabel(sourceDateEnd)}</span>.
      </p>
      {sourceSessionDates.length > 0 ? (
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Sesi: {sourceSessionDates.join(", ")}</p>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))/0.92] p-4 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.38)]">
          <p className="site-label">Nama Yang Sedang Diundi</p>
          <p
            className={cn(
              "mt-2 min-h-[2.5rem] text-2xl font-bold leading-tight text-[hsl(var(--foreground))]",
              drawing && "animate-pulse text-[hsl(var(--primary))]",
            )}
          >
            {rollingName || "Belum ada nama"}
          </p>

          {winner ? (
            <div className="mt-4 rounded-xl border border-[hsl(var(--accent))/0.35] bg-[hsl(var(--accent))/0.18] p-3">
              <div className="flex items-center gap-2 text-[hsl(var(--accent-foreground))]">
                <Gift size={16} />
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">Pemenang</span>
              </div>
              <p className="mt-1 text-lg font-semibold text-[hsl(var(--foreground))]">{winner.name}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">{winner.address || "Alamat belum tersedia"}</p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-[hsl(var(--muted-foreground))]">
              Tekan tombol undian untuk memilih pemenang secara acak.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Button onClick={startDraw} disabled={!canDraw || loading || drawing} className="w-full gap-2">
            <Shuffle size={15} />
            {drawing ? "Mengundi..." : "Mulai Undian"}
          </Button>
          <Button
            variant="outline"
            onClick={fetchCandidates}
            disabled={loading || drawing}
            className="w-full"
          >
            Refresh Peserta
          </Button>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {canDraw ? `${participants.length} peserta unik siap diundi.` : "Data pekan lalu belum tersedia."}
          </p>
          {statusMessage ? <p className="text-xs text-[hsl(var(--muted-foreground))]">{statusMessage}</p> : null}
        </div>
      </div>
    </section>
  );
}
