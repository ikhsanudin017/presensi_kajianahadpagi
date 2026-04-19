import {
  createWorker,
  PSM,
  type Line,
  type RecognizeResult,
  type Rectangle,
  type Word,
  type Worker,
} from "tesseract.js";
import * as path from "node:path";
import * as fs from "node:fs";
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
  rowNumber?: number;
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
  rowNumber?: number;
  name: string;
  addressHint?: string;
  confidence: "high" | "medium" | "low";
  raw: string;
};

type ImageDimensions = {
  width: number;
  height: number;
};

type OcrGeometry = {
  imageWidth: number;
  imageHeight: number;
  titleCutoffY: number;
  combinedRect: Rectangle;
  nameRect: Rectangle;
  numberColumnRight: number;
  nameColumnLeft: number;
  nameColumnRight: number;
};

type ParseRecognizedTextOptions = {
  titleCutoffY?: number;
  numberColumnRight?: number;
  nameColumnLeft?: number;
  nameColumnRight?: number;
  isNameColumnPass?: boolean;
};

type RecognitionPass = {
  label: string;
  psm: PSM;
  whitelist: string;
  rectangle?: Rectangle;
  parseOptions?: ParseRecognizedTextOptions;
  runWhen?: (currentUniqueCount: number) => boolean;
};

const HEADER_TOKENS = ["pengajian", "nama", "alamat", "telephone", "tanda tangan", "ttd", "no."];
const ADDRESS_WORDS = [
  "sawit", "dupok", "mulyosari", "ngandong", "gayamprit",
  "dalem", "jetis", "korang", "jenun", "tegalsi", "ngereyan",
];
const NON_NAME_TOKENS = new Set([
  "pengajian",
  "kajian",
  "ahad",
  "pagi",
  "tanggal",
  "tgl",
  "januari",
  "februari",
  "maret",
  "april",
  "mei",
  "juni",
  "juli",
  "agustus",
  "september",
  "oktober",
  "november",
  "desember",
  "nama",
  "alamat",
  "telephone",
  "telepon",
  "telpon",
  "tanda",
  "tangan",
  "nomor",
  "no",
]);

const OCR_TABLE_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '.,-/()";
const OCR_NAME_ONLY_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.,";
const OCR_TITLE_TOP_RATIO = 0.075;
const OCR_TABLE_HEIGHT_RATIO = 0.89;
const OCR_COMBINED_RIGHT_RATIO = 0.58;
const OCR_NAME_LEFT_RATIO = 0.08;
const OCR_NAME_RIGHT_RATIO = 0.5;
const CONFIDENCE_SCORE = { high: 3, medium: 2, low: 1 } as const;

function toConfidenceLabel(value: number) {
  if (value >= 80) return "high";
  if (value >= 50) return "medium";
  return "low";
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isHeaderLine(value: string) {
  const normalized = value.toLowerCase();
  // Harus mengandung minimal 2 token header atau jelas baris judul
  const matchCount = HEADER_TOKENS.filter((token) => normalized.includes(token)).length;
  return matchCount >= 2 || /^\s*no\.?\s*$/i.test(normalized);
}

function cleanupNamePart(value: string) {
  return sanitizeDetectedName(
    value
      .replace(/[|[\]{}<>_*~`=+\-\/\\]+/g, " ")
      .replace(/\b(?:dusun|dukuh|rt|rw|wa|hp|no)\b.*$/i, " ")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

function splitNameAndAddress(rawLine: string) {
  const withoutNumber = rawLine.replace(/^\s*[0-9|Il]{1,3}[\.)\-:]*\s*/, "").trim();
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

function parseRowNumberToken(value: string) {
  const normalized = value.replace(/[|Il]/g, "1").replace(/O/g, "0");
  if (!/^\d{1,2}$/.test(normalized)) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 1 || number > 120) return null;
  return number;
}

function base64ToBuffer(base64Image: string) {
  const cleanBase64 = base64Image.replace(/^data:image\/\w+;base64,/, "");
  return Buffer.from(cleanBase64, "base64");
}

function getPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null;
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function getJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }

    if (offset + 4 >= buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) break;

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isStartOfFrame && offset + 9 < buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + segmentLength;
  }

  return null;
}

function getImageDimensions(buffer: Buffer): ImageDimensions | null {
  return getPngDimensions(buffer) ?? getJpegDimensions(buffer);
}

function buildOcrGeometry(dimensions: ImageDimensions): OcrGeometry {
  const titleCutoffY = Math.max(1, Math.round(dimensions.height * OCR_TITLE_TOP_RATIO));
  const tableHeight = Math.max(1, Math.round(dimensions.height * OCR_TABLE_HEIGHT_RATIO));
  return {
    imageWidth: dimensions.width,
    imageHeight: dimensions.height,
    titleCutoffY,
    combinedRect: {
      left: 0,
      top: titleCutoffY,
      width: Math.max(1, Math.round(dimensions.width * OCR_COMBINED_RIGHT_RATIO)),
      height: tableHeight,
    },
    nameRect: {
      left: Math.max(0, Math.round(dimensions.width * OCR_NAME_LEFT_RATIO)),
      top: titleCutoffY,
      width: Math.max(1, Math.round(dimensions.width * (OCR_NAME_RIGHT_RATIO - OCR_NAME_LEFT_RATIO))),
      height: tableHeight,
    },
    numberColumnRight: Math.max(1, Math.round(dimensions.width * 0.09)),
    nameColumnLeft: Math.max(1, Math.round(dimensions.width * 0.065)),
    nameColumnRight: Math.max(1, Math.round(dimensions.width * OCR_NAME_RIGHT_RATIO)),
  };
}

function toParseRecognizedTextOptions(geometry: OcrGeometry, isNameColumnPass = false): ParseRecognizedTextOptions {
  return {
    titleCutoffY: geometry.titleCutoffY,
    numberColumnRight: geometry.numberColumnRight,
    nameColumnLeft: geometry.nameColumnLeft,
    nameColumnRight: geometry.nameColumnRight,
    isNameColumnPass,
  };
}

function isLikelyAttendanceName(value: string) {
  const cleaned = sanitizeDetectedName(value);
  if (!looksLikeHumanName(cleaned)) {
    return false;
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return false;
  }

  const blockedTokenCount = tokens.filter((token) => NON_NAME_TOKENS.has(token)).length;
  return blockedTokenCount < Math.ceil(tokens.length / 2);
}

function getWordCenterX(word: Word) {
  return (word.bbox.x0 + word.bbox.x1) / 2;
}

function isBetterParsedLine(next: ParsedLine, current: ParsedLine) {
  const rankNext =
    CONFIDENCE_SCORE[next.confidence] * 100 +
    (next.rowNumber ? 20 : 0) +
    Math.min(next.name.replace(/\s+/g, "").length, 24);
  const rankCurrent =
    CONFIDENCE_SCORE[current.confidence] * 100 +
    (current.rowNumber ? 20 : 0) +
    Math.min(current.name.replace(/\s+/g, "").length, 24);

  if (rankNext !== rankCurrent) {
    return rankNext > rankCurrent;
  }

  if (next.name.length !== current.name.length) {
    return next.name.length > current.name.length;
  }

  return next.raw.length < current.raw.length;
}

function parseStructuredRowsFromLineGeometry(
  pageNumber: number,
  recognition: RecognizeResult,
  options: ParseRecognizedTextOptions = {},
) {
  const rows: ParsedLine[] = [];
  const lines = extractLinesFromPage(recognition)
    .filter((line) => line.words?.length)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

  for (const line of lines) {
    const raw = normalizeWhitespace(line.text);
    if (!raw || raw.length < 2 || isHeaderLine(raw)) {
      continue;
    }
    if (options.titleCutoffY && line.bbox.y0 < options.titleCutoffY) {
      continue;
    }

    const words = [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let rowNumber: number | null = null;
    let rowWordIndex = -1;

    if (!options.isNameColumnPass && options.numberColumnRight) {
      for (let index = 0; index < Math.min(words.length, 2); index += 1) {
        const word = words[index];
        if (getWordCenterX(word) > options.numberColumnRight) {
          break;
        }
        const detectedRowNumber = parseRowNumberToken(word.text);
        if (detectedRowNumber) {
          rowNumber = detectedRowNumber;
          rowWordIndex = index;
          break;
        }
      }
    }

    const nameWords = words
      .filter((word, index) => {
        if (index === rowWordIndex) {
          return false;
        }

        const centerX = getWordCenterX(word);
        if (!options.isNameColumnPass) {
          if (options.nameColumnLeft && centerX <= options.nameColumnLeft) {
            return false;
          }
          if (options.nameColumnRight && centerX >= options.nameColumnRight) {
            return false;
          }
        }

        const text = normalizeWhitespace(word.text).replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9'.]+$/g, "");
        return /[A-Za-z]/.test(text);
      })
      .map((word) => normalizeWhitespace(word.text).replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9'.]+$/g, ""))
      .filter(Boolean);

    let name = cleanupNamePart(nameWords.join(" "));
    let addressHint: string | undefined;

    if (!name || name.length < 3) {
      const split = splitNameAndAddress(raw);
      name = split.name;
      addressHint = split.addressHint;
    }

    if (!isLikelyAttendanceName(name)) {
      continue;
    }

    rows.push({
      pageNumber,
      rowNumber: rowNumber ?? undefined,
      name: toDisplayPersonName(name),
      addressHint,
      confidence: toConfidenceLabel(line.confidence),
      raw: normalizeWhitespace(`${rowNumber ?? ""} ${nameWords.join(" ")}`) || raw,
    });
  }

  return rows;
}

function parseNumberedRowsFromRawText(pageNumber: number, rawText: string): ParsedLine[] {
  const rows: ParsedLine[] = [];
  const seenRows = new Set<number>();
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/^\s*([0-9Il|O]{1,3})\s*[.)\-:|]?\s+(.+)$/);
    if (!match) continue;

    const rowNumber = parseRowNumberToken(match[1]);
    if (!rowNumber || seenRows.has(rowNumber)) continue;

    const rowContent = normalizeWhitespace(match[2]);
    if (!rowContent || isHeaderLine(rowContent)) continue;

    const { name, addressHint } = splitNameAndAddress(rowContent);
    if (!isLikelyAttendanceName(name)) continue;

    seenRows.add(rowNumber);
    rows.push({
      pageNumber,
      rowNumber,
      name: toDisplayPersonName(name),
      addressHint,
      confidence: "medium",
      raw: line,
    });
  }

  return rows;
}

function parseLooseNameCandidatesFromRawText(pageNumber: number, rawText: string): ParsedLine[] {
  const rows: ParsedLine[] = [];
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length >= 3);

  for (const line of lines) {
    if (isHeaderLine(line)) continue;
    if (/^(?:[-_=.,:;|\\/()\[\]{}])+$/i.test(line)) continue;

    const cleaned = line
      .replace(/^\s*[0-9Il|O]{1,3}\s*[.)\-:|]?\s*/g, "")
      .replace(/\b(?:telephone|telepon|telpon|ttd|tanda tangan|alamat)\b.*$/i, "")
      .replace(/[^A-Za-z\s']/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) continue;
    const tokens = cleaned.split(" ").filter(Boolean);
    if (tokens.length === 0) continue;

    // Fokus ke fragmen awal karena biasanya nama berada di depan sebelum kolom lain.
    const probableName = tokens.slice(0, Math.min(3, tokens.length)).join(" ");
    const normalizedName = cleanupNamePart(probableName);
    if (!isLikelyAttendanceName(normalizedName)) continue;

    rows.push({
      pageNumber,
      name: toDisplayPersonName(normalizedName),
      confidence: "low",
      raw: line,
    });
  }

  return rows;
}

// Tesseract.js v7: Page → blocks[] → paragraphs[] → lines[]
// Kita perlu traverse semua level untuk mengumpulkan lines
function extractLinesFromPage(recognition: RecognizeResult): Line[] {
  const allLines: Line[] = [];
  const blocks = recognition.data.blocks;
  if (!blocks) return allLines;

  for (const block of blocks) {
    if (!block.paragraphs) continue;
    for (const paragraph of block.paragraphs) {
      if (!paragraph.lines) continue;
      for (const line of paragraph.lines) {
        allLines.push(line);
      }
    }
  }
  return allLines;
}

function parseRecognizedText(
  pageNumber: number,
  recognition: RecognizeResult,
  options: ParseRecognizedTextOptions = {},
) {
  const parsed: ParsedLine[] = [];
  const unresolved: AttendanceOcrScanResult["skipped"] = [];
  const lines = extractLinesFromPage(recognition);
  const seenNameKeys = new Set<string>();

  const pushParsed = (item: ParsedLine) => {
    const key = item.name.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seenNameKeys.has(key)) return;
    seenNameKeys.add(key);
    parsed.push(item);
  };

  const structuredRows = parseStructuredRowsFromLineGeometry(pageNumber, recognition, options);
  for (const row of structuredRows) {
    pushParsed(row);
  }

  const numberedRows = parseNumberedRowsFromRawText(pageNumber, recognition.data.text ?? "");
  for (const row of numberedRows) {
    pushParsed(row);
  }
  const looseRows = parseLooseNameCandidatesFromRawText(pageNumber, recognition.data.text ?? "");
  for (const row of looseRows) {
    pushParsed(row);
  }

  for (const line of lines) {
    const raw = normalizeWhitespace(line.text);
    if (!raw || raw.length < 2 || isHeaderLine(raw)) {
      continue;
    }
    if (options?.titleCutoffY && line.bbox.y0 < options.titleCutoffY) {
      continue;
    }

    const lineCenterX = (line.bbox.x0 + line.bbox.x1) / 2;
    if (!options?.isNameColumnPass && options?.nameColumnRight && lineCenterX > options.nameColumnRight + 48) {
      continue;
    }

    const { name, addressHint } = splitNameAndAddress(raw);
    if (!isLikelyAttendanceName(name)) {
      if (raw.replace(/\s/g, "").length > 2) {
        unresolved.push({
          pageNumber,
          sourceName: raw,
          reason: "Teks terbaca namun sulit diidentifikasi sebagai nama. Cek manual dibutuhkan.",
        });
      }
      continue;
    }

    pushParsed({
      pageNumber,
      name: toDisplayPersonName(name),
      addressHint,
      confidence: toConfidenceLabel(line.confidence),
      raw,
    });
  }

  return { parsed, unresolved };
}

export async function createAttendanceWorker() {
  console.log("[OCR] Menginisialisasi Tesseract Worker...");

  const workerScriptPath = path.resolve(
    process.cwd(),
    "node_modules",
    "tesseract.js",
    "src",
    "worker-script",
    "node",
    "index.js",
  );
  const workerScriptExists = fs.existsSync(workerScriptPath);
  if (!workerScriptExists) {
    console.error(`[OCR] Worker script tidak ditemukan: ${workerScriptPath}`);
    throw new Error("OCR_WORKER_SCRIPT_NOT_FOUND");
  }
  
  // Gunakan bahasa Indonesia + Inggris untuk mengenali nama Latin lebih baik
  const workerInit = createWorker("ind+eng", undefined, {
    workerPath: workerScriptPath,
    logger: (m) => {
      if (m.status === "recognizing text") {
        console.log(`[OCR Menganalisis Gambar] ${Math.round((m.progress || 0) * 100)}% selesai`);
      } else {
        console.log(`[OCR Sistem] ${m.status} - ${Math.round((m.progress || 0) * 100)}%`);
      }
    },
  });
  const workerTimeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("OCR_WORKER_INIT_TIMEOUT")), 20000);
  });
  const worker = (await Promise.race([workerInit, workerTimeout])) as Worker;
  
  // Set parameter Tesseract agar lebih optimal untuk tulisan tangan di form presensi
  await worker.setParameters({
    // PSM 6 = Assume a single uniform block of text (lebih cocok untuk tabel)
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    // Izinkan karakter yang umum muncul pada nama
    tessedit_char_whitelist: OCR_TABLE_WHITELIST,
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  
  console.log("[OCR] Worker berhasil dibuat dengan parameter optimal.");
  return worker;
}

// TIMEOUT diperbesar menjadi 90 detik agar gambar resolusi tinggi tetap bisa diproses
async function recognizeImage(worker: Worker, buffer: Buffer, rectangle?: Rectangle) {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("OCR_TIMEOUT")), 90000)
  );

  return (await Promise.race([
    worker.recognize(buffer, rectangle ? { rectangle } : undefined),
    timeoutPromise
  ])) as RecognizeResult;
}

async function recognizeImageWithPass(worker: Worker, params: {
  buffer: Buffer;
  psm: PSM;
  whitelist?: string;
  rectangle?: Rectangle;
}) {
  await worker.setParameters({
    tessedit_pageseg_mode: params.psm,
    tessedit_char_whitelist: params.whitelist,
    preserve_interword_spaces: "1",
  });
  return recognizeImage(worker, params.buffer, params.rectangle);
}

function dedupeCandidates(candidates: ParsedLine[], participants: ParticipantContext[]) {
  const existingNames = new Set(participants.map((participant) => participant.name.toLowerCase().trim()));
  const byRow = new Map<number, ParsedLine>();
  const byName = new Map<string, ParsedLine>();

  for (const candidate of candidates) {
    const key = candidate.name.toLowerCase().replace(/\s+/g, " ").trim();
    const shouldKeepShortName = key.length >= 3 || existingNames.has(key);
    if (!shouldKeepShortName) {
      continue;
    }

    if (candidate.rowNumber) {
      const currentByRow = byRow.get(candidate.rowNumber);
      if (!currentByRow || isBetterParsedLine(candidate, currentByRow)) {
        byRow.set(candidate.rowNumber, candidate);
      }
    }

    const currentByName = byName.get(key);
    if (!currentByName || isBetterParsedLine(candidate, currentByName)) {
      byName.set(key, candidate);
    }
  }

  const merged = [...byRow.values(), ...byName.values()];
  const finalByName = new Map<string, ParsedLine>();
  for (const candidate of merged) {
    const key = candidate.name.toLowerCase().replace(/\s+/g, " ").trim();
    const current = finalByName.get(key);
    if (!current || isBetterParsedLine(candidate, current)) {
      finalByName.set(key, candidate);
    }
  }

  return [...finalByName.values()].sort((a, b) => {
    const rowA = a.rowNumber ?? Number.MAX_SAFE_INTEGER;
    const rowB = b.rowNumber ?? Number.MAX_SAFE_INTEGER;
    return rowA - rowB || CONFIDENCE_SCORE[b.confidence] - CONFIDENCE_SCORE[a.confidence];
  });
}

function dedupeSkipped(items: AttendanceOcrScanResult["skipped"]) {
  const unique = new Map<string, AttendanceOcrScanResult["skipped"][number]>();
  for (const item of items) {
    const key = `${item.pageNumber}:${sanitizeDetectedName(item.sourceName)}:${item.reason}`;
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }
  return [...unique.values()];
}

function buildRecognitionPasses(geometry?: OcrGeometry): RecognitionPass[] {
  const passes: RecognitionPass[] = [
    {
      label: "full-table",
      psm: PSM.SINGLE_BLOCK,
      whitelist: OCR_TABLE_WHITELIST,
      parseOptions: geometry ? toParseRecognizedTextOptions(geometry) : undefined,
    },
  ];

  if (!geometry) {
    passes.push({
      label: "sparse-fallback",
      psm: PSM.SPARSE_TEXT,
      whitelist: OCR_TABLE_WHITELIST,
      runWhen: (count) => count < 20,
    });
    return passes;
  }

  passes.push(
    {
      label: "combined-columns",
      psm: PSM.SINGLE_COLUMN,
      whitelist: OCR_TABLE_WHITELIST,
      rectangle: geometry.combinedRect,
      parseOptions: toParseRecognizedTextOptions(geometry),
      runWhen: (count) => count < 26,
    },
    {
      label: "name-column",
      psm: PSM.SINGLE_COLUMN,
      whitelist: OCR_NAME_ONLY_WHITELIST,
      rectangle: geometry.nameRect,
      parseOptions: toParseRecognizedTextOptions(geometry, true),
      runWhen: (count) => count < 34,
    },
    {
      label: "sparse-columns",
      psm: PSM.SPARSE_TEXT,
      whitelist: OCR_NAME_ONLY_WHITELIST,
      rectangle: geometry.combinedRect,
      parseOptions: toParseRecognizedTextOptions(geometry),
      runWhen: (count) => count < 18,
    },
  );

  return passes;
}

export async function scanAttendanceImagesWithOcr(params: {
  images: AttendanceScanImageInput[];
  participants: ParticipantContext[];
  worker?: Worker;
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
  
  let worker = params.worker;
  let shouldTerminate = false;
  
  try {
    if (!worker) {
      worker = await createAttendanceWorker();
      shouldTerminate = true;
    }

    for (let index = 0; index < params.images.length; index += 1) {
      const image = params.images[index];
      const pageNumber = index + 1;
      const pageBaseProgress = 18 + (index / totalPages) * 42;
      const imageBuffer = base64ToBuffer(image.base64Image);
      const imageDimensions = getImageDimensions(imageBuffer);
      const geometry = imageDimensions ? buildOcrGeometry(imageDimensions) : null;
      const recognitionPasses = buildRecognitionPasses(geometry ?? undefined);
      const collectedParsed: ParsedLine[] = [];
      const collectedUnresolved: AttendanceOcrScanResult["skipped"] = [];

      params.onProgress?.({
        pageNumber,
        totalPages,
        progress: pageBaseProgress,
        message: `Membaca halaman ${pageNumber} dari ${totalPages}...`,
      });

      console.log(`[OCR] Memulai proses membaca gambar halaman ${pageNumber}...`);

      for (const pass of recognitionPasses) {
        const currentUniqueCount = dedupeCandidates(
          [...collectedParsed].sort((a, b) => CONFIDENCE_SCORE[b.confidence] - CONFIDENCE_SCORE[a.confidence]),
          params.participants,
        ).length;
        if (pass.runWhen && !pass.runWhen(currentUniqueCount)) {
          continue;
        }

        const recognition = await recognizeImageWithPass(worker, {
          buffer: imageBuffer,
          psm: pass.psm,
          whitelist: pass.whitelist,
          rectangle: pass.rectangle,
        });

        const parsedResult = parseRecognizedText(pageNumber, recognition, pass.parseOptions);
        collectedParsed.push(...parsedResult.parsed);
        collectedUnresolved.push(...parsedResult.unresolved);

        const updatedUniqueCount = dedupeCandidates(
          [...collectedParsed].sort((a, b) => CONFIDENCE_SCORE[b.confidence] - CONFIDENCE_SCORE[a.confidence]),
          params.participants,
        ).length;
        console.log(
          `[OCR] Halaman ${pageNumber}: pass ${pass.label} menghasilkan ${parsedResult.parsed.length} kandidat, total unik ${updatedUniqueCount}`,
        );
      }

      const merged = dedupeCandidates(
        [...collectedParsed].sort((a, b) => CONFIDENCE_SCORE[b.confidence] - CONFIDENCE_SCORE[a.confidence]),
        params.participants,
      );

      console.log(`[OCR] Halaman ${pageNumber}: ${merged.length} nama valid, ${collectedUnresolved.length} kandidat butuh cek manual`);

      attendees.push(
        ...merged.map((item) => ({
          pageNumber,
          rowNumber: item.rowNumber,
          sourceName: item.raw,
          resolvedName: item.name,
          confidence: item.confidence,
          reason: "Nama dibaca dari OCR Tesseract lalu dicocokkan ke daftar peserta.",
          addressHint: item.addressHint,
        })),
      );

      skipped.push(...dedupeSkipped(collectedUnresolved));

      if (merged.length === 0) {
        notes.push(`Halaman ${pageNumber}: OCR tidak menemukan nama yang cukup jelas.`);
      }

      params.onProgress?.({
        pageNumber,
        totalPages,
        progress: 18 + ((index + 1) / totalPages) * 42,
        message: `Halaman ${pageNumber} selesai dibaca (${merged.length} nama ditemukan).`,
      });
    }
  } catch (error) {
    console.error("[OCR FATAL ERROR]", error);
    // Melempar pesan khusus OCR_TIMEOUT agar frontend tahu apa yang terjadi
    if (error instanceof Error && error.message === "OCR_TIMEOUT") {
      throw error;
    }
    throw new Error("OCR_SCAN_FAILED");
  } finally {
    if (shouldTerminate && worker) {
      await worker.terminate();
    }
  }

  return {
    attendees,
    skipped,
    notes,
  } satisfies AttendanceOcrScanResult;
}
