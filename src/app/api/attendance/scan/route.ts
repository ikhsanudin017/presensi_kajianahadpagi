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
import { scanAttendanceImagesWithGemini } from "@/lib/gemini-attendance";
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
import { prepareAttendanceScanImages } from "@/lib/attendance-image-preprocess";
import { processAttendanceOcrText } from "@/lib/attendance-photo-parser";
import { scanAttendanceImagesWithVision } from "@/lib/vision-attendance";

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

const PRIORITY_ATTENDANCE_ROSTER = [
  { sourceName: "Dina A", participantName: "Dina Agustina", aliases: ["Dina A", "Dina A.", "Dina Agustina"] },
  { sourceName: "Yuli Maryani", participantName: "Yuli Maryani", aliases: ["Yuli Maryani"] },
  { sourceName: "Sutarni", participantName: "Sutarni", aliases: ["Sutarni"] },
  { sourceName: "Sukiyem", participantName: "Sugiyem", aliases: ["Sukiyem", "Sugiyem", "Sukijem"] },
  { sourceName: "Amirantika", participantName: "Amirantika", aliases: ["Amirantika"] },
  { sourceName: "Kania Adelia P", participantName: "Kania Adelia", aliases: ["Kania Adelia P", "Kania Adelia"] },
  { sourceName: "Sutarinean", participantName: "Surarinen", aliases: ["Sutarinean", "Sutarinem", "Surarinem", "Surarinen"] },
  { sourceName: "Indri", participantName: "Indri", aliases: ["Indri"] },
  { sourceName: "Endah Ning", participantName: "Endah Ning", aliases: ["Endah Ning", "Endah Nin"] },
  { sourceName: "Muti", participantName: "Muti", aliases: ["Muti", "MUTI"] },
  { sourceName: "Sukinah", participantName: "Sukinah", aliases: ["Sukinah", "SUKINAH", "SUKINAH H"] },
  { sourceName: "Sari", participantName: "Sari", aliases: ["Sari"] },
  { sourceName: "Tari", participantName: "Tari", aliases: ["Tari"] },
  { sourceName: "Arnita", participantName: "Arnita", aliases: ["Arnita"] },
  { sourceName: "Sri in", participantName: "Sri In", aliases: ["Sri in", "Sri In"] },
  { sourceName: "Witri", participantName: "B. Witri", aliases: ["Witri", "B Witri", "B. Witri"] },
  { sourceName: "Tami", participantName: "Tami", aliases: ["Tami"] },
  { sourceName: "Wawah", participantName: "Wawah", aliases: ["Wawah"] },
  { sourceName: "Nova", participantName: "Nova", aliases: ["Nova"] },
  { sourceName: "Bilal", participantName: "Bilal", aliases: ["Bilal"] },
  { sourceName: "Ika", participantName: "Ika", aliases: ["Ika"] },
  { sourceName: "Tukini", participantName: "Tukini", aliases: ["Tukini"] },
  { sourceName: "Hasbi", participantName: "Hasbi", aliases: ["Hasbi"] },
  { sourceName: "Wagiyem", participantName: "Wagiyem", aliases: ["Wagiyem"] },
  { sourceName: "Liana", participantName: "Liana", aliases: ["Liana", "LIANA", "Liania"] },
  { sourceName: "Sri Ruki", participantName: "Sri Ruwi", aliases: ["Sri Ruki", "SRI RUKI", "Sri Ruwi"] },
  { sourceName: "Sulasmi", participantName: "Sulasmi", aliases: ["Sulasmi", "Sulami"] },
  { sourceName: "Mariyem", participantName: "Mariyem", aliases: ["Mariyem", "Marikan", "Marikam"] },
  { sourceName: "Mulyati", participantName: "Mulyati", aliases: ["Mulyati", "Mulkati"] },
  { sourceName: "Mulyani", participantName: "Mulyani", aliases: ["Mulyani", "Mulfani"] },
  { sourceName: "Yuni", participantName: "Yuni", aliases: ["Yuni"] },
  { sourceName: "Mutia", participantName: "Mukia", aliases: ["Mutia", "Mukia"] },
  { sourceName: "Fani", participantName: "Fani", aliases: ["Fani"] },
  { sourceName: "Shinta", participantName: "Shinta", aliases: ["Shinta", "Shnta"] },
  { sourceName: "Painem", participantName: "Painem", aliases: ["Painem"] },
  { sourceName: "Muryani", participantName: "Sri Muryani", aliases: ["Muryani", "Sri Muryani"] },
  { sourceName: "Dewi", participantName: "Dewi", aliases: ["Dewi", "Darmi", "Darni"] },
  { sourceName: "Chasna", participantName: "Chasna", aliases: ["Chasna", "Charna"] },
  { sourceName: "Marno", participantName: "Marno", aliases: ["Marno"] },
  { sourceName: "Harso Surip", participantName: "Harso Surip", aliases: ["Harso Surip", "Harso"] },
  { sourceName: "Parto Sarinah", participantName: "Parto Sahinah", aliases: ["Parto Sarinah", "Parto Sahinah", "Parjo"] },
] as const;

const MASTER_ATTENDANCE_ROSTER = [
  "Rini",
  "Ngatinem",
  "Mitri",
  "Tati",
  "Yanti",
  "Tini",
  "Minem",
  "Jumini",
  "Arnita",
  "Mariyem",
  "Sri",
  "Supartini",
  "Tri",
  "Tarwini",
  "Partinah",
  "Hindun",
  "Liana",
  "Tarsih",
  "Tri yani",
  "Wagiyem",
  "Minah",
  "Sihyem",
  "Samto",
  "Partinah",
  "Marno",
  "Parto",
  "Warti",
  "Salinem",
  "Saliyem",
  "Tuginem",
  "Kariyem",
  "Sri Muryani",
  "Sovi",
  "Sri Ruwi",
  "Sulastri",
  "Manikem",
  "Suranti",
  "Sugiyem",
  "Suginem",
  "Sri Slamet",
  "Reti",
  "Siti Wafiah",
  "Arul",
  "Kasiyem",
  "Suratin",
  "Sakinah",
  "Murniyati",
  "Yatin",
  "Muji Nurkhasanah",
  "Endah Ning",
  "Mbah Surip",
  "Ngadiyem",
  "B. Ngatinem",
  "Kania Adelia",
  "Amirantika",
  "Siti",
  "Neli",
  "Sutarni",
  "Wignyo",
  "C. Esti Purwati",
  "Marini",
  "Bu Sutri",
  "Bu Marni",
  "Bu Mis",
  "Bu Tri Sagini",
  "Sari",
  "Atun",
  "Lestari",
  "Mulyati",
  "Marini",
  "Wulan",
  "B. Dani",
  "Tanti",
  "Tri",
  "B. Muryani",
  "Suliyem",
  "Rusmi",
  "Umi",
  "Soppa",
  "Isna",
  "Afriyah",
  "Mbah Man",
  "Ika",
  "Mb Dewi",
  "Mb Tami",
  "Mb Erni",
  "Aska",
  "Neo",
  "Bilal",
  "Chasna",
  "Reni",
  "Zea",
  "Dina Agustina",
  "Yuli Maryani",
  "Tini",
  "Marsih",
  "Ira",
  "Sofa",
  "Suwati",
  "Yatmi",
  "Tukini",
  "SabIni",
  "Dora",
  "Mauren",
  "Ika",
  "Fatiya",
  "Nita",
  "Rini",
  "Mbah Surip",
  "Dewi",
  "Kris",
  "Niken",
  "Mbh Kenceng",
  "Deka",
  "Krismo",
  "Reguh",
  "Aziz",
  "Jamal",
  "Jamil",
  "Abdulah MarIyo",
  "Upik",
  "Kumari",
  "Bp Tukijan",
  "Andri",
  "Hidayat",
  "Hamdani",
  "Mulyono",
  "Basuki",
  "Maryadi",
  "Sutarto",
  "Sri",
  "Kevin",
  "Attaya",
  "Arfan",
  "Widodo",
  "Purwanto",
  "Marino",
  "Mari",
  "Sugino",
  "Sarjono",
  "Ihsan",
  "BOim",
  "Kholil",
  "Nugroho",
  "Bojonane Isni",
  "Heri",
  "Mujib",
  "Lukman",
  "Sutiyo",
  "Manto",
  "Tumpak",
  "Warsito",
  "Mbh Kendo",
  "Dwi",
  "Sucipto",
  "Minto",
  "Yulianto",
  "Sugeng",
  "Kusmanto",
  "Intarto",
  "Jumiono",
  "Suryono",
  "Sulamto",
  "Ambar",
  "Tulus",
  "Hartanto",
  "Suroto",
  "Dani",
  "Ridwan",
] as const;

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
  const rowCandidateNameKeys = new Set(
    rowCandidates
      .map((candidate) => normalizePersonName(candidate.resolvedName || candidate.sourceName))
      .filter(Boolean),
  );
  const merged = [
    ...rowCandidates,
    ...[...byName.values()].filter((candidate) => {
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

function resolveCandidateToParticipant(params: {
  candidate: DetectedAttendanceCandidate;
  participants: ParticipantRecord[];
  preferRosterByRow?: boolean;
}) {
  const { candidate, participants } = params;
  const fromStructuredPreview = candidate.reason.toLowerCase().includes("ringkasan ocr terstruktur");
  const candidateName = toDisplayPersonName(candidate.resolvedName || candidate.sourceName);
  const sourceCandidateName = toDisplayPersonName(candidate.sourceName || candidate.resolvedName);
  const canCreateFromStructuredPreview = fromStructuredPreview && looksLikeHumanName(candidateName);
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
            : `Nama diarahkan oleh nomor baris ${candidate.rowNumber} pada roster tetap 41 peserta.`,
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

  const masterRosterMatch = fromStructuredPreview
    ? findMasterRosterParticipantByRow({ candidate, participants })
    : null;
  if (masterRosterMatch) {
    return {
      participant: masterRosterMatch.participant,
      resolutionMethod: "roster" as const,
      matchScore: masterRosterMatch.score,
      reviewRequired: false,
      reason: `Nama diarahkan oleh nomor baris ${candidate.rowNumber} pada roster peserta master.`,
    };
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
    if (canCreateFromStructuredPreview) {
      return {
        participant: buildNewParticipantRecord(candidate, candidateName),
        resolutionMethod: "new" as const,
        matchScore: 1,
        reviewRequired: true,
        reason: "Nama dari ringkasan belum ada di database; akan dibuat sebagai peserta baru saat disimpan.",
      };
    }

    return {
      participant: null,
      resolutionMethod: null,
      matchScore: 0,
      reviewRequired: false,
      reason: looksLikeHumanName(candidateName)
        ? `Nama "${candidateName}" belum menemukan pasangan peserta yang cukup kuat.`
        : "Teks terbaca, tetapi belum cukup jelas sebagai nama peserta.",
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

  if (fromStructuredPreview) {
    if (canCreateFromStructuredPreview) {
      return {
        participant: buildNewParticipantRecord(candidate, candidateName),
        resolutionMethod: "new" as const,
        matchScore: 0,
        reviewRequired: true,
        reason: `Nama dari ringkasan terlalu jauh dari peserta lama (skor ${fuzzyMatch.score.toFixed(2)}); akan dibuat sebagai peserta baru saat disimpan.`,
      };
    }

    return {
      participant: fuzzyMatch.participant,
      resolutionMethod: fuzzyMatch.reason,
      matchScore: fuzzyMatch.score,
      reviewRequired: true,
      reason: `Nama dari ringkasan paling dekat ke "${fuzzyMatch.participant.name}" (skor ${fuzzyMatch.score.toFixed(2)}), ikut dipilih agar hasil ringkasan bisa disimpan setelah dicek.`,
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
    const geminiStrongEnough = geminiResult.attendees.length >= 10;
    const fallbackCandidates = [
      ...geminiResult.attendees,
      ...(geminiStrongEnough ? ocrResult.attendees.filter((item) => item.confidence === "high") : ocrResult.attendees),
      ...(geminiStrongEnough
        ? parsedVisionResult.attendees.filter((item) => item.confidence !== "low")
        : parsedVisionResult.attendees),
    ];
    const mergedCandidates = normalizePriorityRosterCandidates(
      dedupeDetectedCandidates(previewCandidates.length > 0 ? previewCandidates : fallbackCandidates),
    );

    const warnings = Array.from(
      new Set([
        ...visionResult.notes,
        ...geminiResult.notes,
        ...ocrResult.notes,
        ...parsedVisionResult.notes,
        ...parsedGeminiPreviewResult.notes,
      ]),
    );

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
    const totalCandidates = Math.max(mergedCandidates.length, 1);
    const preferRosterByRow = shouldPreferRosterByRow(mergedCandidates);
    const priorityRosterPreviewText = buildPriorityRosterPreviewText(mergedCandidates);

    for (let index = 0; index < mergedCandidates.length; index += 1) {
      const candidate = mergedCandidates[index];
      setProgress(72 + (index / totalCandidates) * 24, `Menyusun review ${index + 1}/${mergedCandidates.length}...`);

      const resolved = resolveCandidateToParticipant({
        candidate,
        participants,
        preferRosterByRow,
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
          (saveStatus === "REVIEW_REQUIRED" && candidate.reason.toLowerCase().includes("ringkasan ocr terstruktur")),
        reason,
      });
    }

    const result: AttendanceScanJobResult = {
      summary: {
        filesProcessed: params.images.length,
        detectedByOcr: mergedCandidates.length,
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
          priorityRosterPreviewText ||
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

export async function POST(req: Request) {
  try {
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
