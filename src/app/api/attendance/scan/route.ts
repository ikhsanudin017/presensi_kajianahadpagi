import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toEventDate } from "@/lib/time";
import { syncAttendanceSheetFromDatabase } from "@/lib/attendance-sheet-sync";
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

const PRIORITY_ATTENDANCE_ROSTER = [
  "Dina A",
  "Yuli Maryani",
  "Sutarni",
  "Sukiyem",
  "Amirantika",
  "Kania Adelia P",
  "Sutarinem",
  "Indri",
  "Endah Ning",
  "Muti",
  "Sukinah",
  "Sari",
  "Tari",
  "Arnita",
  "Sri In",
  "Witri",
  "Tami",
  "Wawah",
  "Nova",
  "Bilal",
  "Ika",
  "Tukini",
  "Hasbi",
  "Wagiyem",
  "Liania",
  "Sri Ruki",
  "Sulasmi",
  "Mariham",
  "Mulyati",
  "Mulyani",
  "Yuni",
  "Mutia",
  "Fani",
  "Shinta",
  "Painem",
  "Muryani",
  "Desi",
  "Chasna",
  "Marno",
  "Harso Surip",
  "Parto Sarinah",
] as const;

const DETECTED_CONFIDENCE_SCORE = { high: 3, medium: 2, low: 1 } as const;

function getPriorityRosterName(rowNumber?: number) {
  if (!rowNumber || rowNumber < 1) {
    return null;
  }

  return PRIORITY_ATTENDANCE_ROSTER[rowNumber - 1] ?? null;
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

  return Array.from(new Set([...byRow.values(), ...byName.values()])).sort((a, b) => {
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

function buildReviewItemId(candidate: DetectedAttendanceCandidate, participantId: string) {
  const normalizedSource = normalizePersonName(candidate.resolvedName || candidate.sourceName || "scan");
  return [participantId, candidate.pageNumber, candidate.rowNumber ?? "x", normalizedSource].join(":");
}

function shouldPreferRosterByRow(candidates: DetectedAttendanceCandidate[]) {
  const uniqueRows = new Set(
    candidates
      .map((candidate) => candidate.rowNumber)
      .filter((rowNumber): rowNumber is number => typeof rowNumber === "number" && rowNumber >= 1 && rowNumber <= PRIORITY_ATTENDANCE_ROSTER.length),
  );

  // Jika mayoritas besar dari 41 baris roster terdeteksi, anggap ini lembar roster tetap
  // dan prioritaskan nomor baris dibanding ejaan OCR yang mudah meleset.
  return uniqueRows.size >= 30;
}

function resolveCandidateToParticipant(params: {
  candidate: DetectedAttendanceCandidate;
  participants: ParticipantRecord[];
  preferRosterByRow?: boolean;
}) {
  const { candidate, participants } = params;
  const candidateName = toDisplayPersonName(candidate.resolvedName || candidate.sourceName);
  const rowRosterName = getPriorityRosterName(candidate.rowNumber);
  const rowRosterParticipant = rowRosterName ? findExactParticipantByName(participants, rowRosterName) : null;
  const rowRosterComparison =
    rowRosterParticipant && rowRosterName
      ? findBestParticipantMatch(candidateName, [{ id: rowRosterParticipant.id, name: rowRosterName }])
      : null;

  if (rowRosterParticipant && rowRosterName && params.preferRosterByRow) {
    const fuzzyAgainstAll = findBestParticipantMatch(candidateName, participants);
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

    const geminiStrongEnough = geminiResult.attendees.length >= 10;
    const mergedCandidates = dedupeDetectedCandidates([
      ...geminiResult.attendees,
      ...(geminiStrongEnough ? ocrResult.attendees.filter((item) => item.confidence === "high") : ocrResult.attendees),
      ...(geminiStrongEnough
        ? parsedVisionResult.attendees.filter((item) => item.confidence !== "low")
        : parsedVisionResult.attendees),
    ]);

    const warnings = Array.from(
      new Set([
        ...visionResult.notes,
        ...geminiResult.notes,
        ...ocrResult.notes,
        ...parsedVisionResult.notes,
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
    ]);

    const reviewItems: AttendanceScanJobResult["reviewItems"] = [];
    const unresolved: AttendanceScanJobResult["unresolved"] = [...unresolvedSeed];
    const participantSeenInScan = new Set<string>();
    const totalCandidates = Math.max(mergedCandidates.length, 1);
    const preferRosterByRow = shouldPreferRosterByRow(mergedCandidates);

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

      if (participantSeenInScan.has(resolved.participant.id)) {
        saveStatus = "DUPLICATE_IN_SCAN";
        reason = "Peserta yang sama terdeteksi lagi pada scan yang sama, jadi tidak dipilih otomatis.";
      } else {
        participantSeenInScan.add(resolved.participant.id);
      }

      if (saveStatus !== "DUPLICATE_IN_SCAN") {
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
        selectedByDefault: saveStatus === "READY",
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
        previewText: geminiResult.previewText || parsedVisionResult.previewText || visionResult.pages.map((page) => page.text).join("\n\n").trim(),
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

    const participants = await prisma.participant.findMany({
      where: {
        id: {
          in: uniqueSelections.map((item) => item.participantId),
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    const participantMap = new Map(participants.map((participant) => [participant.id, participant]));

    for (const selection of uniqueSelections) {
      const participant = participantMap.get(selection.participantId);
      if (!participant) {
        results.push({
          participantId: selection.participantId,
          participantName: selection.participantName || "Peserta tidak ditemukan",
          attendanceStatus: "SKIPPED",
          reason: "Peserta tidak ditemukan di database.",
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
