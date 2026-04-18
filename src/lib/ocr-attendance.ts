import { createWorker, type RecognizeResult, type Worker } from "tesseract.js";
import {
  looksLikeHumanName,
  sanitizeDetectedName,
  toDisplayPersonName,
} from "@/lib/name-matching";

type ParticipantContext = {
  name: string;
  address?: string | null;
};

export type AttendanceScanImageInput = {
  name: string;
  mimeType: string;
  base64Image: string;
};

export type DetectedAttendanceCandidate = {
  pageNumber: number;
  sourceName: string;
  resolvedName: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  addressHint?: string;
};

export type AttendanceOcrScanResult = {
  attendees: DetectedAttendanceCandidate[];
  skipped: Array<{
    pageNumber: number;
    sourceName: string;
    reason: string;
  }>;
  notes: string[];
};

type ParsedLine = {
  pageNumber: number;
  name: string;
  addressHint?: string;
  confidence: "high" | "medium" | "low";
  raw: string;
};

const HEADER_TOKENS = ["pengajian", "nama", "alamat", "telephone", "tanda tangan", "ttd", "no"];
const ADDRESS_WORDS = [
  "sawit",
  "dupok",
  "mulyosari",
  "ngandong",
  "gayamprit",
  "dalem",
  "jetis",
  "korang",
  "jenun",
  "tegalsi",
  "ngereyan",
];

function base64ToBuffer(base64Image: string) {
  return Buffer.from(base64Image, "base64");
}

function toConfidenceLabel(value: number) {
  if (value >= 85) return "high";
  if (value >= 60) return "medium";
  return "low";
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isHeaderLine(value: string) {
  const normalized = value.toLowerCase();
  return HEADER_TOKENS.some((token) => normalized.includes(token));
}

function cleanupNamePart(value: string) {
  return sanitizeDetectedName(
    value
      .replace(/[|[\]{}<>_*~`]+/g, " ")
      .replace(/\b(?:dusun|dukuh|rt|rw|wa|hp)\b.*$/i, " ")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

function splitNameAndAddress(rawLine: string) {
  const withoutNumber = rawLine.replace(/^\s*\d{1,3}[\.\)\-:]*\s*/, "").trim();
  const normalized = withoutNumber.replace(/\t+/g, " ").replace(/\s{2,}/g, "  ");
  const doubleSpaceParts = normalized
    .split(/\s{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (doubleSpaceParts.length >= 2) {
    return {
      name: cleanupNamePart(doubleSpaceParts[0]),
      addressHint: normalizeWhitespace(doubleSpaceParts.slice(1).join(" ")),
    };
  }

  const lower = normalized.toLowerCase();
  for (const addressWord of ADDRESS_WORDS) {
    const index = lower.indexOf(addressWord);
    if (index > 1) {
      return {
        name: cleanupNamePart(normalized.slice(0, index)),
        addressHint: normalizeWhitespace(normalized.slice(index)),
      };
    }
  }

  return {
    name: cleanupNamePart(normalized),
    addressHint: undefined,
  };
}

function parseRecognizedText(pageNumber: number, recognition: RecognizeResult) {
  const parsed: ParsedLine[] = [];
  const unresolved: AttendanceOcrScanResult["skipped"] = [];

  for (const line of recognition.data.lines) {
    const raw = normalizeWhitespace(line.text);
    if (!raw || raw.length < 2 || isHeaderLine(raw)) {
      continue;
    }

    const { name, addressHint } = splitNameAndAddress(raw);
    if (!looksLikeHumanName(name)) {
      if (/^\d{1,3}/.test(raw)) {
        unresolved.push({
          pageNumber,
          sourceName: raw,
          reason: "Baris terdeteksi, tetapi nama belum cukup jelas untuk diproses otomatis.",
        });
      }
      continue;
    }

    parsed.push({
      pageNumber,
      name: toDisplayPersonName(name),
      addressHint,
      confidence: toConfidenceLabel(line.confidence),
      raw,
    });
  }

  return { parsed, unresolved };
}

async function createAttendanceWorker() {
  const worker = await createWorker("eng");
  await worker.setParameters({
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1",
  });
  return worker;
}

async function recognizeImage(worker: Worker, buffer: Buffer) {
  return await worker.recognize(buffer);
}

function dedupeCandidates(candidates: ParsedLine[], participants: ParticipantContext[]) {
  const existingNames = new Set(participants.map((participant) => participant.name.toLowerCase().trim()));
  const seen = new Set<string>();
  const results: ParsedLine[] = [];

  for (const candidate of candidates) {
    const key = candidate.name.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const shouldKeepShortName = key.length >= 4 || existingNames.has(key);
    if (!shouldKeepShortName) {
      continue;
    }

    results.push(candidate);
  }

  return results;
}

export async function scanAttendanceImagesWithOcr(params: {
  images: AttendanceScanImageInput[];
  participants: ParticipantContext[];
  onProgress?: (progress: {
    pageNumber: number;
    totalPages: number;
    progress: number;
    message: string;
  }) => void;
}) {
  const attendees: DetectedAttendanceCandidate[] = [];
  const skipped: AttendanceOcrScanResult["skipped"] = [];
  const notes: string[] = [];
  const totalPages = Math.max(params.images.length, 1);
  const worker = await createAttendanceWorker();

  try {
    for (let index = 0; index < params.images.length; index += 1) {
      const image = params.images[index];
      const pageNumber = index + 1;
      const pageBaseProgress = 18 + (index / totalPages) * 42;

      params.onProgress?.({
        pageNumber,
        totalPages,
        progress: pageBaseProgress,
        message: `Membaca halaman ${pageNumber} dari ${totalPages} dengan OCR gratis...`,
      });

      const buffer = base64ToBuffer(image.base64Image);
      const recognition = await recognizeImage(worker, buffer);
      const parsedResult = parseRecognizedText(pageNumber, recognition);
      const merged = dedupeCandidates(
        [...parsedResult.parsed].sort((a, b) => {
          const confidenceOrder = { high: 3, medium: 2, low: 1 };
          return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
        }),
        params.participants,
      );

      attendees.push(
        ...merged.map((item) => ({
          pageNumber,
          sourceName: item.raw,
          resolvedName: item.name,
          confidence: item.confidence,
          reason: "Nama dibaca dari OCR gratis Tesseract lalu disocokkan ke daftar peserta.",
          addressHint: item.addressHint,
        })),
      );

      skipped.push(...parsedResult.unresolved);

      if (merged.length === 0) {
        notes.push(`Halaman ${pageNumber}: OCR tidak menemukan nama yang cukup jelas. Coba foto lebih tegak dan terang.`);
      }

      params.onProgress?.({
        pageNumber,
        totalPages,
        progress: 18 + ((index + 1) / totalPages) * 42,
        message: `Halaman ${pageNumber} selesai dibaca.`,
      });
    }
  } finally {
    await worker.terminate();
  }

  return {
    attendees,
    skipped,
    notes,
  } satisfies AttendanceOcrScanResult;
}
