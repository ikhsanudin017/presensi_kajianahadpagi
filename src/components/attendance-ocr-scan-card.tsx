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

type PuterAttendanceRow = {
  rowNumber?: number | null;
  name?: string | null;
  addressHint?: string | null;
  hasSignature?: boolean | string | null;
  signatureStatus?: "signed" | "empty" | "uncertain" | string | null;
  confidence?: number | null;
};

type PuterPageResult = {
  pageNumber: number;
  displayDate?: string | null;
  detectedDate?: string | null;
  normalizedTranscript?: string | null;
  signedRowNumbers?: Array<number | string> | null;
  rows?: PuterAttendanceRow[] | null;
  notes?: string | null;
};

type PuterResolveResponse = {
  ok?: boolean;
  data?: ScanResponseData;
  error?: string;
  detail?: string;
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

const PUTER_SCRIPT_SRC = "https://js.puter.com/v2/";
const PUTER_GEMINI_MODEL = "gemini-2.5-flash";
const PUTER_RESOLVE_TIMEOUT_MS = 90_000;

declare global {
  interface Window {
    puter?: {
      ai?: {
        chat?: (...args: unknown[]) => Promise<unknown>;
      };
    };
  }
}

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

function loadPuterScript() {
  if (window.puter?.ai?.chat) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PUTER_SCRIPT_SRC}"]`);

    const timeout = window.setTimeout(() => {
      reject(new Error("PUTER_LOAD_TIMEOUT"));
    }, 20000);

    const finish = () => {
      window.clearTimeout(timeout);
      if (window.puter?.ai?.chat) {
        resolve();
      } else {
        reject(new Error("PUTER_NOT_AVAILABLE"));
      }
    };

    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => reject(new Error("PUTER_LOAD_FAILED")), { once: true });
      if (window.puter?.ai?.chat) {
        finish();
      }
      return;
    }

    const script = document.createElement("script");
    script.src = PUTER_SCRIPT_SRC;
    script.async = true;
    script.onload = finish;
    script.onerror = () => reject(new Error("PUTER_LOAD_FAILED"));
    document.head.appendChild(script);
  });
}

function extractPuterResponseText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(extractPuterResponseText).filter(Boolean).join("\n");
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
    if (typeof record.message === "string") {
      return record.message;
    }
    if (Array.isArray(record.content)) {
      return record.content.map(extractPuterResponseText).filter(Boolean).join("\n");
    }
    const message = record.message;
    if (message) {
      const text = extractPuterResponseText(message);
      if (text) {
        return text;
      }
    }
    const output = record.output;
    if (output) {
      const text = extractPuterResponseText(output);
      if (text) {
        return text;
      }
    }
    const choices = record.choices;
    if (choices) {
      const text = extractPuterResponseText(choices);
      if (text) {
        return text;
      }
    }
  }

  return "";
}

function parseJsonObject<T>(raw: string): T | null {
  const cleaned = raw.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonText = (fenced?.[1] || cleaned).trim();
  const firstObject = jsonText.indexOf("{");
  const lastObject = jsonText.lastIndexOf("}");

  if (firstObject < 0 || lastObject <= firstObject) {
    return null;
  }

  try {
    return JSON.parse(jsonText.slice(firstObject, lastObject + 1)) as T;
  } catch {
    return null;
  }
}

function buildPuterPrompt(pageNumber: number, mode: "signedRows" | "allRows" = "signedRows") {
  if (mode === "allRows") {
    return [
      "Anda membaca foto lembar presensi pengajian.",
      "Mode fallback: baca semua baris nama peserta yang terlihat.",
      "Untuk setiap baris, isi signatureStatus: signed, empty, atau uncertain berdasarkan kolom TTD pada garis horizontal baris yang sama.",
      "Jangan menebak nama dari alamat, nomor telepon, header, atau tanda tangan.",
      "Rapikan ejaan nama hanya jika sangat jelas dari tulisan cetak pada kolom Nama.",
      "Keluarkan hanya JSON valid tanpa markdown.",
      "Schema:",
      '{"displayDate":null,"detectedDate":null,"normalizedTranscript":"1. Warto\\n2. Hamdani","rows":[{"rowNumber":1,"name":"Warto","addressHint":"Sawit","hasSignature":true,"signatureStatus":"signed","confidence":0.96},{"rowNumber":2,"name":"Hamdani","addressHint":"Sawit","hasSignature":false,"signatureStatus":"empty","confidence":0.9}],"notes":""}',
      `Nomor halaman gambar ini: ${pageNumber}.`,
    ].join("\n");
  }

  return [
    "Anda membaca foto lembar presensi pengajian.",
    "Tugas utama: ambil hanya peserta yang hadir berdasarkan kolom TTD.",
    "Untuk setiap tanda tangan/coretan/tulisan di kolom TTD paling kanan, tarik garis horizontal lurus ke kiri pada baris tabel yang sama, lalu baca nomor dan nama pada baris itu.",
    "Nama yang dikembalikan HARUS sejajar satu baris dengan tanda tangan. Jangan memakai nama dari baris atas atau baris bawah.",
    "Jika tanda tangan berada di baris 2, nama harus dari baris 2; jika baris 3 kosong TTD, jangan ambil nama baris 3.",
    "Jika coretan TTD melewati garis batas, pilih baris tempat pusat/coretan dominan berada. Jika masih ragu antara dua baris, jangan masukkan baris itu.",
    "Jangan hitung garis tabel, bayangan, noda kertas, nomor halaman, atau tulisan pada kolom Nama/Alamat/No TLPHN sebagai tanda tangan.",
    "Jangan masukkan baris yang kolom TTD-nya kosong.",
    "Jangan menebak nama dari alamat, nomor telepon, header, atau tanda tangan.",
    "Jumlah rows harus sama dengan jumlah sel TTD yang benar-benar terisi tanda tangan/coretan.",
    'Semua row yang dikembalikan wajib hasSignature true dan signatureStatus "signed".',
    "Rapikan ejaan nama hanya jika sangat jelas dari tulisan cetak pada kolom Nama.",
    "Keluarkan hanya JSON valid tanpa markdown.",
    "Schema:",
    '{"displayDate":null,"detectedDate":null,"normalizedTranscript":"1. Warto\\n3. Sakiman","rows":[{"rowNumber":1,"name":"Warto","addressHint":"Sawit","hasSignature":true,"signatureStatus":"signed","confidence":0.96},{"rowNumber":3,"name":"Sakiman","addressHint":"Dupuk","hasSignature":true,"signatureStatus":"signed","confidence":0.94}],"notes":"Jumlah rows = jumlah TTD terisi."}',
    `Nomor halaman gambar ini: ${pageNumber}.`,
  ].join("\n");
}

async function requestPuterGeminiPage(file: File, pageNumber: number, mode: "signedRows" | "allRows") {
  const response = await window.puter?.ai?.chat?.(
    buildPuterPrompt(pageNumber, mode),
    file,
    { model: PUTER_GEMINI_MODEL },
  );
  const text = extractPuterResponseText(response);
  return parseJsonObject<Omit<PuterPageResult, "pageNumber">>(text);
}

async function scanFileWithPuterGemini(file: File, pageNumber: number) {
  let parsed = await requestPuterGeminiPage(file, pageNumber, "signedRows");

  if (!parsed || !Array.isArray(parsed.rows)) {
    throw new Error("PUTER_GEMINI_PARSE_FAILED");
  }

  const readableRows = parsed.rows.filter((row) => row?.name);
  if (readableRows.length === 0) {
    const fallbackParsed = await requestPuterGeminiPage(file, pageNumber, "allRows");
    if (fallbackParsed && Array.isArray(fallbackParsed.rows) && fallbackParsed.rows.some((row) => row?.name)) {
      parsed = {
        ...fallbackParsed,
        notes: [parsed.notes, fallbackParsed.notes, "Fallback semua baris nama dipakai karena hasil awal kosong."]
          .filter(Boolean)
          .join(" "),
      };
    }
  }

  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  return {
    pageNumber,
    ...parsed,
    notes: [
      parsed.notes,
      `Scan sejajar TTD membaca ${rows.filter((row) => row?.name).length} baris bertanda tangan.`,
    ]
      .filter(Boolean)
      .join(" "),
    rows: rows.filter((row) => row?.name),
  } satisfies PuterPageResult;
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
      setScanProgress(5);
      setScanMessage("Memuat Puter Gemini...");
      await loadPuterScript();

      const pages: PuterPageResult[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const pageNumber = index + 1;
        setScanProgress(10 + Math.round((index / Math.max(files.length, 1)) * 65));
        setScanMessage(`Puter Gemini membaca TTD sejajar halaman ${pageNumber}/${files.length}...`);
        pages.push(await scanFileWithPuterGemini(files[index], pageNumber));
      }

      const totalRows = pages.reduce((count, page) => count + (page.rows?.length ?? 0), 0);
      setScanProgress(82);
      setScanMessage(`Menyusun daftar review ${totalRows} baris...`);
      const resolveController = new AbortController();
      const resolveTimeoutId = window.setTimeout(() => resolveController.abort(), PUTER_RESOLVE_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch("/api/attendance/scan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: resolveController.signal,
          body: JSON.stringify({
            provider: "puter-gemini",
            eventDate,
            pages,
          }),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw new Error("Server terlalu lama menyusun review. Coba scan ulang atau kurangi jumlah gambar.");
        }

        throw error;
      } finally {
        window.clearTimeout(resolveTimeoutId);
      }
      const payload = await safeJson<PuterResolveResponse>(response);
      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(payload?.detail || payload?.error || "PUTER_SCAN_RESOLVE_FAILED");
      }

      const nextResult = normalizeScanResponseData(payload.data);
      const defaultSelectedCount = (nextResult?.reviewItems ?? []).filter((item) => item.selectedByDefault).length;
      setResult(nextResult);
      setSelectedIds((nextResult?.reviewItems ?? []).filter((item) => item.selectedByDefault).map((item) => item.id));
      setFiles([]);
      setInputKey((value) => value + 1);
      setScanProgress(100);
      setScanMessage("Scan selesai. Review hasil sebelum disimpan.");

      showToast({
        title: "Scan selesai",
        description: nextResult?.blocked
          ? "Hasil ada, tetapi belum cukup yakin untuk dipilih otomatis."
          : `${defaultSelectedCount} kandidat dari ringkasan dipilih untuk disimpan setelah review.`,
      });
    } catch (error) {
      console.error(error);
      showToast({
        title: "Scan gagal",
        description:
          error instanceof Error
            ? error.message
            : "Puter Gemini tidak berhasil memproses gambar.",
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
          Scan Foto Presensi
        </div>
        <div>
          <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">Baca Foto Presensi</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Unggah foto, tempel gambar, atau ambil dari kamera. Hasil scan tetap masuk ke daftar review sebelum disimpan.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
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
                  className="inline-flex max-w-full items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                >
                  <span className="max-w-[min(18rem,70vw)] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setFiles((current) => current.filter((item) => fileSignature(item) !== fileSignature(file)))
                    }
                    className="rounded-full text-primary/80 transition hover:text-primary"
                    aria-label={`Hapus ${file.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 order-first md:order-none">
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
            {loading ? `Memproses ${scanProgress}%` : "Scan Puter Gemini"}
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

          <div className="grid gap-4 md:grid-cols-1 lg:grid-cols-2">
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
                              Hal. {item.pageNumber}{item.rowNumber ? ` - Baris ${item.rowNumber}` : ""}
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
                            {typeof item.matchScore === "number" ? ` - skor ${item.matchScore.toFixed(2)}` : ""}
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
                          Hal. {item.pageNumber}{item.rowNumber ? ` - Baris ${item.rowNumber}` : ""}
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
