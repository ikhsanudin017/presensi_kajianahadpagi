import type {
  AttendanceOcrScanResult,
  DetectedAttendanceCandidate,
} from "@/lib/ocr-attendance";
import {
  looksLikeHumanName,
  normalizePersonName,
  sanitizeDetectedName,
  toDisplayPersonName,
} from "@/lib/name-matching";

type AttendanceTextPage = {
  pageNumber: number;
  text: string;
};

type ParsedAttendanceLine = {
  pageNumber: number;
  rowNumber?: number;
  name: string;
  sourceName: string;
  addressHint?: string;
  confidence: "high" | "medium" | "low";
};

export type ProcessedAttendancePhotoResult = AttendanceOcrScanResult & {
  displayDate: string | null;
  detectedEventDate: string | null;
  previewText: string;
};

const MONTH_MAP: Record<string, string> = {
  januari: "01",
  februari: "02",
  maret: "03",
  april: "04",
  mei: "05",
  juni: "06",
  juli: "07",
  agustus: "08",
  september: "09",
  oktober: "10",
  november: "11",
  desember: "12",
};

const WEEKDAYS = ["senin", "selasa", "rabu", "kamis", "jumat", "sabtu", "minggu", "ahad"];
const HEADER_TOKENS = ["pengajian", "kajian", "presensi", "nama", "alamat", "telephone", "telepon", "ttd"];
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

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[|•·]/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

function normalizeOcrDigits(value: string) {
  return value
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/B/g, "8");
}

function normalizeWord(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/jurnat|jumal/g, "jumat")
    .replace(/rn/g, "m")
    .trim();
}

function levenshtein(source: string, target: string) {
  const matrix = Array.from({ length: source.length + 1 }, () => Array(target.length + 1).fill(0));

  for (let row = 0; row <= source.length; row += 1) {
    matrix[row][0] = row;
  }
  for (let column = 0; column <= target.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= source.length; row += 1) {
    for (let column = 1; column <= target.length; column += 1) {
      const cost = source[row - 1] === target[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      );
    }
  }

  return matrix[source.length][target.length];
}

function findClosestMonth(value: string) {
  const normalized = normalizeWord(value);
  if (!normalized) {
    return undefined;
  }
  if (MONTH_MAP[normalized]) {
    return normalized;
  }

  let bestMatch: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const month of Object.keys(MONTH_MAP)) {
    const distance = levenshtein(normalized, month);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = month;
    }
  }

  return bestDistance <= 2 ? bestMatch : undefined;
}

function extractDateFromCandidate(candidate: string) {
  const normalized = normalizeOcrDigits(
    candidate
      .toLowerCase()
      .replace(/jum['` ]?at/g, "jumat")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/([a-z])(\d)/g, "$1 $2")
      .replace(/(\d)([a-z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim(),
  );

  const patterns = [
    /(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu|ahad)?\s*(\d{1,2})\s+([a-z]{3,12})\s+(\d{4})/i,
    /([a-z]{3,12})\s+(\d{1,2})\s+(\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const [, first, second, third] = match;
    const isMonthFirst = pattern === patterns[1];
    const monthWord = isMonthFirst ? first : second;
    const dayWord = isMonthFirst ? second : first;
    const month = findClosestMonth(monthWord);
    const day = Number.parseInt(normalizeOcrDigits(dayWord), 10);
    const year = Number.parseInt(normalizeOcrDigits(third), 10);

    if (!month || !Number.isFinite(day) || day < 1 || day > 31) {
      continue;
    }
    if (!Number.isFinite(year) || year < 2020 || year > 2100) {
      continue;
    }

    return `${year}-${MONTH_MAP[month]}-${String(day).padStart(2, "0")}`;
  }

  return undefined;
}

function extractDetectedAttendanceDate(value: string) {
  const lines = normalizeWhitespace(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const priorityLines = [
    ...lines.slice(0, 10),
    ...lines.filter((line) => {
      const lower = line.toLowerCase();
      return WEEKDAYS.some((weekday) => lower.includes(weekday)) || Object.keys(MONTH_MAP).some((month) => lower.includes(month.slice(0, 3)));
    }),
  ];

  for (const line of priorityLines) {
    const detected = extractDateFromCandidate(line);
    if (detected) {
      return detected;
    }
  }

  return extractDateFromCandidate(value);
}

function extractDisplayDate(value: string) {
  const lines = normalizeWhitespace(value)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 12)) {
    const lower = line.toLowerCase();
    if (extractDateFromCandidate(line)) {
      return line;
    }
    if (WEEKDAYS.some((weekday) => lower.includes(weekday)) && /\d{1,2}/.test(line)) {
      return line;
    }
  }

  return null;
}

function isHeaderLine(value: string) {
  const lower = value.toLowerCase();
  const matches = HEADER_TOKENS.filter((token) => lower.includes(token)).length;
  return matches >= 1;
}

function cleanupNamePart(value: string) {
  const keepCommunityTitle = /^\s*(?:bu|ibu|pak|bapak)\s+r[wt]\b/i.test(value);
  const contactPattern = keepCommunityTitle
    ? /\b(?:dusun|dukuh|wa|hp|no)\b.*$/i
    : /\b(?:dusun|dukuh|rt|rw|wa|hp|no)\b.*$/i;

  return sanitizeDetectedName(
    value
      .replace(/[|[\]{}<>_*~`=+\/\\]+/g, " ")
      .replace(contactPattern, " ")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

function splitNameAndAddress(rawLine: string) {
  const withoutNumber = rawLine.replace(/^\s*[0-9|IlO]{1,3}[\.)\-:|]*\s*/, "").trim();
  const normalized = withoutNumber.replace(/\t+/g, " ").replace(/\s{2,}/g, "  ");
  const parts = normalized.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return {
      name: cleanupNamePart(parts[0]),
      addressHint: parts.slice(1).join(" "),
    };
  }

  const lower = normalized.toLowerCase();
  for (const addressWord of ADDRESS_WORDS) {
    const index = lower.indexOf(addressWord);
    if (index > 1) {
      return {
        name: cleanupNamePart(normalized.slice(0, index)),
        addressHint: normalized.slice(index).trim(),
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
  if (!/^\d{1,3}$/.test(normalized)) {
    return null;
  }

  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 1 || number > 250) {
    return null;
  }

  return number;
}

function isLikelyAttendanceName(value: string) {
  const cleaned = sanitizeDetectedName(value);
  if (!looksLikeHumanName(cleaned)) {
    return false;
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 0 || tokens.length > 5) {
    return false;
  }

  const blockedTokens = tokens.filter((token) => HEADER_TOKENS.includes(token));
  return blockedTokens.length < Math.ceil(tokens.length / 2);
}

function isNoiseLine(value: string) {
  if (!value || value.length < 3) {
    return true;
  }
  if (extractDateFromCandidate(value)) {
    return true;
  }
  if (isHeaderLine(value)) {
    return true;
  }
  if (!/[A-Za-z]/.test(value)) {
    return true;
  }
  return false;
}

function parseNumberedRows(pageNumber: number, rawText: string) {
  const lines = normalizeWhitespace(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: ParsedAttendanceLine[] = [];
  const seenRows = new Set<number>();

  for (const line of lines) {
    const match = line.match(/^\s*([0-9Il|O]{1,3})\s*[.)\-:|]?\s+(.+)$/);
    if (!match) continue;

    const rowNumber = parseRowNumberToken(match[1]);
    if (!rowNumber || seenRows.has(rowNumber)) continue;

    const split = splitNameAndAddress(match[2]);
    if (!isLikelyAttendanceName(split.name)) {
      continue;
    }

    seenRows.add(rowNumber);
    rows.push({
      pageNumber,
      rowNumber,
      name: toDisplayPersonName(split.name),
      sourceName: line,
      addressHint: split.addressHint,
      confidence: "medium",
    });
  }

  return rows;
}

function parseLooseRows(pageNumber: number, rawText: string) {
  const lines = normalizeWhitespace(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const rows: ParsedAttendanceLine[] = [];

  for (const line of lines) {
    if (isNoiseLine(line) || /^\d{1,2}$/.test(line)) {
      continue;
    }

    const cleaned = line
      .replace(/^\s*[0-9Il|O]{1,3}\s*[.)\-:|]?\s*/g, "")
      .replace(/\b(?:telephone|telepon|telpon|ttd|tanda tangan|alamat)\b.*$/i, "")
      .replace(/[^A-Za-z\s'.]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) {
      continue;
    }

    const probableName = cleaned.split(" ").slice(0, 4).join(" ");
    const normalized = cleanupNamePart(probableName);
    if (!isLikelyAttendanceName(normalized)) {
      continue;
    }

    rows.push({
      pageNumber,
      name: toDisplayPersonName(normalized),
      sourceName: line,
      confidence: "low",
    });
  }

  return rows;
}

function dedupeParsedRows(rows: ParsedAttendanceLine[]) {
  const byRow = new Map<string, ParsedAttendanceLine>();
  const byName = new Map<string, ParsedAttendanceLine>();

  for (const row of rows) {
    const nameKey = normalizePersonName(row.name);
    if (!nameKey) continue;

    if (row.rowNumber) {
      const rowKey = `${row.pageNumber}:${row.rowNumber}`;
      const currentByRow = byRow.get(rowKey);
      if (!currentByRow || row.confidence === "medium") {
        byRow.set(rowKey, row);
      }
    }

    const currentByName = byName.get(nameKey);
    if (!currentByName || (row.confidence === "medium" && currentByName.confidence !== "medium")) {
      byName.set(nameKey, row);
    }
  }

  return Array.from(new Set([...byRow.values(), ...byName.values()])).sort((a, b) => {
    const rowA = a.rowNumber ?? Number.MAX_SAFE_INTEGER;
    const rowB = b.rowNumber ?? Number.MAX_SAFE_INTEGER;
    return a.pageNumber - b.pageNumber || rowA - rowB;
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

export function processAttendanceOcrText(params: { pages: AttendanceTextPage[] }): ProcessedAttendancePhotoResult {
  const attendees: DetectedAttendanceCandidate[] = [];
  const skipped: AttendanceOcrScanResult["skipped"] = [];
  const notes: string[] = [];
  const previewSections: string[] = [];
  let displayDate: string | null = null;
  let detectedEventDate: string | null = null;

  for (const page of params.pages) {
    const normalizedText = normalizeWhitespace(page.text);
    if (!normalizedText) {
      notes.push(`Halaman ${page.pageNumber}: OCR Vision tidak menghasilkan teks.`);
      continue;
    }

    displayDate ??= extractDisplayDate(normalizedText);
    detectedEventDate ??= extractDetectedAttendanceDate(normalizedText) ?? null;

    const numberedRows = parseNumberedRows(page.pageNumber, normalizedText);
    const looseRows = numberedRows.length >= 8 ? [] : parseLooseRows(page.pageNumber, normalizedText);
    const merged = dedupeParsedRows([...numberedRows, ...looseRows]);

    attendees.push(
      ...merged.map((row) => ({
        pageNumber: row.pageNumber,
        rowNumber: row.rowNumber,
        sourceName: row.sourceName,
        resolvedName: row.name,
        confidence: row.confidence,
        reason: "Nama dibaca dari teks OCR mentah lalu diparse secara lokal.",
        addressHint: row.addressHint,
      })),
    );

    if (merged.length === 0) {
      const meaningfulLines = normalizedText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !isNoiseLine(line))
        .slice(0, 5);

      if (meaningfulLines.length > 0) {
        skipped.push(
          ...meaningfulLines.map((line) => ({
            pageNumber: page.pageNumber,
            sourceName: line,
            reason: "Teks terbaca, tetapi parser lokal belum cukup yakin mengubahnya menjadi nama peserta.",
          })),
        );
      }
    }

    const previewRows = merged.length > 0
      ? merged.slice(0, 24).map((row, index) => `${index + 1}. ${row.rowNumber ? `[${row.rowNumber}] ` : ""}${row.name}`)
      : normalizedText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 24);

    previewSections.push(`Halaman ${page.pageNumber}`);
    previewSections.push(...previewRows);
    previewSections.push("");
  }

  return {
    attendees,
    skipped: dedupeSkipped(skipped),
    notes,
    displayDate,
    detectedEventDate,
    previewText: previewSections.join("\n").trim(),
  };
}
