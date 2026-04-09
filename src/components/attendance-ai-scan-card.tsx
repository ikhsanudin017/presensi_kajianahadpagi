"use client";

import * as React from "react";
import { AlertTriangle, Clipboard, FileImage, RefreshCw, Sparkles, Upload, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { safeJson } from "@/lib/http";
import { useToast } from "@/components/ui/use-toast";

type ScanSummary = {
  filesProcessed: number;
  detectedByAi: number;
  createdAttendance: number;
  alreadyPresent: number;
  createdParticipants: number;
  duplicateInUpload: number;
  unresolved: number;
};

type ScanResultItem = {
  pageNumber: number;
  sourceName: string;
  participantName: string;
  participantId: string;
  participantStatus: "EXISTING" | "CREATED";
  attendanceStatus: "CREATED" | "ALREADY_PRESENT" | "DUPLICATE_IN_UPLOAD";
  confidence: "high" | "medium" | "low";
  resolutionMethod: "exact" | "phonetic" | "fuzzy" | "created";
  reason: string;
};

type UnresolvedItem = {
  pageNumber: number;
  sourceName: string;
  reason: string;
};

type ScanResponse = {
  ok?: boolean;
  error?: string;
  detail?: string;
  data?: {
    summary: ScanSummary;
    results: ScanResultItem[];
    unresolved: UnresolvedItem[];
    warnings: string[];
  };
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
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    progress: number;
    message: string;
    result?: ScanResponse["data"];
    error?: string;
  };
};

type Props = {
  eventDate: string;
  deviceId?: string | null;
  onCompleted?: () => void;
};

function fileSignature(file: File) {
  return [file.name || "clipboard-image", file.size, file.type, file.lastModified].join(":");
}

function extensionFromMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/heic") return "heic";
  if (normalized === "image/heif") return "heif";
  if (normalized === "image/gif") return "gif";
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

function normalizeIncomingFiles(incoming: File[]) {
  return incoming.map((file, index) =>
    file.name
      ? file
      : new File([file], `upload-${Date.now()}-${index + 1}.${extensionFromMimeType(file.type || "image/png")}`, {
          type: file.type || "image/png",
          lastModified: file.lastModified || Date.now() + index,
        }),
  );
}

function mergeUniqueFiles(current: File[], incoming: File[]) {
  const merged = new Map<string, File>();

  for (const file of [...current, ...normalizeIncomingFiles(incoming)]) {
    merged.set(fileSignature(file), file);
  }

  return Array.from(merged.values());
}

const PREPARED_IMAGE_MAX_SIDE = 2200;
const PREPARED_IMAGE_MAX_UPSCALE = 3;

function baseNameWithoutExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "") || "image";
}

async function renderPreparedImageFile(params: {
  bitmap: ImageBitmap;
  cropX: number;
  cropWidth: number;
  cropY: number;
  cropHeight: number;
  fileName: string;
  lastModified: number;
}) {
  const dominantSide = Math.max(params.cropWidth, params.cropHeight);
  const scale = Math.min(PREPARED_IMAGE_MAX_UPSCALE, PREPARED_IMAGE_MAX_SIDE / dominantSide);
  const targetWidth = Math.max(1, Math.round(params.cropWidth * scale));
  const targetHeight = Math.max(1, Math.round(params.cropHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("CANVAS_CONTEXT_UNAVAILABLE");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(
    params.bitmap,
    params.cropX,
    params.cropY,
    params.cropWidth,
    params.cropHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.88);
  });

  if (!blob) {
    throw new Error("IMAGE_EXPORT_FAILED");
  }

  return new File([blob], params.fileName, {
    type: "image/jpeg",
    lastModified: params.lastModified,
  });
}

async function prepareImageFilesForUpload(file: File) {
  if (!file.type.startsWith("image/") || typeof window === "undefined") {
    return [file];
  }

  let bitmap: ImageBitmap | null = null;

  try {
    bitmap = await createImageBitmap(file);
    const sourceBitmap = bitmap;
    const baseName = baseNameWithoutExtension(file.name);
    const portraitRatio = sourceBitmap.height / Math.max(sourceBitmap.width, 1);
    const shouldSplit = portraitRatio >= 1.1 && sourceBitmap.height >= 800;
    const segmentCount = shouldSplit ? (portraitRatio >= 1.45 ? 5 : portraitRatio >= 1.2 ? 4 : 3) : 1;
    const overlapPx = segmentCount > 1 ? Math.round(sourceBitmap.height * 0.12) : 0;
    const segmentHeight =
      segmentCount > 1
        ? Math.ceil((sourceBitmap.height + overlapPx * (segmentCount - 1)) / segmentCount)
        : sourceBitmap.height;
    const cropStarts = Array.from({ length: segmentCount }, (_, index) => {
      if (segmentCount === 1) {
        return 0;
      }

      const idealStart = Math.round((index * (sourceBitmap.height - segmentHeight)) / (segmentCount - 1));
      return Math.max(0, Math.min(sourceBitmap.height - segmentHeight, idealStart));
    }).filter((start, index, list) => index === 0 || start !== list[index - 1]);
    const useNameFocusedCrop = shouldSplit;
    const cropX = 0;
    const cropWidth = useNameFocusedCrop
      ? Math.max(1, Math.min(sourceBitmap.width, Math.round(sourceBitmap.width * 0.74)))
      : sourceBitmap.width;

    return await Promise.all(
      cropStarts.map((cropY, index) =>
        renderPreparedImageFile({
          bitmap: sourceBitmap,
          cropX,
          cropWidth,
          cropY,
          cropHeight: Math.min(segmentHeight, sourceBitmap.height - cropY),
          fileName:
            cropStarts.length === 1
              ? `${baseName}.jpg`
              : `${baseName}__nama-bagian-${index + 1}-dari-${cropStarts.length}.jpg`,
          lastModified: (file.lastModified || Date.now()) + index,
        }),
      ),
    );
  } catch {
    return [file];
  } finally {
    bitmap?.close();
  }
}

export function AttendanceAiScanCard({ eventDate, deviceId, onCompleted }: Props) {
  const { showToast } = useToast();
  const [files, setFiles] = React.useState<File[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [clipboardLoading, setClipboardLoading] = React.useState(false);
  const [preparingFiles, setPreparingFiles] = React.useState(false);
  const [scanProgress, setScanProgress] = React.useState(0);
  const [scanMessage, setScanMessage] = React.useState("");
  const [inputKey, setInputKey] = React.useState(0);
  const [result, setResult] = React.useState<ScanResponse["data"] | null>(null);
  const pasteAreaRef = React.useRef<HTMLDivElement | null>(null);

  const appendFiles = React.useCallback(async (incoming: File[]) => {
    if (incoming.length === 0) {
      return;
    }

    setFiles((current) => mergeUniqueFiles(current, incoming));
  }, []);

  const removeFile = React.useCallback((target: File) => {
    setFiles((current) => current.filter((file) => fileSignature(file) !== fileSignature(target)));
  }, []);

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      const pastedFiles = Array.from(event.clipboardData.items)
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((item): item is File => !!item);

      if (pastedFiles.length === 0) {
        showToast({
          title: "Clipboard belum berisi gambar",
          description: "Copy screenshot atau foto dulu, lalu tempel di area ini.",
          variant: "warning",
        });
        return;
      }

      event.preventDefault();
      void appendFiles(pastedFiles);
      showToast({
        title: "Gambar ditempel",
        description: `${pastedFiles.length} gambar masuk ke antrean scan.`,
      });
    },
    [appendFiles, showToast],
  );

  const handleReadClipboard = React.useCallback(async () => {
    if (!navigator.clipboard?.read) {
      showToast({
        title: "Clipboard browser tidak didukung",
        description: "Pakai Ctrl+V di area tempel jika tombol ini tidak tersedia.",
        variant: "warning",
      });
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
        showToast({
          title: "Clipboard belum berisi gambar",
          description: "Copy screenshot atau foto dulu, lalu coba lagi.",
          variant: "warning",
        });
        return;
      }

      await appendFiles(imageFiles);
      showToast({
        title: "Gambar dari clipboard ditambahkan",
        description: `${imageFiles.length} gambar siap discan.`,
      });
    } catch (error) {
      console.error(error);
      showToast({
        title: "Gagal membaca clipboard",
        description: "Izinkan akses clipboard atau gunakan Ctrl+V di area tempel.",
      });
    } finally {
      setClipboardLoading(false);
    }
  }, [appendFiles, showToast]);

  const handleSubmit = async () => {
    if (preparingFiles) {
      showToast({
        title: "Gambar masih diproses",
        description: "Tunggu sebentar sampai optimasi gambar selesai.",
      });
      return;
    }

    if (files.length === 0) {
      showToast({ title: "Pilih atau tempel minimal satu gambar" });
      return;
    }

    setLoading(true);
    setScanProgress(0);
    setScanMessage("Menyiapkan gambar...");
    try {
      setPreparingFiles(true);
      const uploadFiles: File[] = [];

      try {
        for (let index = 0; index < files.length; index += 1) {
          setScanProgress(Math.max(2, Math.min(10, 2 + Math.round(((index + 1) / files.length) * 8))));
          setScanMessage(`Menyiapkan gambar ${index + 1} dari ${files.length}...`);
          const preparedFiles = await prepareImageFilesForUpload(files[index]);
          uploadFiles.push(...preparedFiles);
        }
      } finally {
        setPreparingFiles(false);
      }

      setScanProgress(10);
      setScanMessage(
        uploadFiles.length > files.length
          ? `Gambar siap. ${files.length} halaman dipecah menjadi ${uploadFiles.length} bagian agar baris kecil lebih mudah terbaca.`
          : "Menyiapkan upload...",
      );

      const formData = new FormData();
      formData.append("eventDate", eventDate);
      if (deviceId) {
        formData.append("deviceId", deviceId);
      }
      for (const file of uploadFiles) {
        formData.append("images", file);
      }

      const startScanJob = () =>
        new Promise<ScanJobStartResponse>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/attendance/scan");
          xhr.responseType = "text";

          xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) {
              return;
            }
            const uploadProgress = Math.max(3, Math.min(15, Math.round((event.loaded / event.total) * 15)));
            setScanProgress(uploadProgress);
            setScanMessage("Mengunggah gambar ke server...");
          };

          xhr.onerror = () => reject(new Error("UPLOAD_FAILED"));
          xhr.onload = () => {
            try {
              resolve(JSON.parse(xhr.responseText || "{}") as ScanJobStartResponse);
            } catch {
              reject(new Error("INVALID_START_RESPONSE"));
            }
          };

          xhr.send(formData);
        });

      const startResponse = await startScanJob();
      if (!startResponse.ok || !startResponse.jobId) {
        showToast({
          title: "Scan AI gagal dimulai",
          description: startResponse.detail || "Server tidak mengembalikan job scan.",
        });
        return;
      }

      setScanProgress(16);
      setScanMessage("Upload selesai. Menunggu proses scan...");

      let finalResult: ScanResponse["data"] | null = null;

      for (let attempt = 0; attempt < 180; attempt += 1) {
        const response = await fetch(`/api/attendance/scan?id=${encodeURIComponent(startResponse.jobId)}`, {
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
          throw new Error(jobData.error || "AI_SCAN_FAILED");
        }

        await new Promise((resolve) => window.setTimeout(resolve, 900));
      }

      if (!finalResult) {
        throw new Error("SCAN_TIMEOUT");
      }

      setScanProgress(100);
      setScanMessage("Scan selesai.");
      setResult(finalResult);
      setFiles([]);
      setInputKey((value) => value + 1);
      pasteAreaRef.current?.focus();
      onCompleted?.();

      showToast({
        title: "Scan AI selesai",
        description: `${finalResult.summary.createdAttendance} presensi baru tersimpan dari ${uploadFiles.length} gambar analisis.`,
      });

      if (finalResult.warnings[0]) {
        showToast({
          title: "Perlu dicek",
          description: finalResult.warnings[0],
          variant: "warning",
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "AI_SCAN_FAILED";
      const isGeminiBusy = errorMessage === "GEMINI_TEMPORARILY_UNAVAILABLE";

      if (!isGeminiBusy && errorMessage !== "SCAN_TIMEOUT") {
        console.error(error);
      }

      showToast({
        title: "Scan AI gagal",
        description:
          errorMessage === "SCAN_TIMEOUT"
            ? "Proses scan terlalu lama. Coba ulangi dengan gambar lebih sedikit."
            : isGeminiBusy
              ? "Gemini sedang sibuk. Sistem sudah mencoba ulang beberapa kali, tetapi provider masih penuh. Coba lagi beberapa menit."
              : "Terjadi error saat memproses gambar.",
      });
    } finally {
      setPreparingFiles(false);
      setLoading(false);
    }
  };

  return (
    <section className="site-soft-card mt-6 p-4 sm:mt-8 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
            <Sparkles size={14} />
            Scan AI
          </div>
          <div>
            <h3 className="site-title text-xl text-[hsl(var(--foreground))] md:text-2xl">
              Scan Foto Presensi Otomatis
            </h3>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Upload satu atau beberapa foto lembar absensi. Sistem akan membaca semua nama yang tertulis pada lembar,
              mencocokkan variasi seperti `Ikhsan / Ihsan / Isan`, lalu menambah peserta baru bila memang belum ada.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
          Tanggal scan: <span className="font-semibold text-[hsl(var(--foreground))]">{eventDate}</span>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
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
            onChange={(event) => {
              void appendFiles(Array.from(event.target.files ?? []));
            }}
            className="block w-full rounded-xl border border-dashed border-border bg-background/70 px-4 py-4 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground"
          />
          <div
            ref={pasteAreaRef}
            tabIndex={0}
            onPaste={handlePaste}
            className="mt-3 rounded-xl border border-dashed border-primary/35 bg-primary/5 px-4 py-4 text-sm outline-none transition focus:border-primary focus:bg-primary/10 focus:ring-2 focus:ring-primary/20"
          >
            <div className="flex items-center gap-2 font-semibold text-[hsl(var(--foreground))]">
              <Clipboard size={16} className="text-primary" />
              Area Tempel Clipboard
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Klik area ini lalu tekan <span className="font-semibold text-[hsl(var(--foreground))]">Ctrl+V</span> untuk
              menempel screenshot atau foto yang sudah Anda copy.
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {preparingFiles ? (
              <span className="rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs text-primary">
                Menyiapkan gambar...
              </span>
            ) : files.length === 0 ? (
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
                    onClick={() => removeFile(file)}
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

        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4">
          <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Aksi</p>
          <Button
            variant="outline"
            onClick={handleReadClipboard}
            disabled={clipboardLoading || preparingFiles || loading}
            type="button"
            className="h-12 w-full"
          >
            {clipboardLoading ? (
              <span className="flex items-center gap-2">
                <RefreshCw size={16} className="animate-spin" />
                Membaca clipboard...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Clipboard size={16} />
                Ambil dari Clipboard
              </span>
            )}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={loading || preparingFiles || files.length === 0}
            type="button"
            className="h-12 w-full"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <RefreshCw size={16} className="animate-spin" />
                Memproses {scanProgress}%
              </span>
            ) : preparingFiles ? (
              <span className="flex items-center gap-2">
                <RefreshCw size={16} className="animate-spin" />
                Menyiapkan gambar...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Upload size={16} />
                Scan & Simpan
              </span>
            )}
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
          <Button
            variant="ghost"
            onClick={() => {
              setFiles([]);
              setInputKey((value) => value + 1);
            }}
            disabled={files.length === 0 || preparingFiles || loading}
            type="button"
            className="h-11 w-full"
          >
            Kosongkan Daftar Gambar
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Anda bisa pilih file biasa, klik tombol clipboard, atau langsung tempel gambar. Gunakan foto yang cukup
            terang dan satu halaman terlihat utuh supaya AI lebih stabil membaca nama dan tanda tangan. Halaman potret
            yang panjang sekarang akan otomatis dipotong dan di-zoom sebelum dikirim supaya baris kecil tidak mudah
            terlewat.
          </p>
        </div>
      </div>

      {result ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Presensi Baru</p>
              <p className="mt-2 text-2xl font-bold text-[hsl(var(--foreground))]">{result.summary.createdAttendance}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Sudah Hadir</p>
              <p className="mt-2 text-2xl font-bold text-[hsl(var(--foreground))]">{result.summary.alreadyPresent}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Peserta Baru</p>
              <p className="mt-2 text-2xl font-bold text-[hsl(var(--foreground))]">{result.summary.createdParticipants}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Butuh Cek Manual</p>
              <p className="mt-2 text-2xl font-bold text-[hsl(var(--foreground))]">{result.summary.unresolved}</p>
            </div>
          </div>

          {result.warnings.length > 0 ? (
            <div className="rounded-2xl border border-amber-400/40 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5" />
                <div className="space-y-1">
                  {result.warnings.map((warning, index) => (
                    <p key={`${warning}-${index}`}>{warning}</p>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Users size={16} className="text-primary" />
                <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Hasil Scan</p>
              </div>
              <div className="space-y-2.5">
                {result.results.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Belum ada nama yang berhasil diproses otomatis.</p>
                ) : (
                  result.results.map((item) => (
                    <div key={`${item.pageNumber}-${item.participantId}-${item.sourceName}`} className="rounded-xl border border-border/60 bg-background/60 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[hsl(var(--foreground))]">{item.participantName}</p>
                        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                          Hal. {item.pageNumber}
                        </span>
                        <span className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          {item.attendanceStatus === "CREATED"
                            ? "Presensi dibuat"
                            : item.attendanceStatus === "ALREADY_PRESENT"
                              ? "Sudah hadir"
                              : "Duplikat upload"}
                        </span>
                        {item.participantStatus === "CREATED" ? (
                          <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            <span className="inline-flex items-center gap-1">
                              <UserPlus size={12} />
                              Peserta baru
                            </span>
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Terdeteksi sebagai: <span className="font-medium text-[hsl(var(--foreground))]">{item.sourceName}</span>
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-card/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle size={16} className="text-amber-600" />
                <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Perlu Cek Manual</p>
              </div>
              <div className="space-y-2.5">
                {result.unresolved.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Tidak ada nama yang ditahan untuk pengecekan manual.</p>
                ) : (
                  result.unresolved.map((item, index) => (
                    <div key={`${item.pageNumber}-${item.sourceName}-${index}`} className="rounded-xl border border-border/60 bg-background/60 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[hsl(var(--foreground))]">{item.sourceName}</p>
                        <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                          Hal. {item.pageNumber}
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
