"use client";

import * as React from "react";
import {
  AlertTriangle,
  Camera,
  CalendarDays,
  CheckCircle2,
  Clipboard,
  FileImage,
  RefreshCw,
  Save,
  ScanLine,
  SearchCheck,
  Upload,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeJson } from "@/lib/http";
import { useToast } from "@/components/ui/use-toast";

type ScanSummary = {
  filesProcessed: number;
  detectedByOcr: number;
  readyToSave: number;
  reviewRequired: number;
  alreadyPresent: number;
  duplicateInScan: number;
  unresolved: number;
};

type ScanReviewItem = {
  id: string;
  pageNumber: number;
  rowNumber?: number;
  sourceName: string;
  participantName: string;
  participantId: string;
  confidence: "high" | "medium" | "low";
  resolutionMethod: "exact" | "phonetic" | "fuzzy" | "roster" | "new";
  matchScore?: number;
  saveStatus: "READY" | "REVIEW_REQUIRED" | "ALREADY_PRESENT" | "DUPLICATE_IN_SCAN";
  selectedByDefault: boolean;
  reason: string;
};

type UnresolvedItem = {
  pageNumber: number;
  rowNumber?: number;
  sourceName: string;
  reason: string;
};

type StructuredScanResult = {
  displayDate: string | null;
  detectedEventDate: string | null;
  previewText: string;
};

type ScanResponseData = {
  summary: ScanSummary;
  structured: StructuredScanResult;
  reviewItems: ScanReviewItem[];
  unresolved: UnresolvedItem[];
  warnings: string[];
  blocked: boolean;
};

type ScanJobStartResponse = {
  ok?: boolean;
  jobId?: string;
  error?: string;
  detail?: string;
};

type ScanJobStatusResponse = {
  ok?: boolean;
  data?: {
    status: "queued" | "running" | "completed" | "failed";
    progress: number;
    message: string;
    result?: ScanResponseData;
    error?: string;
  };
};

type SaveReviewResponse = {
  ok?: boolean;
  data?: {
    summary: {
      requested: number;
      createdAttendance: number;
      alreadyPresent: number;
      skipped: number;
    };
    results: Array<{
      participantName: string;
      participantId: string;
      attendanceStatus: "CREATED" | "ALREADY_PRESENT" | "SKIPPED";
      reason: string;
    }>;
    warnings: string[];
  };
};

type Props = {
  eventDate: string;
  deviceId?: string | null;
  onCompleted?: () => void;
  onDetectedDate?: (date: string) => void;
};

function fileSignature(file: File) {
  return [file.name || "clipboard-image", file.size, file.type, file.lastModified].join(":");
}

function extensionFromMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  return normalized.split("/")[1] || "png";
}

function createClipboardFile(blob: Blob, index: number) {
  const ext = extensionFromMimeType(blob.type || "image/png");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return new File([blob], `clipboard-${timestamp}-${index + 1}.${ext}`, {
    type: blob.type || "image/png",
    lastModified: Date.now() + index,
  });
}

function mergeUniqueFiles(current: File[], incoming: File[]) {
  const merged = new Map<string, File>();
  for (const file of [...current, ...incoming]) {
    merged.set(fileSignature(file), file);
  }
  return Array.from(merged.values());
}

function buildSummaryFromReviewItems(items: ScanReviewItem[], unresolvedCount: number, filesProcessed: number, detectedByOcr: number): ScanSummary {
  return {
    filesProcessed,
    detectedByOcr,
    readyToSave: items.filter((item) => item.saveStatus === "READY").length,
    reviewRequired: items.filter((item) => item.saveStatus === "REVIEW_REQUIRED").length,
    alreadyPresent: items.filter((item) => item.saveStatus === "ALREADY_PRESENT").length,
    duplicateInScan: items.filter((item) => item.saveStatus === "DUPLICATE_IN_SCAN").length,
    unresolved: unresolvedCount,
  };
}

function normalizeScanResponseData(value: ScanResponseData | null | undefined): ScanResponseData | null {
  if (!value) {
    return null;
  }

  const reviewItems = Array.isArray(value.reviewItems) ? value.reviewItems : [];
  const unresolved = Array.isArray(value.unresolved) ? value.unresolved : [];
  const warnings = Array.isArray(value.warnings) ? value.warnings : [];
  const filesProcessed =
    typeof value.summary?.filesProcessed === "number" && Number.isFinite(value.summary.filesProcessed)
      ? value.summary.filesProcessed
      : 0;
  const detectedByOcr =
    typeof value.summary?.detectedByOcr === "number" && Number.isFinite(value.summary.detectedByOcr)
      ? value.summary.detectedByOcr
      : reviewItems.length;

  return {
    summary: {
      filesProcessed,
      detectedByOcr,
      readyToSave:
        typeof value.summary?.readyToSave === "number" && Number.isFinite(value.summary.readyToSave)
          ? value.summary.readyToSave
          : reviewItems.filter((item) => item.saveStatus === "READY").length,
      reviewRequired:
        typeof value.summary?.reviewRequired === "number" && Number.isFinite(value.summary.reviewRequired)
          ? value.summary.reviewRequired
          : reviewItems.filter((item) => item.saveStatus === "REVIEW_REQUIRED").length,
      alreadyPresent:
        typeof value.summary?.alreadyPresent === "number" && Number.isFinite(value.summary.alreadyPresent)
          ? value.summary.alreadyPresent
          : reviewItems.filter((item) => item.saveStatus === "ALREADY_PRESENT").length,
      duplicateInScan:
        typeof value.summary?.duplicateInScan === "number" && Number.isFinite(value.summary.duplicateInScan)
          ? value.summary.duplicateInScan
          : reviewItems.filter((item) => item.saveStatus === "DUPLICATE_IN_SCAN").length,
      unresolved:
        typeof value.summary?.unresolved === "number" && Number.isFinite(value.summary.unresolved)
          ? value.summary.unresolved
          : unresolved.length,
    },
    structured: {
      displayDate: typeof value.structured?.displayDate === "string" ? value.structured.displayDate : null,
      detectedEventDate:
        typeof value.structured?.detectedEventDate === "string" ? value.structured.detectedEventDate : null,
      previewText: typeof value.structured?.previewText === "string" ? value.structured.previewText : "",
    },
    reviewItems,
    unresolved,
    warnings,
    blocked: Boolean(value.blocked),
  };
}

function statusBadgeClassName(status: ScanReviewItem["saveStatus"]) {
  if (status === "READY") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700";
  if (status === "REVIEW_REQUIRED") return "border-amber-500/30 bg-amber-500/10 text-amber-700";
  if (status === "ALREADY_PRESENT") return "border-sky-500/25 bg-sky-500/10 text-sky-700";
  return "border-border/70 bg-muted/40 text-muted-foreground";
}

function statusLabel(status: ScanReviewItem["saveStatus"]) {
  if (status === "READY") return "Siap Simpan";
  if (status === "REVIEW_REQUIRED") return "Perlu Review";
  if (status === "ALREADY_PRESENT") return "Sudah Hadir";
  return "Duplikat Scan";
}

function resolutionMethodLabel(method: ScanReviewItem["resolutionMethod"]) {
  if (method === "new") return "peserta baru";
  if (method === "roster") return "roster";
  if (method === "phonetic") return "bunyi";
  if (method === "fuzzy") return "kemiripan";
  return "cocok persis";
}

function confidenceLabel(confidence: ScanReviewItem["confidence"]) {
  if (confidence === "high") return "Tinggi";
  if (confidence === "medium") return "Sedang";
  return "Rendah";
}

export function AttendanceOcrScanCard({ eventDate, deviceId, onCompleted, onDetectedDate }: Props) {
  const { showToast } = useToast();
  const cameraInputRef = React.useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = React.useState<File[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [clipboardLoading, setClipboardLoading] = React.useState(false);
  const [saveLoading, setSaveLoading] = React.useState(false);
  const [scanProgress, setScanProgress] = React.useState(0);
  const [scanMessage, setScanMessage] = React.useState("");
  const [inputKey, setInputKey] = React.useState(0);
  const [result, setResult] = React.useState<ScanResponseData | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const normalizedResult = React.useMemo(() => normalizeScanResponseData(result), [result]);

  const appendFiles = React.useCallback((incoming: File[]) => {
    setFiles((current) => mergeUniqueFiles(current, incoming));
  }, []);

  const handleReadClipboard = React.useCallback(async () => {
    if (!navigator.clipboard?.read) {
      showToast({ title: "Clipboard browser tidak didukung", description: "Gunakan Ctrl+V di area tempel." });
      return;
    }

    setClipboardLoading(true);
    try {
      const clipboardItems = await navigator.clipboard.read();
      const imageFiles: File[] = [];

      for (const item of clipboardItems) {
        const imageTypes = item.types.filter((type) => type.startsWith("image/"));
        for (const [index, type] of imageTypes.entries()) {
          const blob = await item.getType(type);
          imageFiles.push(createClipboardFile(blob, imageFiles.length + index));
        }
      }

      if (imageFiles.length === 0) {
        showToast({ title: "Clipboard belum berisi gambar" });
        return;
      }

      appendFiles(imageFiles);
    } catch (error) {
      console.error(error);
      showToast({ title: "Gagal membaca clipboard" });
    } finally {
      setClipboardLoading(false);
    }
  }, [appendFiles, showToast]);

  const handleScan = async () => {
    if (files.length === 0) {
      showToast({ title: "Pilih atau tempel minimal satu gambar" });
      return;
    }

    setLoading(true);
    setResult(null);
    setSelectedIds([]);

    try {
      const formData = new FormData();
      formData.append("eventDate", eventDate);
      for (const file of files) {
        formData.append("images", file);
      }

      const startRes = await fetch("/api/attendance/scan", { method: "POST", body: formData });
      const startData = await safeJson<ScanJobStartResponse>(startRes);
      if (!startData?.ok || !startData.jobId) {
        showToast({
          title: "Scan gagal dimulai",
          description:
            startData?.detail ||
            (startData?.error === "TOO_MANY_IMAGES" ? "Terlalu banyak gambar." : "Server menolak memulai scan."),
        });
        return;
      }

      let finalResult: ScanResponseData | null = null;

      for (let attempt = 0; attempt < 360; attempt += 1) {
        const response = await fetch(`/api/attendance/scan?id=${encodeURIComponent(startData.jobId)}`, {
          cache: "no-store",
        });
        const job = await safeJson<ScanJobStatusResponse>(response);
        const jobData = job?.data;
        if (!response.ok || !jobData) {
          throw new Error("SCAN_STATUS_FAILED");
        }

        setScanProgress(jobData.progress);
        setScanMessage(jobData.message);

        if (jobData.status === "completed") {
          finalResult = jobData.result ?? null;
          break;
        }

        if (jobData.status === "failed") {
          throw new Error(jobData.error || "OCR_SCAN_FAILED");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }

      if (!finalResult) {
        throw new Error("SCAN_TIMEOUT");
      }

      const nextResult = normalizeScanResponseData(finalResult);
      const defaultSelectedCount = (nextResult?.reviewItems ?? []).filter((item) => item.selectedByDefault).length;
      setResult(nextResult);
      setSelectedIds((nextResult?.reviewItems ?? []).filter((item) => item.selectedByDefault).map((item) => item.id));
      setFiles([]);
      setInputKey((value) => value + 1);

      showToast({
        title: "Scan selesai",
        description: finalResult.blocked
          ? "Hasil ada, tetapi belum cukup yakin untuk dipilih otomatis."
          : `${defaultSelectedCount} kandidat dari ringkasan dipilih untuk disimpan setelah review.`,
      });
    } catch (error) {
      console.error(error);
      showToast({
        title: "Scan gagal",
        description:
          error instanceof Error && error.message === "OCR_TIMEOUT"
            ? "Gambar terlalu buram atau terlalu berat diproses. Coba foto ulang dengan cahaya lebih baik."
            : "Terjadi error saat memproses gambar.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveReview = async () => {
    if (!normalizedResult) {
      return;
    }

    const selectedItems = normalizedResult.reviewItems.filter((item) => selectedIds.includes(item.id));
    if (selectedItems.length === 0) {
      showToast({ title: "Belum ada kandidat dipilih" });
      return;
    }

    setSaveLoading(true);
    try {
      const response = await fetch("/api/attendance/scan", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          eventDate,
          deviceId,
          selections: selectedItems.map((item) => ({
            participantId: item.participantId,
            participantName: item.participantName,
          })),
        }),
      });

      const payload = await safeJson<SaveReviewResponse>(response);
      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error("SAVE_REVIEW_FAILED");
      }

      const resultMap = new Map(payload.data.results.map((item) => [item.participantId, item]));
      const nextReviewItems = normalizedResult.reviewItems.map((item) => {
        if (!selectedIds.includes(item.id)) {
          return item;
        }

        const saved = resultMap.get(item.participantId);
        if (!saved) {
          return item;
        }

        return {
          ...item,
          saveStatus: saved.attendanceStatus === "SKIPPED" ? "REVIEW_REQUIRED" : "ALREADY_PRESENT",
          selectedByDefault: false,
          reason: saved.reason,
        } satisfies ScanReviewItem;
      });

      setResult({
        ...normalizedResult,
        reviewItems: nextReviewItems,
        warnings: Array.from(new Set([...normalizedResult.warnings, ...payload.data.warnings])),
        summary: buildSummaryFromReviewItems(
          nextReviewItems,
          normalizedResult.unresolved.length,
          normalizedResult.summary.filesProcessed,
          normalizedResult.summary.detectedByOcr,
        ),
      });
      setSelectedIds([]);
      onCompleted?.();

      showToast({
        title: "Presensi tersimpan",
        description: `${payload.data.summary.createdAttendance} presensi baru berhasil disimpan.`,
      });
    } catch (error) {
      console.error(error);
      showToast({
        title: "Gagal menyimpan hasil review",
        description: "Server tidak berhasil menyimpan presensi terpilih.",
        variant: "destructive",
      });
    } finally {
      setSaveLoading(false);
    }
  };

  return (
    <section className="site-soft-card mt-6 p-4 sm:mt-8 sm:p-6">
      <div className="flex flex-col gap-2">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
          <ScanLine size={14} />
          Scan OCR Presensi
        </div>
        <div>
          <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">Scan Foto Presensi Otomatis</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Upload foto, tempel dari clipboard, atau ambil dari kamera. Sistem akan memproses OCR dan AI dulu, lalu
            menampilkan daftar review. Presensi baru hanya disimpan setelah Anda klik tombol simpan review.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-[hsl(var(--foreground))]">
            <FileImage size={16} className="text-primary" />
            Upload / Tempel Gambar
          </label>
          <input
            key={inputKey}
            type="file"
            accept="image/*"
            multiple
            onChange={(event) => appendFiles(Array.from(event.target.files ?? []))}
            className="block w-full rounded-xl border border-dashed border-border bg-background/70 px-4 py-4 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => appendFiles(Array.from(event.target.files ?? []))}
          />
          <div
            tabIndex={0}
            onPaste={(event) => {
              const pastedFiles = Array.from(event.clipboardData.items)
                .filter((item) => item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((item): item is File => !!item);
              if (pastedFiles.length > 0) {
                event.preventDefault();
                appendFiles(pastedFiles);
              }
            }}
            className="mt-3 rounded-xl border border-dashed border-primary/35 bg-primary/5 px-4 py-4 text-sm outline-none transition focus:border-primary focus:bg-primary/10 focus:ring-2 focus:ring-primary/20"
          >
            <div className="flex items-center gap-2 font-semibold text-[hsl(var(--foreground))]">
              <Clipboard size={16} className="text-primary" />
              Area Tempel Clipboard
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Klik area ini lalu tekan Ctrl+V untuk menempel screenshot atau foto lembar presensi.
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {files.length === 0 ? (
              <span className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">
                Belum ada file dipilih
              </span>
            ) : (
              files.map((file) => (
                <div
                  key={`${file.name}-${file.lastModified}`}
                  className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                >
                  <span>{file.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setFiles((current) => current.filter((item) => fileSignature(item) !== fileSignature(file)))
                    }
                    className="rounded-full text-primary/80 transition hover:text-primary"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4">
          <Button
            variant="outline"
            onClick={handleReadClipboard}
            disabled={clipboardLoading || loading || saveLoading}
            type="button"
            className="h-12 w-full"
          >
            {clipboardLoading ? <RefreshCw size={16} className="animate-spin" /> : <Clipboard size={16} />}
            {clipboardLoading ? "Membaca clipboard..." : "Ambil dari Clipboard"}
          </Button>
          <Button
            variant="outline"
            onClick={() => cameraInputRef.current?.click()}
            disabled={loading || saveLoading}
            type="button"
            className="h-12 w-full"
          >
            <Camera size={16} />
            Ambil dari Kamera
          </Button>
          <Button
            onClick={handleScan}
            disabled={loading || saveLoading || files.length === 0}
            type="button"
            className="h-12 w-full"
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
            {loading ? `Memproses ${scanProgress}%` : "Scan & Review"}
          </Button>
          <Button
            variant="secondary"
            onClick={handleSaveReview}
            disabled={saveLoading || loading || selectedIds.length === 0 || !result}
            type="button"
            className="h-12 w-full"
          >
            {saveLoading ? <RefreshCw size={16} className="animate-spin" /> : <Save size={16} />}
            {saveLoading ? "Menyimpan..." : `Simpan Hasil Review (${selectedIds.length})`}
          </Button>
          {(loading || scanProgress > 0) && (
            <div className="space-y-1.5 rounded-xl border border-border/70 bg-background/70 px-3 py-3">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>{scanMessage || "Memproses scan..."}</span>
                <span className="font-semibold text-[hsl(var(--foreground))]">{scanProgress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)),hsl(var(--accent)))] transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, scanProgress))}%` }}
                />
              </div>
            </div>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Gunakan foto tegak, terang, dan seluruh tabel terlihat. Sistem akan mencoba baca tanggal header, kolom
            nomor, dan kolom nama, lalu hanya memilih otomatis hasil yang cukup yakin.
          </p>
        </div>
      </div>

      {normalizedResult ? (
        <div className="mt-5 space-y-4">
          {normalizedResult.warnings.length > 0 ? (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5" />
                <div>{normalizedResult.warnings.map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}</div>
              </div>
            </div>
          ) : null}

          {normalizedResult.blocked ? (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <SearchCheck size={16} className="mt-0.5" />
                <div>
                  <p className="font-semibold">Autofill diblok sementara.</p>
                  <p className="mt-1">
                    Hasil scan ada, tetapi belum cukup yakin untuk langsung dipilih. Anda masih bisa review manual atau
                    foto ulang agar tulisan lebih jelas.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {(normalizedResult.structured.displayDate || normalizedResult.structured.detectedEventDate || normalizedResult.structured.previewText) ? (
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <CalendarDays size={16} className="text-primary" />
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Ringkasan OCR Terstruktur</p>
                  </div>
                  {normalizedResult.structured.displayDate ? (
                    <p className="text-sm text-muted-foreground">
                      Header terbaca: <span className="font-semibold text-[hsl(var(--foreground))]">{normalizedResult.structured.displayDate}</span>
                    </p>
                  ) : null}
                  {normalizedResult.structured.detectedEventDate ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Tanggal terdeteksi: <span className="font-semibold text-[hsl(var(--foreground))]">{normalizedResult.structured.detectedEventDate}</span>
                    </p>
                  ) : null}
                </div>
                {normalizedResult.structured.detectedEventDate && onDetectedDate ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDetectedDate(normalizedResult.structured.detectedEventDate!)}
                  >
                    Pakai Tanggal Terdeteksi
                  </Button>
                ) : null}
              </div>
              {normalizedResult.structured.previewText ? (
                <pre className="mt-3 max-h-44 overflow-auto rounded-xl border border-border/60 bg-background/70 px-4 py-3 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap sm:max-h-52">
                  {normalizedResult.structured.previewText}
                </pre>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-primary" />
                  <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Daftar Review Presensi</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() =>
                      setSelectedIds(
                        normalizedResult.reviewItems
                          .filter((item) => item.saveStatus === "READY" || item.saveStatus === "REVIEW_REQUIRED")
                          .map((item) => item.id),
                      )
                    }
                  >
                    Pilih Semua Review
                  </Button>
                  <Button variant="ghost" size="sm" type="button" onClick={() => setSelectedIds([])}>
                    Kosongkan
                  </Button>
                </div>
              </div>
              <div className="max-h-[28rem] space-y-2.5 overflow-y-auto pr-1">
                {normalizedResult.reviewItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada kandidat peserta yang bisa direview.</p>
                ) : (
                  normalizedResult.reviewItems.map((item) => {
                    const checked = selectedIds.includes(item.id);
                    const disabled = item.saveStatus === "ALREADY_PRESENT" || item.saveStatus === "DUPLICATE_IN_SCAN";

                    return (
                      <label
                        key={item.id}
                        className="flex gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-3"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                          checked={checked}
                          disabled={disabled}
                          onChange={(event) => {
                            setSelectedIds((current) => {
                              if (event.target.checked) {
                                return current.includes(item.id) ? current : [...current, item.id];
                              }
                              return current.filter((value) => value !== item.id);
                            });
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-[hsl(var(--foreground))]">{item.participantName}</p>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClassName(item.saveStatus)}`}>
                              {statusLabel(item.saveStatus)}
                            </span>
                            <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                              Hal. {item.pageNumber}{item.rowNumber ? ` • Baris ${item.rowNumber}` : ""}
                            </span>
                            <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                              Confidence {confidenceLabel(item.confidence)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Terdeteksi sebagai: <span className="font-medium text-[hsl(var(--foreground))]">{item.sourceName}</span>
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Metode: <span className="font-medium text-[hsl(var(--foreground))]">{resolutionMethodLabel(item.resolutionMethod)}</span>
                            {typeof item.matchScore === "number" ? ` • skor ${item.matchScore.toFixed(2)}` : ""}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-600" />
                <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Perlu Cek Manual</p>
              </div>
              <div className="max-h-[28rem] space-y-2.5 overflow-y-auto pr-1">
                {normalizedResult.unresolved.length === 0 ? (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-sm text-emerald-700">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} />
                      Tidak ada teks yang ditahan untuk pengecekan manual.
                    </div>
                  </div>
                ) : (
                  normalizedResult.unresolved.map((item, index) => (
                    <div
                      key={`${item.pageNumber}-${item.rowNumber ?? "x"}-${item.sourceName}-${index}`}
                      className="rounded-xl border border-border/60 bg-background/60 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[hsl(var(--foreground))]">{item.sourceName}</p>
                        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                          Hal. {item.pageNumber}{item.rowNumber ? ` • Baris ${item.rowNumber}` : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
