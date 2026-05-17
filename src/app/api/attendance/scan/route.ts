import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toEventDate } from "@/lib/time";
import { syncAttendanceSheetFromDatabase } from "@/lib/attendance-sheet-sync";
import { appendRow } from "@/lib/googleSheets";
import {
  scanAttendanceImagesWithOcr,
  type AttendanceScanImageInput,
  type DetectedAttendanceCandidate,
} from "@/lib/ocr-attendance";
import { checkGeminiAvailability, scanAttendanceImagesWithGemini } from "@/lib/gemini-attendance";
import {
  findBestParticipantMatch,
  looksLikeHumanName,
  normalizePersonName,
  toDisplayPersonName,
} from "@/lib/name-matching";
import {
  createAttendanceScanJob,
  getAttendanceScanJob,
  updateAttendanceScanJob,
  type AttendanceScanConfirmResult,
  type AttendanceScanJobResult,
} from "@/lib/attendance-scan-jobs";
import { prepareAttendanceScanImages, prepareAttendanceSignatureImages } from "@/lib/attendance-image-preprocess";
import { processAttendanceOcrText } from "@/lib/attendance-photo-parser";
import { checkVisionAvailability, scanAttendanceImagesWithVision } from "@/lib/vision-attendance";
import { detectAttendanceRowsWithSignature } from "@/lib/attendance-signature-detector";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type ParticipantRecord = {
  id: string;
  name: string;
  address: string | null;
  gender: "L" | "P" | null;
  createdAt: Date;
};

type ReviewSaveStatus = AttendanceScanJobResult["reviewItems"][number]["saveStatus"];

const NEW_PARTICIPANT_ID_PREFIX = "new:";

type PuterGeminiRow = {
  rowNumber?: number | null;
  name?: string | null;
  addressHint?: string | null;
  hasSignature?: boolean | string | null;
  signatureStatus?: string | null;
  confidence?: number | null;
};

type PuterGeminiPage = {
  pageNumber?: number | null;
  mimeType?: string | null;
  imageBase64?: string | null;
  displayDate?: string | null;
  detectedDate?: string | null;
  normalizedTranscript?: string | null;
  signedRowNumbers?: Array<number | string> | null;
  rows?: PuterGeminiRow[] | null;
  notes?: string | null;
};

type PuterGeminiPayload = {
  provider?: string;
  scanMode?: string;
  eventDate?: string;
  pages?: PuterGeminiPage[];
};

type PuterScanMode = "signature" | "all-names";

// Roster arrays dihapus - sistem sekarang menggunakan database peserta dan hasil OCR/Gemini langsung
// tanpa override hardcoded yang bisa menimpa hasil deteksi dengan nama yang salah.
const PRIORITY_ATTENDANCE_ROSTER: readonly { sourceName: string; participantName: string; aliases: readonly string[] }[] = [];

const MASTER_ATTENDANCE_ROSTER: readonly string[] = [];

const DETECTED_CONFIDENCE_SCORE = { high: 3, medium: 2, low: 1 } as const;

type PriorityRosterEntry = (typeof PRIORITY_ATTENDANCE_ROSTER)[number];

function getPriorityRosterEntry(rowNumber?: number): PriorityRosterEntry | null {
  if (!rowNumber || rowNumber < 1) {
    return null;
  }

  return PRIORITY_ATTENDANCE_ROSTER[rowNumber - 1] ?? null;
}

function getPriorityRosterName(rowNumber?: number) {
  return getPriorityRosterEntry(rowNumber)?.participantName ?? null;
}

function getMasterRosterName(rowNumber?: number) {
  if (!rowNumber || rowNumber < 1) {
    return null;
  }

  return MASTER_ATTENDANCE_ROSTER[rowNumber - 1] ?? null;
}

function getMasterRosterOccurrenceIndex(rowNumber: number, rosterName: string) {
  const normalizedTarget = normalizePersonName(rosterName);
  if (!normalizedTarget) {
    return 0;
  }

  let occurrenceIndex = 0;
  for (let currentRow = 1; currentRow < rowNumber; currentRow += 1) {
    if (normalizePersonName(getMasterRosterName(currentRow) ?? "") === normalizedTarget) {
      occurrenceIndex += 1;
    }
  }

  return occurrenceIndex;
}

function isBetterDetectedCandidate(next: DetectedAttendanceCandidate, current: DetectedAttendanceCandidate) {
  const nextRank =
    DETECTED_CONFIDENCE_SCORE[next.confidence] * 100 +
    (next.rowNumber ? 20 : 0) +
    Math.min(normalizePersonName(next.resolvedName || next.sourceName).length, 24);
  const currentRank =
    DETECTED_CONFIDENCE_SCORE[current.confidence] * 100 +
    (current.rowNumber ? 20 : 0) +
    Math.min(normalizePersonName(current.resolvedName || current.sourceName).length, 24);

  if (nextRank !== currentRank) {
    return nextRank > currentRank;
  }

  if (next.sourceName.length !== current.sourceName.length) {
    return next.sourceName.length < current.sourceName.length;
  }

  return next.pageNumber < current.pageNumber;
}

function dedupeDetectedCandidates(candidates: DetectedAttendanceCandidate[]) {
  const byRow = new Map<string, DetectedAttendanceCandidate>();
  const byName = new Map<string, DetectedAttendanceCandidate>();

  for (const candidate of candidates) {
    const normalizedName = normalizePersonName(candidate.resolvedName || candidate.sourceName);
    if (candidate.rowNumber) {
      const rowKey = `${candidate.pageNumber}:${candidate.rowNumber}`;
      const currentByRow = byRow.get(rowKey);
      if (!currentByRow || isBetterDetectedCandidate(candidate, currentByRow)) {
        byRow.set(rowKey, candidate);
      }
    }

    if (!normalizedName) {
      continue;
    }

    const currentByName = byName.get(normalizedName);
    if (!currentByName || isBetterDetectedCandidate(candidate, currentByName)) {
      byName.set(normalizedName, candidate);
    }
  }

  const rowCandidates = [...byRow.values()];
  const rowKeys = new Set(
    rowCandidates
      .filter((candidate) => typeof candidate.rowNumber === "number")
      .map((candidate) => `${candidate.pageNumber}:${candidate.rowNumber}`),
  );
  const rowCandidateNameKeys = new Set(
    rowCandidates
      .map((candidate) => normalizePersonName(candidate.resolvedName || candidate.sourceName))
      .filter(Boolean),
  );
  const merged = [
    ...rowCandidates,
    ...[...byName.values()].filter((candidate) => {
      if (typeof candidate.rowNumber === "number" && rowKeys.has(`${candidate.pageNumber}:${candidate.rowNumber}`)) {
        return false;
      }
      const normalizedName = normalizePersonName(candidate.resolvedName || candidate.sourceName);
      return normalizedName && !rowCandidateNameKeys.has(normalizedName);
    }),
  ];

  return merged.sort((a, b) => {
    const rowA = a.rowNumber ?? Number.MAX_SAFE_INTEGER;
    const rowB = b.rowNumber ?? Number.MAX_SAFE_INTEGER;
    return (
      a.pageNumber - b.pageNumber ||
      rowA - rowB ||
      DETECTED_CONFIDENCE_SCORE[b.confidence] - DETECTED_CONFIDENCE_SCORE[a.confidence]
    );
  });
}

function dedupeUnresolved(items: AttendanceScanJobResult["unresolved"]) {
  const unique = new Map<string, AttendanceScanJobResult["unresolved"][number]>();

  for (const item of items) {
    const key = `${item.pageNumber}:${item.rowNumber ?? ""}:${normalizePersonName(item.sourceName)}:${item.reason}`;
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  return [...unique.values()];
}

function summarizeScanWarnings(notes: string[]) {
  const warnings: string[] = [];
  const hasVisionBilling = notes.some((note) => /vision/i.test(note) && /billing/i.test(note));
  const hasVisionMissingKey = notes.some((note) => /vision/i.test(note) && /api key/i.test(note));
  const hasGeminiMissingKey = notes.some((note) => /gemini/i.test(note) && /api_key_missing/i.test(note));
  const hasGeminiQuota = notes.some((note) => /gemini/i.test(note) && /quota|rate limit|429/i.test(note));
  const signatureNotes = notes.filter((note) => note.startsWith("Filter TTD aktif"));

  if (hasVisionBilling) {
    warnings.push("Google Vision tidak berjalan karena billing Google Cloud belum aktif. Scan memakai OCR lokal.");
  } else if (hasVisionMissingKey) {
    warnings.push("Google Vision tidak berjalan karena API key belum diisi. Scan memakai OCR lokal.");
  }

  if (hasGeminiMissingKey) {
    warnings.push("Gemini tidak berjalan karena API key belum diisi. Hasil memakai OCR lokal.");
  } else if (hasGeminiQuota) {
    warnings.push("Gemini tidak berjalan karena kuota/rate limit habis. Hasil memakai OCR lokal.");
  }

  for (const note of signatureNotes) {
    if (!warnings.includes(note)) {
      warnings.push(note);
    }
  }

  return warnings.length > 0 ? warnings : notes.slice(0, 3);
}

async function checkCloudScanProviders() {
  const [vision, gemini] = await Promise.all([
    checkVisionAvailability(),
    checkGeminiAvailability(),
  ]);

  return {
    ok: vision.ok && gemini.ok,
    vision,
    gemini,
  };
}

function findExactParticipantByName(participants: ParticipantRecord[], rawName: string) {
  const normalizedTarget = normalizePersonName(rawName);
  if (!normalizedTarget) {
    return null;
  }

  return participants.find((participant) => normalizePersonName(participant.name) === normalizedTarget) ?? null;
}

function findParticipantsByExactName(participants: ParticipantRecord[], rawName: string) {
  const normalizedTarget = normalizePersonName(rawName);
  if (!normalizedTarget) {
    return [];
  }

  return participants
    .filter((participant) => normalizePersonName(participant.name) === normalizedTarget)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.name.localeCompare(b.name));
}

function findMasterRosterParticipantByRow(params: {
  candidate: DetectedAttendanceCandidate;
  participants: ParticipantRecord[];
}) {
  const { candidate, participants } = params;
  const rowNumber = candidate.rowNumber;
  const rosterName = getMasterRosterName(rowNumber);
  if (!rowNumber || !rosterName) {
    return null;
  }

  const comparisonName = toDisplayPersonName(candidate.resolvedName || candidate.sourceName);
  const rowComparison = findBestParticipantMatch(comparisonName, [{ id: `master-row-${rowNumber}`, name: rosterName }]);
  if (!rowComparison) {
    return null;
  }

  const compactLength = normalizePersonName(comparisonName).replace(/\s+/g, "").length;
  const threshold = compactLength <= 4 ? 0.92 : 0.84;
  if (rowComparison.score < threshold) {
    return null;
  }

  const matches = findParticipantsByExactName(participants, rosterName);
  if (matches.length === 0) {
    return null;
  }

  return {
    participant: matches[getMasterRosterOccurrenceIndex(rowNumber, rosterName)] ?? matches[0],
    rosterName,
    score: rowComparison.score,
  };
}

function isNewParticipantSelectionId(participantId: string) {
  return participantId.startsWith(NEW_PARTICIPANT_ID_PREFIX);
}

function buildNewParticipantId(candidate: DetectedAttendanceCandidate, participantName: string) {
  const normalizedName = normalizePersonName(participantName).replace(/\s+/g, "-") || "peserta";
  return `${NEW_PARTICIPANT_ID_PREFIX}${candidate.pageNumber}:${candidate.rowNumber ?? "x"}:${normalizedName}`;
}

function buildNewParticipantRecord(candidate: DetectedAttendanceCandidate, participantName: string): ParticipantRecord {
  return {
    id: buildNewParticipantId(candidate, participantName),
    name: participantName,
    address: candidate.addressHint ?? null,
    gender: null,
    createdAt: new Date(0),
  };
}

function buildReviewItemId(candidate: DetectedAttendanceCandidate, participantId: string) {
  const normalizedSource = normalizePersonName(candidate.resolvedName || candidate.sourceName || "scan");
  return [participantId, candidate.pageNumber, candidate.rowNumber ?? "x", normalizedSource].join(":");
}

function pushUniqueWarning(warnings: string[], message: string) {
  if (!warnings.includes(message)) {
    warnings.push(message);
  }
}

async function findOrCreateParticipantFromScan(rawName: string, warnings: string[]) {
  const name = toDisplayPersonName(rawName);
  const normalizedName = normalizePersonName(name);
  if (!normalizedName || !looksLikeHumanName(name)) {
    return null;
  }

  const lookupSeed = normalizedName.split(" ")[0] || name.trim().slice(0, 2) || name.trim();
  const existingCandidates = await prisma.participant.findMany({
    where: {
      name: {
        contains: lookupSeed,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });
  const existing =
    existingCandidates.find((participant) => normalizePersonName(participant.name) === normalizedName) ??
    (await prisma.participant.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
      },
    }));

  if (existing) {
    return existing;
  }

  const participant = await prisma.participant.create({
    data: {
      name,
      address: null,
      gender: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  const sheetName = process.env.GOOGLE_SHEETS_PARTICIPANTS_SHEET_NAME ?? "Peserta";
  const appendResult = await appendRow(sheetName, [
    new Date().toISOString(),
    participant.name,
    "",
    "",
  ]).catch((error) => {
    console.error("Failed to append OCR-created participant to sheet", error);
    return { ok: false } as const;
  });

  if (!appendResult.ok) {
    pushUniqueWarning(warnings, "Peserta baru tersimpan di database, tetapi sync ke sheet peserta gagal.");
  }

  return participant;
}

const PRIORITY_ROSTER_ALIASES = PRIORITY_ATTENDANCE_ROSTER.flatMap((entry, index) => {
  const names = Array.from(new Set([entry.sourceName, entry.participantName, ...entry.aliases]));
  return names.map((name) => ({
    id: `${index + 1}:${normalizePersonName(name)}`,
    name,
    rowNumber: index + 1,
    entry,
  }));
});

function findPriorityRosterMatch(rawName: string) {
  const displayName = toDisplayPersonName(rawName);
  const normalizedName = normalizePersonName(displayName);
  if (!normalizedName) {
    return null;
  }

  const exactAlias = PRIORITY_ROSTER_ALIASES.find((alias) => normalizePersonName(alias.name) === normalizedName);
  if (exactAlias) {
    return {
      rowNumber: exactAlias.rowNumber,
      entry: exactAlias.entry,
      score: 1,
    };
  }

  const fuzzyAlias = findBestParticipantMatch(displayName, PRIORITY_ROSTER_ALIASES);
  if (!fuzzyAlias || fuzzyAlias.ambiguous) {
    return null;
  }

  const compactLength = normalizedName.replace(/\s+/g, "").length;
  const threshold = compactLength <= 4 ? 0.92 : 0.86;
  if (fuzzyAlias.score < threshold) {
    return null;
  }

  return {
    rowNumber: fuzzyAlias.participant.rowNumber,
    entry: fuzzyAlias.participant.entry,
    score: fuzzyAlias.score,
  };
}

function shouldPreferRosterByRow(candidates: DetectedAttendanceCandidate[]) {
  const visibleRows = candidates
    .map((candidate) => candidate.rowNumber)
    .filter((rowNumber): rowNumber is number => typeof rowNumber === "number" && rowNumber >= 1 && rowNumber <= 120);
  const highestVisibleRow = visibleRows.length > 0 ? Math.max(...visibleRows) : 0;

  if (highestVisibleRow > PRIORITY_ATTENDANCE_ROSTER.length + 4) {
    return false;
  }

  const uniqueRows = new Set(
    visibleRows.filter((rowNumber) => rowNumber <= PRIORITY_ATTENDANCE_ROSTER.length),
  );
  const uniqueAliasRows = new Set(
    candidates
      .map((candidate) => findPriorityRosterMatch(candidate.resolvedName)?.rowNumber ?? findPriorityRosterMatch(candidate.sourceName)?.rowNumber)
      .filter((rowNumber): rowNumber is number => typeof rowNumber === "number"),
  );

  // Jika mayoritas besar dari 41 baris roster terdeteksi, anggap ini lembar roster tetap
  // dan prioritaskan nomor baris dibanding ejaan OCR yang mudah meleset.
  return uniqueRows.size >= 30 || uniqueAliasRows.size >= 20;
}

function normalizePriorityRosterCandidates(candidates: DetectedAttendanceCandidate[]) {
  const byPage = new Map<number, DetectedAttendanceCandidate[]>();
  const normalized: DetectedAttendanceCandidate[] = [];

  for (const candidate of candidates) {
    const pageCandidates = byPage.get(candidate.pageNumber) ?? [];
    pageCandidates.push(candidate);
    byPage.set(candidate.pageNumber, pageCandidates);
  }

  for (const [pageNumber, pageCandidates] of byPage) {
    if (!shouldPreferRosterByRow(pageCandidates)) {
      normalized.push(...pageCandidates);
      continue;
    }

    const byRosterRow = new Map<number, DetectedAttendanceCandidate>();

    for (const candidate of pageCandidates) {
      const nameMatch =
        findPriorityRosterMatch(candidate.resolvedName) ?? findPriorityRosterMatch(candidate.sourceName);
      const rowEntry = nameMatch ? null : getPriorityRosterEntry(candidate.rowNumber);
      const rowNumber = nameMatch?.rowNumber ?? candidate.rowNumber;
      const entry = nameMatch?.entry ?? rowEntry;

      if (!entry || !rowNumber || rowNumber < 1 || rowNumber > PRIORITY_ATTENDANCE_ROSTER.length) {
        continue;
      }

      const nextCandidate: DetectedAttendanceCandidate = {
        ...candidate,
        rowNumber,
        resolvedName: entry.participantName,
        confidence: nameMatch ? "high" : candidate.confidence,
        reason: nameMatch
          ? "Nama dicocokkan ke alias roster tetap 41 peserta."
          : "Nama diarahkan oleh nomor baris pada roster tetap 41 peserta.",
      };
      const current = byRosterRow.get(rowNumber);
      if (!current || isBetterDetectedCandidate(nextCandidate, current)) {
        byRosterRow.set(rowNumber, nextCandidate);
      }
    }

    for (let index = 0; index < PRIORITY_ATTENDANCE_ROSTER.length; index += 1) {
      const rowNumber = index + 1;
      if (byRosterRow.has(rowNumber)) {
        continue;
      }

      const entry = PRIORITY_ATTENDANCE_ROSTER[index];
      byRosterRow.set(rowNumber, {
        pageNumber,
        rowNumber,
        sourceName: `${rowNumber}. ${entry.sourceName}`,
        resolvedName: entry.participantName,
        confidence: "high",
        reason: "Baris dilengkapi dari roster tetap karena format 41 peserta sudah terdeteksi.",
      });
    }

    normalized.push(...[...byRosterRow.values()].sort((a, b) => (a.rowNumber ?? 0) - (b.rowNumber ?? 0)));
  }

  return dedupeDetectedCandidates(normalized);
}

function buildPriorityRosterPreviewText(candidates: DetectedAttendanceCandidate[]) {
  const rowsByPage = new Map<number, Set<number>>();

  for (const candidate of candidates) {
    if (
      typeof candidate.rowNumber !== "number" ||
      candidate.rowNumber < 1 ||
      candidate.rowNumber > PRIORITY_ATTENDANCE_ROSTER.length
    ) {
      continue;
    }

    const rows = rowsByPage.get(candidate.pageNumber) ?? new Set<number>();
    rows.add(candidate.rowNumber);
    rowsByPage.set(candidate.pageNumber, rows);
  }

  const sections: string[] = [];
  for (const [pageNumber, rows] of rowsByPage) {
    if (rows.size < PRIORITY_ATTENDANCE_ROSTER.length) {
      continue;
    }

    sections.push(`Halaman ${pageNumber}`);
    sections.push(
      ...PRIORITY_ATTENDANCE_ROSTER.map((entry, index) => `${index + 1}. ${entry.sourceName}`),
    );
    sections.push("");
  }

  return sections.join("\n").trim();
}

function parseStructuredPreviewPages(previewText: string) {
  const text = previewText.trim();
  if (!text) {
    return [];
  }

  const pages: Array<{ pageNumber: number; text: string }> = [];
  let currentPageNumber = 1;
  let currentLines: string[] = [];

  const flushCurrentPage = () => {
    const pageText = currentLines.join("\n").trim();
    if (pageText) {
      pages.push({
        pageNumber: currentPageNumber,
        text: pageText,
      });
    }
    currentLines = [];
  };

  for (const line of text.split(/\r?\n/)) {
    const pageMatch = line.trim().match(/^Halaman\s+(\d+)/i);
    if (pageMatch) {
      flushCurrentPage();
      currentPageNumber = Number(pageMatch[1]) || currentPageNumber;
      continue;
    }

    currentLines.push(line);
  }

  flushCurrentPage();

  return pages.length > 0 ? pages : [{ pageNumber: 1, text }];
}

function getCandidateRowKey(candidate: DetectedAttendanceCandidate) {
  if (typeof candidate.rowNumber !== "number") {
    return null;
  }

  return `${candidate.pageNumber}:${candidate.rowNumber}`;
}

function getCandidateNameKey(candidate: DetectedAttendanceCandidate) {
  return normalizePersonName(candidate.resolvedName || candidate.sourceName);
}

function filterBackfillCandidates(
  primaryCandidates: DetectedAttendanceCandidate[],
  secondaryCandidates: DetectedAttendanceCandidate[],
) {
  const seenRowKeys = new Set(
    primaryCandidates
      .map((candidate) => getCandidateRowKey(candidate))
      .filter((key): key is string => Boolean(key)),
  );
  const seenNameKeys = new Set(
    primaryCandidates
      .map((candidate) => getCandidateNameKey(candidate))
      .filter(Boolean),
  );

  return secondaryCandidates.filter((candidate) => {
    const rowKey = getCandidateRowKey(candidate);
    if (rowKey && seenRowKeys.has(rowKey)) {
      return false;
    }

    const nameKey = getCandidateNameKey(candidate);
    if (nameKey && seenNameKeys.has(nameKey)) {
      return false;
    }

    return true;
  });
}

function buildDetectedCandidatesPreviewText(candidates: DetectedAttendanceCandidate[]) {
  if (candidates.length === 0) {
    return "";
  }

  const byPage = new Map<number, DetectedAttendanceCandidate[]>();
  for (const candidate of candidates) {
    const pageCandidates = byPage.get(candidate.pageNumber) ?? [];
    pageCandidates.push(candidate);
    byPage.set(candidate.pageNumber, pageCandidates);
  }

  const sections: string[] = [];
  for (const [pageNumber, pageCandidates] of [...byPage.entries()].sort((left, right) => left[0] - right[0])) {
    sections.push(`Halaman ${pageNumber}`);
    for (const candidate of [...pageCandidates].sort((left, right) => {
      const rowDiff = (left.rowNumber ?? Number.MAX_SAFE_INTEGER) - (right.rowNumber ?? Number.MAX_SAFE_INTEGER);
      if (rowDiff !== 0) {
        return rowDiff;
      }

      return left.resolvedName.localeCompare(right.resolvedName);
    })) {
      const label = toDisplayPersonName(candidate.resolvedName || candidate.sourceName);
      sections.push(
        typeof candidate.rowNumber === "number"
          ? `${candidate.rowNumber}. ${label}`
          : label,
      );
    }
    sections.push("");
  }

  return sections.join("\n").trim();
}

function toPuterConfidenceLabel(value?: number | null): DetectedAttendanceCandidate["confidence"] {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "medium";
  }
  if (value >= 0.86) return "high";
  if (value >= 0.62) return "medium";
  return "low";
}

function readPuterSignatureStatus(row: PuterGeminiRow) {
  const status = typeof row.signatureStatus === "string" ? row.signatureStatus.trim().toLowerCase() : "";
  const rawSignature =
    typeof row.hasSignature === "string" ? row.hasSignature.trim().toLowerCase() : row.hasSignature;

  if (status === "signed" || status === "terisi" || status === "ada" || rawSignature === true || rawSignature === "true") {
    return "signed" as const;
  }

  if (
    status === "empty" ||
    status === "kosong" ||
    status === "blank" ||
    status === "false" ||
    rawSignature === false ||
    rawSignature === "false"
  ) {
    return "empty" as const;
  }

  return "uncertain" as const;
}

function normalizePuterSignedRowNumbers(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => {
          if (typeof item === "number" && Number.isFinite(item)) {
            return Math.round(item);
          }
          if (typeof item === "string") {
            const match = item.match(/\d+/);
            return match ? Number(match[0]) : NaN;
          }
          return NaN;
        })
        .filter((item) => Number.isInteger(item) && item > 0 && item <= 300),
    ),
  ).sort((left, right) => left - right);
}

function normalizePuterScanMode(value: unknown): PuterScanMode {
  return value === "signature" ? "signature" : "all-names";
}

function normalizePuterGeminiPages(value: unknown): PuterGeminiPage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const pages: PuterGeminiPage[] = [];

  for (const [index, page] of value.entries()) {
    if (!page || typeof page !== "object") {
      continue;
    }

    const record = page as PuterGeminiPage;
    pages.push({
      pageNumber:
        typeof record.pageNumber === "number" && Number.isFinite(record.pageNumber)
          ? record.pageNumber
          : index + 1,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : null,
      imageBase64: typeof record.imageBase64 === "string" ? record.imageBase64 : null,
      displayDate: typeof record.displayDate === "string" ? record.displayDate : null,
      detectedDate: typeof record.detectedDate === "string" ? record.detectedDate : null,
      normalizedTranscript:
        typeof record.normalizedTranscript === "string" ? record.normalizedTranscript : null,
      signedRowNumbers: normalizePuterSignedRowNumbers(record.signedRowNumbers),
      notes: typeof record.notes === "string" ? record.notes : null,
      rows: Array.isArray(record.rows) ? record.rows : [],
    });
  }

  return pages;
}

function buildPuterCandidates(pages: PuterGeminiPage[], scanMode: PuterScanMode) {
  const candidates: DetectedAttendanceCandidate[] = [];

  for (const page of pages) {
    const pageNumber =
      typeof page.pageNumber === "number" && Number.isFinite(page.pageNumber)
        ? page.pageNumber
        : 1;
    const readableRows = (page.rows ?? [])
      .map((row) => ({
        row,
        signatureStatus: readPuterSignatureStatus(row),
        rawName: toDisplayPersonName(String(row.name ?? "")),
      }))
      .filter((item) => item.rawName && looksLikeHumanName(item.rawName));
    const signedRowNumberSet = new Set(normalizePuterSignedRowNumbers(page.signedRowNumbers));
    const signedRows =
      scanMode === "all-names"
        ? readableRows
        : signedRowNumberSet.size > 0
          ? readableRows.filter(
              (item) =>
                typeof item.row.rowNumber === "number" &&
                signedRowNumberSet.has(Math.round(item.row.rowNumber)),
            )
          : readableRows.filter((item) => item.signatureStatus === "signed");
    const rowsToUse = scanMode === "all-names" || signedRows.length > 0 ? signedRows : readableRows;
    const signatureFallback = scanMode !== "all-names" && signedRows.length === 0 && readableRows.length > 0;

    for (const { row, rawName, signatureStatus } of rowsToUse) {
      const rowNumber = typeof row.rowNumber === "number" && Number.isFinite(row.rowNumber)
        ? Math.round(row.rowNumber)
        : undefined;
      const verifiedBySignedRowScan = typeof rowNumber === "number" && signedRowNumberSet.has(rowNumber);
      candidates.push({
        pageNumber,
        rowNumber,
        sourceName: rawName,
        resolvedName: rawName,
        confidence: signatureFallback ? "medium" : toPuterConfidenceLabel(row.confidence),
        reason: scanMode === "all-names"
          ? "Nama dibaca dari kolom Nama pada mode semua nama hadir; kolom TTD diabaikan."
          : signatureFallback
            ? "Nama dibaca oleh Puter Gemini, tetapi status kolom TTD belum bisa dipastikan; masukkan review manual."
            : verifiedBySignedRowScan
            ? "Nama dibaca oleh Puter Gemini; nomor baris diverifikasi dari scan khusus kolom TTD."
            : signatureStatus === "signed"
            ? "Nama dibaca oleh Puter Gemini dari baris yang sejajar langsung dengan kolom TTD terisi."
            : "Nama dibaca oleh Puter Gemini dengan status TTD belum pasti; masukkan review manual.",
        addressHint: typeof row.addressHint === "string" && row.addressHint.trim() ? row.addressHint.trim() : undefined,
        signatureStatus: scanMode === "all-names" || !signatureFallback ? "signed" : "uncertain",
      });
    }
  }

  return dedupeDetectedCandidates(candidates);
}

function buildPuterSignatureWarnings(pages: PuterGeminiPage[]) {
  const warnings: string[] = [];

  for (const page of pages) {
    const pageNumber =
      typeof page.pageNumber === "number" && Number.isFinite(page.pageNumber)
        ? page.pageNumber
        : 1;
    const readableRows = (page.rows ?? []).filter((row) => {
      const rawName = toDisplayPersonName(String(row.name ?? ""));
      return rawName && looksLikeHumanName(rawName);
    });
    if (readableRows.length === 0) {
      continue;
    }

    const signedRowNumberSet = new Set(normalizePuterSignedRowNumbers(page.signedRowNumbers));
    const signedRows =
      signedRowNumberSet.size > 0
        ? readableRows.filter(
            (row) =>
              typeof row.rowNumber === "number" &&
              signedRowNumberSet.has(Math.round(row.rowNumber)),
          )
        : readableRows.filter((row) => readPuterSignatureStatus(row) === "signed");
    if (signedRows.length === 0) {
      warnings.push(
        `Puter Gemini membaca ${readableRows.length} nama di halaman ${pageNumber}; baris hadir divalidasi ulang dari pixel kolom TTD.`,
      );
    } else if (signedRowNumberSet.size > 0 && signedRows.length !== signedRowNumberSet.size) {
      warnings.push(
        `Scan TTD halaman ${pageNumber} membaca ${signedRowNumberSet.size} baris bertanda tangan, tetapi ${signedRows.length} baris cocok dengan nama yang terbaca.`,
      );
    }
  }

  return warnings;
}

function buildPuterPreviewText(pages: PuterGeminiPage[], candidates: DetectedAttendanceCandidate[]) {
  const fromCandidates = buildDetectedCandidatesPreviewText(candidates);
  if (fromCandidates) {
    return fromCandidates;
  }

  return pages
    .map((page) => {
      const pageNumber =
        typeof page.pageNumber === "number" && Number.isFinite(page.pageNumber)
          ? page.pageNumber
          : 1;
      const transcript = typeof page.normalizedTranscript === "string" ? page.normalizedTranscript.trim() : "";
      return transcript ? `Halaman ${pageNumber}\n${transcript}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function isConfirmedSignatureCandidate(candidate: DetectedAttendanceCandidate) {
  return candidate.signatureStatus === "signed";
}

async function filterPuterCandidatesBySignaturePixels(params: {
  pages: PuterGeminiPage[];
  candidates: DetectedAttendanceCandidate[];
}) {
  const warnings = buildPuterSignatureWarnings(params.pages);
  const imagePages = params.pages.filter(
    (page) => typeof page.imageBase64 === "string" && page.imageBase64.trim().length > 0,
  );

  if (imagePages.length === 0 || params.candidates.length === 0) {
    return {
      candidates: params.candidates,
      warnings,
    };
  }

  const preparedImages = await prepareAttendanceSignatureImages({
    images: imagePages.map((page, index) => ({
      name: `puter-page-${page.pageNumber ?? index + 1}.jpg`,
      mimeType: page.mimeType || "image/jpeg",
      base64Image: page.imageBase64 || "",
    })),
  });
  const signatureDetection = await detectAttendanceRowsWithSignature({
    pages: preparedImages,
    candidates: params.candidates,
  });

  warnings.push(...signatureDetection.notes);

  if (!signatureDetection.active || signatureDetection.presentRowKeys.length === 0) {
    if (params.candidates.length >= 10) {
      warnings.push("Validasi pixel TTD belum berhasil memastikan garis tanda tangan. Auto-simpan dimatikan untuk hasil scan ini.");
      return {
        candidates: params.candidates.map((candidate) => ({
          ...candidate,
          signatureStatus: "uncertain" as const,
          reason: `${candidate.reason} Validasi pixel TTD belum memastikan baris ini.`,
        })),
        warnings,
      };
    }

    return {
      candidates: params.candidates,
      warnings,
    };
  }

  const signedRowKeys = new Set(signatureDetection.presentRowKeys);
  const filteredCandidates = params.candidates
    .filter(
      (candidate) =>
        typeof candidate.rowNumber === "number" &&
        signedRowKeys.has(`${candidate.pageNumber}:${candidate.rowNumber}`),
    )
    .map((candidate) => ({
      ...candidate,
      confidence: candidate.confidence === "low" ? "medium" as const : candidate.confidence,
      signatureStatus: "signed" as const,
      reason: `Nama dipilih dari nomor baris ${candidate.rowNumber} yang sama dengan sel TTD bertanda tangan pada gambar.`,
    }));

  warnings.push(
    `Validasi pixel TTD: ${filteredCandidates.length} nama sejajar dari ${signatureDetection.presentRowKeys.length} baris bertanda tangan terdeteksi.`,
  );

  return {
    candidates: filteredCandidates,
    warnings,
  };
}

async function buildScanResultFromCandidates(params: {
  eventDate: Date;
  participants: ParticipantRecord[];
  candidates: DetectedAttendanceCandidate[];
  filesProcessed: number;
  displayDate: string | null;
  detectedEventDate: string | null;
  previewText: string;
  warnings?: string[];
}) {
  const reviewItems: AttendanceScanJobResult["reviewItems"] = [];
  const unresolved: AttendanceScanJobResult["unresolved"] = [];
  const participantSeenInScan = new Set<string>();
  const resolvedCandidates = params.candidates.map((candidate, index) => ({
    candidate,
    index,
    resolved: resolveCandidateToParticipant({
      candidate,
      participants: params.participants,
    }),
  }));
  const participantIdsToCheck = Array.from(
    new Set(
      resolvedCandidates
        .map((item) =>
          item.resolved.participant && item.resolved.resolutionMethod !== "new"
            ? item.resolved.participant.id
            : null,
        )
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const existingAttendances =
    participantIdsToCheck.length > 0
      ? await prisma.attendance.findMany({
          where: {
            eventDate: params.eventDate,
            participantId: {
              in: participantIdsToCheck,
            },
          },
          select: {
            participantId: true,
          },
        })
      : [];
  const existingParticipantIds = new Set(existingAttendances.map((attendance) => attendance.participantId));

  for (const { candidate, index, resolved } of resolvedCandidates) {
    if (!resolved.participant || !resolved.resolutionMethod) {
      unresolved.push({
        pageNumber: candidate.pageNumber,
        rowNumber: candidate.rowNumber,
        sourceName: candidate.sourceName || candidate.resolvedName,
        reason: resolved.reason,
      });
      continue;
    }

    let saveStatus: ReviewSaveStatus = resolved.reviewRequired ? "REVIEW_REQUIRED" : "READY";
    let reason = resolved.reason;
    if (!isConfirmedSignatureCandidate(candidate)) {
      saveStatus = "REVIEW_REQUIRED";
      reason = "Kolom TTD belum terkonfirmasi sejajar dengan nama pada baris ini, jadi perlu dicek manual.";
    }
    const participantScanKey =
      resolved.resolutionMethod === "new"
        ? `${NEW_PARTICIPANT_ID_PREFIX}${normalizePersonName(resolved.participant.name)}:${candidate.pageNumber}:${candidate.rowNumber ?? index}`
        : resolved.participant.id;

    if (participantSeenInScan.has(participantScanKey)) {
      saveStatus = "DUPLICATE_IN_SCAN";
      reason = "Peserta yang sama terdeteksi lagi pada scan yang sama, jadi tidak dipilih otomatis.";
    } else {
      participantSeenInScan.add(participantScanKey);
    }

    if (
      saveStatus !== "DUPLICATE_IN_SCAN" &&
      resolved.resolutionMethod !== "new" &&
      existingParticipantIds.has(resolved.participant.id)
    ) {
      saveStatus = "ALREADY_PRESENT";
      reason = "Peserta sudah tercatat hadir pada tanggal ini.";
    }

    reviewItems.push({
      id: buildReviewItemId(candidate, resolved.participant.id),
      pageNumber: candidate.pageNumber,
      rowNumber: candidate.rowNumber,
      sourceName: candidate.sourceName,
      participantName: resolved.participant.name,
      participantId: resolved.participant.id,
      confidence: candidate.confidence,
      resolutionMethod: resolved.resolutionMethod,
      matchScore: resolved.matchScore > 0 ? Number(resolved.matchScore.toFixed(4)) : undefined,
      saveStatus,
      selectedByDefault:
        (saveStatus === "READY" && isConfirmedSignatureCandidate(candidate)) ||
        (saveStatus === "REVIEW_REQUIRED" &&
          isConfirmedSignatureCandidate(candidate) &&
          candidate.confidence !== "low"),
      reason,
    });
  }

  const result: AttendanceScanJobResult = {
    summary: {
      filesProcessed: params.filesProcessed,
      detectedByOcr: params.candidates.length,
      readyToSave: reviewItems.filter((item) => item.saveStatus === "READY").length,
      reviewRequired: reviewItems.filter((item) => item.saveStatus === "REVIEW_REQUIRED").length,
      alreadyPresent: reviewItems.filter((item) => item.saveStatus === "ALREADY_PRESENT").length,
      duplicateInScan: reviewItems.filter((item) => item.saveStatus === "DUPLICATE_IN_SCAN").length,
      unresolved: dedupeUnresolved(unresolved).length,
    },
    structured: {
      displayDate: params.displayDate,
      detectedEventDate: params.detectedEventDate,
      previewText: params.previewText,
    },
    reviewItems,
    unresolved: dedupeUnresolved(unresolved),
    warnings: params.warnings ?? [],
    blocked: false,
  };

  result.blocked = shouldUseBlockedMode(result);
  return result;
}

function resolveCandidateToParticipant(params: {
  candidate: DetectedAttendanceCandidate;
  participants: ParticipantRecord[];
  preferRosterByRow?: boolean;
}) {
  const { candidate, participants } = params;
  const candidateName = toDisplayPersonName(candidate.resolvedName || candidate.sourceName);
  const sourceCandidateName = toDisplayPersonName(candidate.sourceName || candidate.resolvedName);
  const isValidHumanName = looksLikeHumanName(candidateName);
  const rowRosterName = getPriorityRosterName(candidate.rowNumber);
  const rowRosterParticipant = rowRosterName ? findExactParticipantByName(participants, rowRosterName) : null;
  const rowComparisonName = sourceCandidateName || candidateName;
  const rowRosterComparison =
    rowRosterParticipant && rowRosterName
      ? findBestParticipantMatch(rowComparisonName, [{ id: rowRosterParticipant.id, name: rowRosterName }])
      : null;

  if (rowRosterParticipant && rowRosterName && params.preferRosterByRow) {
    const fuzzyAgainstAll = findBestParticipantMatch(rowComparisonName, participants);
    const strongCompetingMatch =
      fuzzyAgainstAll &&
      fuzzyAgainstAll.participant.id !== rowRosterParticipant.id &&
      fuzzyAgainstAll.score >= Math.max(0.92, (rowRosterComparison?.score ?? 0) + 0.2);

    if (!strongCompetingMatch) {
      const rowScore = rowRosterComparison?.score ?? 0;
      return {
        participant: rowRosterParticipant,
        resolutionMethod: "roster" as const,
        matchScore: rowScore,
        reviewRequired: false,
        reason:
          rowScore >= 0.72
            ? `Nama diarahkan oleh nomor baris ${candidate.rowNumber} dan cocok dengan roster tetap.`
            : `Nama diarahkan oleh nomor baris ${candidate.rowNumber} pada roster tetap.`,
      };
    }
  }

  if (rowRosterParticipant && rowRosterName) {
    if (rowRosterComparison && rowRosterComparison.score >= 0.84) {
      return {
        participant: rowRosterParticipant,
        resolutionMethod: "roster" as const,
        matchScore: rowRosterComparison.score,
        reviewRequired: false,
        reason: `Nama diarahkan oleh petunjuk baris roster ${candidate.rowNumber}.`,
      };
    }
  }

  const exactMatch = findExactParticipantByName(participants, candidateName);
  if (exactMatch) {
    return {
      participant: exactMatch,
      resolutionMethod: "exact" as const,
      matchScore: 1,
      reviewRequired: false,
      reason: "Nama cocok persis dengan peserta yang sudah ada.",
    };
  }

  const fuzzyMatch = findBestParticipantMatch(candidateName, participants);
  if (!fuzzyMatch) {
    // Tidak ada peserta yang cocok sama sekali di database.
    // Jika nama valid, tawarkan sebagai peserta baru untuk review.
    if (isValidHumanName) {
      return {
        participant: buildNewParticipantRecord(candidate, candidateName),
        resolutionMethod: "new" as const,
        matchScore: 1,
        reviewRequired: true,
        reason: "Nama belum ada di database; akan dibuat sebagai peserta baru saat disimpan.",
      };
    }

    return {
      participant: null,
      resolutionMethod: null,
      matchScore: 0,
      reviewRequired: false,
      reason: "Teks terbaca, tetapi belum cukup jelas sebagai nama peserta.",
    };
  }

  const exactEnoughThreshold =
    candidate.confidence === "high"
      ? 0.8
      : candidate.confidence === "medium"
        ? 0.85
        : 0.9;
  const reviewThreshold =
    candidate.confidence === "high"
      ? 0.72
      : candidate.confidence === "medium"
        ? 0.78
        : 0.84;

  if (
    isValidHumanName &&
    typeof candidate.rowNumber === "number" &&
    candidate.rowNumber >= 1 &&
    fuzzyMatch.reason === "fuzzy" &&
    fuzzyMatch.score < Math.max(0.86, reviewThreshold + 0.04)
  ) {
    return {
      participant: buildNewParticipantRecord(candidate, candidateName),
      resolutionMethod: "new" as const,
      matchScore: fuzzyMatch.score,
      reviewRequired: true,
      reason: `Nama OCR cukup jelas, tetapi tidak cukup aman dipaksa cocok ke "${fuzzyMatch.participant.name}" (skor ${fuzzyMatch.score.toFixed(2)}). Akan dibuat sebagai peserta baru saat disimpan.`,
    };
  }

  if (!fuzzyMatch.ambiguous && fuzzyMatch.score >= exactEnoughThreshold) {
    return {
      participant: fuzzyMatch.participant,
      resolutionMethod: fuzzyMatch.reason,
      matchScore: fuzzyMatch.score,
      reviewRequired: fuzzyMatch.reason === "fuzzy" && fuzzyMatch.score < 0.88,
      reason:
        fuzzyMatch.reason === "phonetic"
          ? "Nama cocok melalui kemiripan bunyi."
          : fuzzyMatch.reason === "fuzzy"
            ? `Nama cocok melalui fuzzy match (skor ${fuzzyMatch.score.toFixed(2)}).`
            : "Nama cocok persis dengan peserta lama.",
    };
  }

  if (fuzzyMatch.score >= reviewThreshold) {
    return {
      participant: fuzzyMatch.participant,
      resolutionMethod: fuzzyMatch.reason,
      matchScore: fuzzyMatch.score,
      reviewRequired: true,
      reason: `Nama paling dekat ke "${fuzzyMatch.participant.name}" (skor ${fuzzyMatch.score.toFixed(2)}), perlu review manual sebelum disimpan.`,
    };
  }

  // Fuzzy match ada tapi skor terlalu rendah — tawarkan sebagai peserta baru jika valid
  if (isValidHumanName) {
    return {
      participant: buildNewParticipantRecord(candidate, candidateName),
      resolutionMethod: "new" as const,
      matchScore: 0,
      reviewRequired: true,
      reason: `Nama terlalu jauh dari peserta yang ada (skor ${fuzzyMatch.score.toFixed(2)}); akan dibuat sebagai peserta baru saat disimpan.`,
    };
  }

  return {
    participant: null,
    resolutionMethod: null,
    matchScore: fuzzyMatch.score,
    reviewRequired: false,
    reason: `Nama "${candidateName}" masih terlalu jauh dari daftar peserta (skor ${fuzzyMatch.score.toFixed(2)}).`,
  };
}

function shouldUseBlockedMode(result: Pick<AttendanceScanJobResult, "reviewItems" | "unresolved">) {
  const readyItems = result.reviewItems.filter((item) => item.selectedByDefault).length;
  const actionableItems = result.reviewItems.filter(
    (item) => item.saveStatus === "READY" || item.saveStatus === "REVIEW_REQUIRED",
  ).length;

  if (readyItems >= 1) {
    return false;
  }

  return actionableItems === 0 || (actionableItems <= 2 && result.unresolved.length >= actionableItems + 2);
}

async function runAttendanceScanJob(params: {
  jobId: string;
  eventDate: Date;
  images: AttendanceScanImageInput[];
}) {
  let lastProgress = 0;
  const setProgress = (progress: number, message: string, status: "running" | "completed" | "failed" = "running") => {
    lastProgress = Math.max(lastProgress, Math.round(progress));
    updateAttendanceScanJob(params.jobId, {
      status,
      progress: lastProgress,
      message,
    });
  };

  try {
    setProgress(4, "Memuat daftar peserta...");

    const participants = (await prisma.participant.findMany({
      orderBy: { name: "asc" },
    })) as ParticipantRecord[];

    const preparedImages = await prepareAttendanceScanImages({
      images: params.images,
      onProgress: ({ progress, message }) => setProgress(progress, message),
    });

    const visionResult = await scanAttendanceImagesWithVision({
      images: preparedImages.map((image) => ({
        pageNumber: image.pageNumber,
        base64Image: image.visionImageBase64,
      })),
      onProgress: ({ progress, message }) => setProgress(progress, message),
    });

    const visionTextByPage = new Map(visionResult.pages.map((page) => [page.pageNumber, page.text]));

    const geminiResult = await scanAttendanceImagesWithGemini({
      images: preparedImages.map((image) => ({
        pageNumber: image.pageNumber,
        mimeType: "image/jpeg",
        fullImageBase64: image.fullImageBase64,
        headerImageBase64: image.headerImageBase64,
        visionText: visionTextByPage.get(image.pageNumber) || "",
      })),
      participantNames: participants.map((participant) => participant.name),
      onProgress: ({ progress, message }) => setProgress(progress, message),
    });

    const ocrResult = await scanAttendanceImagesWithOcr({
      images: preparedImages.map((image) => image.ocrImage),
      participants,
      onProgress: ({ progress, message }) => setProgress(progress, message),
    });

    const parsedVisionResult = processAttendanceOcrText({
      pages: visionResult.pages,
    });
    const parsedGeminiPreviewResult = processAttendanceOcrText({
      pages: parseStructuredPreviewPages(geminiResult.previewText),
    });

    const previewCandidates = parsedGeminiPreviewResult.attendees.map((item) => ({
      ...item,
      confidence: item.confidence === "low" ? "medium" : item.confidence,
      reason: "Nama diparse dari ringkasan OCR terstruktur yang tampil di halaman.",
    } satisfies DetectedAttendanceCandidate));

    const geminiPrimaryCandidates = dedupeDetectedCandidates([
      ...geminiResult.attendees,
      ...previewCandidates,
    ]);
    const geminiIsActive = geminiResult.attendees.length > 0 || previewCandidates.length >= 8;
    const visionBackfillCandidates = filterBackfillCandidates(geminiPrimaryCandidates, parsedVisionResult.attendees);
    const ocrBackfillCandidates = filterBackfillCandidates(
      [...geminiPrimaryCandidates, ...visionBackfillCandidates],
      ocrResult.attendees,
    ).filter((candidate) => typeof candidate.rowNumber === "number");

    // Cloud-first:
    // - Jika Gemini aktif, jadikan Gemini + preview sebagai sumber utama nama.
    // - Vision dan OCR lokal hanya dipakai untuk mengisi baris yang belum tercover.
    // - Jika Gemini tidak aktif, fallback ke semua sumber seperti biasa.
    const allCandidates = geminiIsActive
      ? [
          ...geminiPrimaryCandidates,
          ...visionBackfillCandidates,
          ...ocrBackfillCandidates,
        ]
      : [
          ...geminiResult.attendees,
          ...previewCandidates,
          ...parsedVisionResult.attendees,
          ...ocrResult.attendees,
        ];
    const mergedCandidates = dedupeDetectedCandidates(allCandidates);
    const signatureDetection = await detectAttendanceRowsWithSignature({
      pages: preparedImages.map((image) => ({
        pageNumber: image.pageNumber,
        signatureImageBase64: image.signatureImageBase64,
      })),
      candidates: mergedCandidates,
    });
    const signatureRowKeySet = new Set(signatureDetection.presentRowKeys);
    const filteredCandidatesBySignature =
      signatureDetection.active && signatureRowKeySet.size > 0
        ? mergedCandidates.filter(
            (candidate) =>
              typeof candidate.rowNumber === "number" &&
              signatureRowKeySet.has(`${candidate.pageNumber}:${candidate.rowNumber}`),
          )
        : mergedCandidates;
    const finalCandidates =
      signatureDetection.active && filteredCandidatesBySignature.length > 0
        ? dedupeDetectedCandidates(filteredCandidatesBySignature)
        : mergedCandidates;

    const rawWarnings = Array.from(
      new Set([
        ...visionResult.notes,
        ...geminiResult.notes,
        ...ocrResult.notes,
        ...parsedVisionResult.notes,
        ...parsedGeminiPreviewResult.notes,
        ...signatureDetection.notes,
      ]),
    );
    const warnings = summarizeScanWarnings(rawWarnings);

    const unresolvedSeed = dedupeUnresolved([
      ...geminiResult.skipped.map((item) => ({
        pageNumber: item.pageNumber,
        rowNumber: undefined,
        sourceName: item.sourceName,
        reason: item.reason,
      })),
      ...ocrResult.skipped.map((item) => ({
        pageNumber: item.pageNumber,
        rowNumber: undefined,
        sourceName: item.sourceName,
        reason: item.reason,
      })),
      ...parsedVisionResult.skipped.map((item) => ({
        pageNumber: item.pageNumber,
        rowNumber: undefined,
        sourceName: item.sourceName,
        reason: item.reason,
      })),
      ...parsedGeminiPreviewResult.skipped.map((item) => ({
        pageNumber: item.pageNumber,
        rowNumber: undefined,
        sourceName: item.sourceName,
        reason: item.reason,
      })),
    ]);

    const reviewItems: AttendanceScanJobResult["reviewItems"] = [];
    const unresolved: AttendanceScanJobResult["unresolved"] = [...unresolvedSeed];
    const participantSeenInScan = new Set<string>();
    const totalCandidates = Math.max(finalCandidates.length, 1);

    for (let index = 0; index < finalCandidates.length; index += 1) {
      const candidate = finalCandidates[index];
      setProgress(72 + (index / totalCandidates) * 24, `Menyusun review ${index + 1}/${finalCandidates.length}...`);

      const resolved = resolveCandidateToParticipant({
        candidate,
        participants,
      });

      if (!resolved.participant || !resolved.resolutionMethod) {
        unresolved.push({
          pageNumber: candidate.pageNumber,
          rowNumber: candidate.rowNumber,
          sourceName: candidate.sourceName || candidate.resolvedName,
          reason: resolved.reason,
        });
        continue;
      }

      let saveStatus: ReviewSaveStatus = resolved.reviewRequired ? "REVIEW_REQUIRED" : "READY";
      let reason = resolved.reason;
      const participantScanKey =
        resolved.resolutionMethod === "new"
          ? `${NEW_PARTICIPANT_ID_PREFIX}${normalizePersonName(resolved.participant.name)}`
          : resolved.participant.id;

      if (participantSeenInScan.has(participantScanKey)) {
        saveStatus = "DUPLICATE_IN_SCAN";
        reason = "Peserta yang sama terdeteksi lagi pada scan yang sama, jadi tidak dipilih otomatis.";
      } else {
        participantSeenInScan.add(participantScanKey);
      }

      if (saveStatus !== "DUPLICATE_IN_SCAN" && resolved.resolutionMethod !== "new") {
        const existingAttendance = await prisma.attendance.findUnique({
          where: {
            participantId_eventDate: {
              participantId: resolved.participant.id,
              eventDate: params.eventDate,
            },
          },
        });

        if (existingAttendance) {
          saveStatus = "ALREADY_PRESENT";
          reason = "Peserta sudah tercatat hadir pada tanggal ini.";
        }
      }

      reviewItems.push({
        id: buildReviewItemId(candidate, resolved.participant.id),
        pageNumber: candidate.pageNumber,
        rowNumber: candidate.rowNumber,
        sourceName: candidate.sourceName,
        participantName: resolved.participant.name,
        participantId: resolved.participant.id,
        confidence: candidate.confidence,
        resolutionMethod: resolved.resolutionMethod,
        matchScore: resolved.matchScore > 0 ? Number(resolved.matchScore.toFixed(4)) : undefined,
        saveStatus,
        selectedByDefault:
          saveStatus === "READY" ||
          (saveStatus === "REVIEW_REQUIRED" &&
            (
              candidate.reason.toLowerCase().includes("ringkasan ocr terstruktur") ||
              (resolved.resolutionMethod === "new" &&
                typeof candidate.rowNumber === "number" &&
                candidate.confidence !== "low")
            )),
        reason,
      });
    }

    const result: AttendanceScanJobResult = {
      summary: {
        filesProcessed: params.images.length,
        detectedByOcr: finalCandidates.length,
        readyToSave: reviewItems.filter((item) => item.saveStatus === "READY").length,
        reviewRequired: reviewItems.filter((item) => item.saveStatus === "REVIEW_REQUIRED").length,
        alreadyPresent: reviewItems.filter((item) => item.saveStatus === "ALREADY_PRESENT").length,
        duplicateInScan: reviewItems.filter((item) => item.saveStatus === "DUPLICATE_IN_SCAN").length,
        unresolved: dedupeUnresolved(unresolved).length,
      },
      structured: {
        displayDate: geminiResult.displayDate ?? parsedVisionResult.displayDate,
        detectedEventDate: geminiResult.detectedEventDate ?? parsedVisionResult.detectedEventDate,
        previewText:
          (signatureDetection.active ? buildDetectedCandidatesPreviewText(finalCandidates) : "") ||
          geminiResult.previewText ||
          parsedVisionResult.previewText ||
          visionResult.pages.map((page) => page.text).join("\n\n").trim(),
      },
      reviewItems,
      unresolved: dedupeUnresolved(unresolved),
      warnings,
      blocked: false,
    };

    result.blocked = shouldUseBlockedMode(result);

    updateAttendanceScanJob(params.jobId, {
      status: "completed",
      progress: 100,
      message: result.blocked
        ? "Scan selesai, tetapi belum ada hasil yang cukup yakin untuk dipilih otomatis."
        : "Scan selesai. Review hasil sebelum disimpan.",
      result,
    });
  } catch (error) {
    console.error("OCR attendance scan failed", error);
    updateAttendanceScanJob(params.jobId, {
      status: "failed",
      progress: 100,
      message: "Scan gagal.",
      error: error instanceof Error ? error.message : "OCR_SCAN_FAILED",
    });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim();

  if (!id) {
    return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });
  }

  const job = getAttendanceScanJob(id);
  if (!job) {
    return NextResponse.json({ ok: false, error: "JOB_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, data: job });
}

async function handlePuterGeminiScan(req: Request) {
  const body = (await req.json().catch(() => null)) as PuterGeminiPayload | null;
  if (!body || body.provider !== "puter-gemini") {
    return NextResponse.json({ ok: false, error: "INVALID_PUTER_SCAN_PAYLOAD" }, { status: 400 });
  }

  const eventDateValue = typeof body.eventDate === "string" ? body.eventDate.trim() : "";
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(eventDateValue) ? toEventDate(eventDateValue) : toEventDate();
  const scanMode = normalizePuterScanMode(body.scanMode);
  const pages = normalizePuterGeminiPages(body.pages);
  const rawCandidates = buildPuterCandidates(pages, scanMode);

  if (pages.length === 0) {
    return NextResponse.json(
      { ok: false, error: "PUTER_SCAN_EMPTY", detail: "Puter Gemini belum mengembalikan halaman hasil scan." },
      { status: 400 },
    );
  }

  if (rawCandidates.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "PUTER_SCAN_NO_ATTENDEES",
        detail: "Puter Gemini belum berhasil membaca baris nama dari gambar. Coba foto lebih tegak dan pastikan kolom Nama terlihat jelas.",
      },
      { status: 422 },
    );
  }

  const signatureFiltered =
    scanMode === "all-names"
      ? {
          candidates: rawCandidates,
          warnings: ["Mode semua nama hadir aktif: semua nama yang terbaca dari kolom Nama dipilih, kolom TTD diabaikan."],
        }
      : await filterPuterCandidatesBySignaturePixels({
          pages,
          candidates: rawCandidates,
        });
  const candidates = signatureFiltered.candidates;

  if (candidates.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "PUTER_SCAN_NO_ALIGNED_SIGNATURES",
        detail: "Nama yang dibaca Puter Gemini belum sejajar dengan baris TTD yang terdeteksi di gambar. Coba foto ulang lebih tegak dan pastikan garis tabel terlihat.",
      },
      { status: 422 },
    );
  }

  const participants = (await prisma.participant.findMany({
    orderBy: { name: "asc" },
  })) as ParticipantRecord[];
  const displayDate =
    pages.map((page) => page.displayDate).find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null;
  const detectedEventDate =
    pages.map((page) => page.detectedDate).find((value): value is string => typeof value === "string" && value.trim().length > 0) ?? null;
  const result = await buildScanResultFromCandidates({
    eventDate,
    participants,
    candidates,
    filesProcessed: pages.length,
    displayDate,
    detectedEventDate,
    previewText: buildPuterPreviewText(pages, candidates),
    warnings: signatureFiltered.warnings,
  });

  return NextResponse.json({ ok: true, data: result });
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return handlePuterGeminiScan(req);
    }

    const formData = await req.formData();
    const eventDateValue = String(formData.get("eventDate") ?? "").trim();
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(eventDateValue) ? toEventDate(eventDateValue) : toEventDate();
    const files = formData.getAll("images").filter((item): item is File => item instanceof File && item.size > 0);

    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: "IMAGE_REQUIRED" }, { status: 400 });
    }

    if (files.length > 6) {
      return NextResponse.json(
        { ok: false, error: "TOO_MANY_IMAGES", detail: "Maksimal 6 gambar per scan agar proses tetap cepat." },
        { status: 400 },
      );
    }

    const cloudProviders = await checkCloudScanProviders();
    if (!cloudProviders.ok) {
      const detail = [
        "Scan membutuhkan Google Vision dan Gemini aktif.",
        cloudProviders.vision.reason ? `Vision: ${cloudProviders.vision.reason}` : null,
        cloudProviders.gemini.reason ? `Gemini: ${cloudProviders.gemini.reason}` : null,
      ]
        .filter(Boolean)
        .join(" ");

      return NextResponse.json(
        {
          ok: false,
          error: "CLOUD_SCAN_UNAVAILABLE",
          detail,
        },
        { status: 503 },
      );
    }

    const images = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        mimeType: file.type || "image/jpeg",
        base64Image: Buffer.from(await file.arrayBuffer()).toString("base64"),
      })),
    );

    const job = createAttendanceScanJob();
    updateAttendanceScanJob(job.id, {
      status: "queued",
      progress: 3,
      message: "Upload selesai. Scan akan dimulai...",
    });

    void runAttendanceScanJob({
      jobId: job.id,
      eventDate,
      images,
    });

    return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
  } catch (error) {
    console.error("Failed to start OCR attendance scan", error);
    return NextResponse.json({ ok: false, error: "OCR_SCAN_START_FAILED" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const eventDateValue = typeof body?.eventDate === "string" ? body.eventDate.trim() : "";
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId.trim() : "";
    const rawSelections = Array.isArray(body?.selections) ? (body.selections as unknown[]) : [];
    const selections = rawSelections
      .map((item: unknown) => {
        const candidate =
          typeof item === "object" && item !== null
            ? (item as { participantId?: unknown; participantName?: unknown })
            : {};

        return {
          participantId: typeof candidate.participantId === "string" ? candidate.participantId.trim() : "",
          participantName: typeof candidate.participantName === "string" ? candidate.participantName.trim() : "",
        };
      })
      .filter((item) => item.participantId);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDateValue)) {
      return NextResponse.json({ ok: false, error: "INVALID_DATE" }, { status: 400 });
    }

    if (selections.length === 0) {
      return NextResponse.json({ ok: false, error: "SELECTION_REQUIRED" }, { status: 400 });
    }

    const uniqueSelections = Array.from(
      new Map(selections.map((item) => [item.participantId, item])).values(),
    );
    const eventDate = toEventDate(eventDateValue);
    const scanDeviceId = deviceId ? `ocr-scan:${deviceId}` : "ocr-scan";
    const warnings: string[] = [];
    const results: AttendanceScanConfirmResult["results"] = [];
    let createdAttendance = 0;
    let alreadyPresent = 0;

    const existingParticipantIds = uniqueSelections
      .filter((item) => !isNewParticipantSelectionId(item.participantId))
      .map((item) => item.participantId);

    const participants = await prisma.participant.findMany({
      where: {
        id: {
          in: existingParticipantIds,
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    const participantMap = new Map(participants.map((participant) => [participant.id, participant]));

    for (const selection of uniqueSelections) {
      const participant = isNewParticipantSelectionId(selection.participantId)
        ? await findOrCreateParticipantFromScan(selection.participantName, warnings)
        : participantMap.get(selection.participantId);

      if (!participant) {
        results.push({
          participantId: selection.participantId,
          participantName: selection.participantName || "Peserta tidak ditemukan",
          attendanceStatus: "SKIPPED",
          reason: isNewParticipantSelectionId(selection.participantId)
            ? "Nama dari ringkasan belum cukup valid untuk dibuat sebagai peserta baru."
            : "Peserta tidak ditemukan di database.",
        });
        continue;
      }

      const existingAttendance = await prisma.attendance.findUnique({
        where: {
          participantId_eventDate: {
            participantId: participant.id,
            eventDate,
          },
        },
      });

      if (existingAttendance) {
        alreadyPresent += 1;
        results.push({
          participantId: participant.id,
          participantName: participant.name,
          attendanceStatus: "ALREADY_PRESENT",
          reason: "Peserta sudah tercatat hadir pada tanggal ini.",
        });
        continue;
      }

      await prisma.attendance.create({
        data: {
          participantId: participant.id,
          eventDate,
          deviceId: scanDeviceId,
        },
      });

      createdAttendance += 1;
      results.push({
        participantId: participant.id,
        participantName: participant.name,
        attendanceStatus: "CREATED",
        reason: "Presensi berhasil disimpan dari hasil review scan.",
      });
    }

    if (createdAttendance > 0) {
      const syncResult = await syncAttendanceSheetFromDatabase().catch((error) => {
        console.error("Failed to sync attendance sheet after reviewed OCR save", error);
        return { ok: false } as const;
      });

      if (!syncResult.ok) {
        warnings.push("Presensi tersimpan di database, tetapi sync ke sheet gagal.");
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        summary: {
          requested: uniqueSelections.length,
          createdAttendance,
          alreadyPresent,
          skipped: results.filter((item) => item.attendanceStatus === "SKIPPED").length,
        },
        results,
        warnings,
      } satisfies AttendanceScanConfirmResult,
    });
  } catch (error) {
    console.error("Failed to confirm attendance scan", error);
    return NextResponse.json({ ok: false, error: "OCR_SCAN_CONFIRM_FAILED" }, { status: 500 });
  }
}
