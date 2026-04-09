import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toEventDate } from "@/lib/time";
import { appendRow } from "@/lib/googleSheets";
import { syncAttendanceSheetFromDatabase } from "@/lib/attendance-sheet-sync";
import { scanAttendanceImagesWithAi, type AttendanceScanImageInput } from "@/lib/ai-attendance";
import {
  findBestParticipantMatch,
  looksLikeHumanName,
  normalizePersonName,
  sanitizeDetectedName,
  toDisplayPersonName,
} from "@/lib/name-matching";
import {
  createAttendanceScanJob,
  getAttendanceScanJob,
  updateAttendanceScanJob,
  type AttendanceScanJobResult,
} from "@/lib/attendance-scan-jobs";

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

function toPublicScanErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "AI_SCAN_FAILED";

  if (message.startsWith("GEMINI_TEMPORARILY_UNAVAILABLE")) {
    return "GEMINI_TEMPORARILY_UNAVAILABLE";
  }

  return message;
}

function findExactParticipantByName(participants: ParticipantRecord[], rawName: string) {
  const normalizedTarget = normalizePersonName(rawName);
  if (!normalizedTarget) {
    return null;
  }

  return (
    participants.find((participant) => normalizePersonName(participant.name) === normalizedTarget) ?? null
  );
}

async function createParticipant(params: {
  participants: ParticipantRecord[];
  resolvedName: string;
  addressHint?: string;
  warnings: string[];
}) {
  const participant = await prisma.participant.create({
    data: {
      name: params.resolvedName,
      address: params.addressHint || null,
      gender: null,
    },
  });

  params.participants.push({
    ...participant,
    gender: participant.gender as "L" | "P" | null,
  });

  const sheetName = process.env.GOOGLE_SHEETS_PARTICIPANTS_SHEET_NAME ?? "Peserta";
  const appendResult = await appendRow(sheetName, [
    participant.createdAt.toISOString(),
    participant.name,
    participant.address ?? "",
    participant.gender ?? "",
  ]).catch((error) => {
    console.error("Failed to append scanned participant to sheet", error);
    return { ok: false } as const;
  });

  if (!appendResult.ok) {
    params.warnings.push(`Gagal sync peserta baru "${participant.name}" ke sheet.`);
  }

  return {
    ...participant,
    gender: participant.gender as "L" | "P" | null,
  } satisfies ParticipantRecord;
}

function resolveParticipantFromDetection(params: {
  participants: ParticipantRecord[];
  resolvedName: string;
  sourceName: string;
  matchedExistingParticipant: boolean;
}) {
  const directCandidates = [params.resolvedName, params.sourceName]
    .map((value) => sanitizeDetectedName(value))
    .filter(Boolean);

  for (const candidate of directCandidates) {
    const exact = findExactParticipantByName(params.participants, candidate);
    if (exact) {
      return {
        participant: exact,
        method: "exact" as const,
      };
    }
  }

  for (const candidate of directCandidates) {
    const fuzzy = findBestParticipantMatch(candidate, params.participants);
    const minimumScore = params.matchedExistingParticipant ? 0.84 : 0.9;

    if (fuzzy && !fuzzy.ambiguous && fuzzy.score >= minimumScore) {
      return {
        participant: fuzzy.participant,
        method: fuzzy.reason,
      };
    }
  }

  return null;
}

function resolveParticipantBeforeCreate(params: {
  participants: ParticipantRecord[];
  proposedName: string;
}) {
  const exact = findExactParticipantByName(params.participants, params.proposedName);
  if (exact) {
    return {
      participant: exact,
      method: "exact" as const,
      shouldCreate: false,
      unresolvedReason: null,
    };
  }

  const fuzzy = findBestParticipantMatch(params.proposedName, params.participants);
  if (fuzzy && !fuzzy.ambiguous && fuzzy.score >= 0.92) {
    return {
      participant: fuzzy.participant,
      method: fuzzy.reason,
      shouldCreate: false,
      unresolvedReason: null,
    };
  }

  if (fuzzy && !fuzzy.ambiguous && fuzzy.score >= 0.78) {
    return {
      participant: fuzzy.participant,
      method: fuzzy.reason,
      shouldCreate: false,
      unresolvedReason: null,
    };
  }

  if (fuzzy && fuzzy.score >= 0.78) {
    return {
      participant: null,
      method: null,
      shouldCreate: false,
      unresolvedReason: `Nama "${params.proposedName}" mirip ke beberapa peserta, jadi ditahan untuk cek manual.`,
    };
  }

  return {
    participant: null,
    method: null,
    shouldCreate: true,
    unresolvedReason: null,
  };
}

async function runAttendanceScanJob(params: {
  jobId: string;
  eventDate: Date;
  deviceId: string;
  images: AttendanceScanImageInput[];
}) {
  try {
    updateAttendanceScanJob(params.jobId, {
      status: "running",
      progress: 6,
      message: "Memuat daftar peserta...",
    });

    const participants = (await prisma.participant.findMany({
      orderBy: { name: "asc" },
    })) as ParticipantRecord[];

    updateAttendanceScanJob(params.jobId, {
      status: "running",
      progress: 12,
      message: `Memulai analisis ${params.images.length} gambar...`,
    });

    const aiResult = await scanAttendanceImagesWithAi({
      images: params.images,
      participants,
      onProgress: ({ progress, message }) => {
        updateAttendanceScanJob(params.jobId, {
          status: "running",
          progress,
          message,
        });
      },
    });

    const warnings = [...aiResult.notes];
    const processedResults: AttendanceScanJobResult["results"] = [];
    const unresolved = [...aiResult.skipped];
    const participantSeenInUpload = new Set<string>();
    const scanDeviceId = params.deviceId ? `ai-scan:${params.deviceId}` : "ai-scan";
    let createdParticipants = 0;
    let createdAttendance = 0;
    let alreadyPresent = 0;
    let duplicateInUpload = 0;
    const totalCandidates = Math.max(aiResult.attendees.length, 1);

    for (let index = 0; index < aiResult.attendees.length; index += 1) {
      const candidate = aiResult.attendees[index];
      updateAttendanceScanJob(params.jobId, {
        status: "running",
        progress: 68 + (index / totalCandidates) * 24,
        message: `Menyimpan hasil ${index + 1} dari ${aiResult.attendees.length}...`,
      });

      const resolved = resolveParticipantFromDetection({
        participants,
        resolvedName: candidate.resolvedName,
        sourceName: candidate.sourceName,
        matchedExistingParticipant: candidate.matchedExistingParticipant,
      });

      let participant = resolved?.participant ?? null;
      let participantStatus: "EXISTING" | "CREATED" = "EXISTING";
      let resolutionMethod: "exact" | "phonetic" | "fuzzy" | "created" = resolved?.method ?? "created";

      if (!participant) {
        const proposedName = toDisplayPersonName(candidate.resolvedName || candidate.sourceName);
        if (!looksLikeHumanName(proposedName)) {
          unresolved.push({
            pageNumber: candidate.pageNumber,
            sourceName: candidate.sourceName || candidate.resolvedName || `halaman-${candidate.pageNumber}`,
            reason: "Nama belum terlihat cukup jelas sebagai nama orang, jadi peserta tidak dibuat otomatis.",
          });
          continue;
        }

        const reuseDecision = resolveParticipantBeforeCreate({
          participants,
          proposedName,
        });

        if (reuseDecision.participant) {
          participant = reuseDecision.participant;
          participantStatus = "EXISTING";
          resolutionMethod = reuseDecision.method ?? "exact";
        } else if (!reuseDecision.shouldCreate) {
          unresolved.push({
            pageNumber: candidate.pageNumber,
            sourceName: candidate.sourceName || candidate.resolvedName || proposedName,
            reason: reuseDecision.unresolvedReason ?? "Nama terlalu mirip dengan peserta yang sudah ada.",
          });
          continue;
        }
      }

      if (!participant) {
        const proposedName = toDisplayPersonName(candidate.resolvedName || candidate.sourceName);
        participant = await createParticipant({
          participants,
          resolvedName: proposedName,
          addressHint: candidate.addressHint,
          warnings,
        });
        participantStatus = "CREATED";
        resolutionMethod = "created";
        createdParticipants += 1;
      }

      if (participantSeenInUpload.has(participant.id)) {
        duplicateInUpload += 1;
        processedResults.push({
          pageNumber: candidate.pageNumber,
          sourceName: candidate.sourceName,
          participantName: participant.name,
          participantId: participant.id,
          participantStatus,
          attendanceStatus: "DUPLICATE_IN_UPLOAD",
          confidence: candidate.confidence,
          resolutionMethod,
          reason: "Nama yang sama terdeteksi lagi pada upload yang sama, jadi dilewati.",
        });
        continue;
      }

      participantSeenInUpload.add(participant.id);

      const existingAttendance = await prisma.attendance.findUnique({
        where: {
          participantId_eventDate: {
            participantId: participant.id,
            eventDate: params.eventDate,
          },
        },
      });

      if (existingAttendance) {
        alreadyPresent += 1;
        processedResults.push({
          pageNumber: candidate.pageNumber,
          sourceName: candidate.sourceName,
          participantName: participant.name,
          participantId: participant.id,
          participantStatus,
          attendanceStatus: "ALREADY_PRESENT",
          confidence: candidate.confidence,
          resolutionMethod,
          reason: "Peserta sudah tercatat hadir pada tanggal ini.",
        });
        continue;
      }

      await prisma.attendance.create({
        data: {
          participantId: participant.id,
          eventDate: params.eventDate,
          deviceId: scanDeviceId,
        },
      });

      createdAttendance += 1;
      processedResults.push({
        pageNumber: candidate.pageNumber,
        sourceName: candidate.sourceName,
        participantName: participant.name,
        participantId: participant.id,
        participantStatus,
        attendanceStatus: "CREATED",
        confidence: candidate.confidence,
        resolutionMethod,
        reason: candidate.reason,
      });
    }

    updateAttendanceScanJob(params.jobId, {
      status: "running",
      progress: 95,
      message: "Menyinkronkan data presensi...",
    });

    if (createdAttendance > 0) {
      const syncResult = await syncAttendanceSheetFromDatabase().catch((error) => {
        console.error("Failed to sync attendance sheet after AI scan", error);
        return { ok: false } as const;
      });

      if (!syncResult.ok) {
        warnings.push("Data presensi tersimpan di database, tetapi sync ke sheet gagal.");
      }
    }

    const result: AttendanceScanJobResult = {
      summary: {
        filesProcessed: params.images.length,
        detectedByAi: aiResult.attendees.length,
        createdAttendance,
        alreadyPresent,
        createdParticipants,
        duplicateInUpload,
        unresolved: unresolved.length,
      },
      results: processedResults,
      unresolved,
      warnings: Array.from(new Set(warnings)),
    };

    updateAttendanceScanJob(params.jobId, {
      status: "completed",
      progress: 100,
      message: "Scan selesai.",
      result,
    });
  } catch (error) {
    console.error("AI attendance scan failed", error);
    const publicErrorCode = toPublicScanErrorCode(error);
    const publicMessage =
      publicErrorCode === "GEMINI_TEMPORARILY_UNAVAILABLE"
        ? "Gemini sedang sibuk. Sistem sudah mencoba ulang beberapa kali."
        : "Scan gagal.";

    updateAttendanceScanJob(params.jobId, {
      status: "failed",
      progress: 100,
      message: publicMessage,
      error: publicErrorCode,
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

  return NextResponse.json({
    ok: true,
    data: job,
  });
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const eventDateValue = String(formData.get("eventDate") ?? "").trim();
    const deviceId = String(formData.get("deviceId") ?? "").trim();
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(eventDateValue)
      ? toEventDate(eventDateValue)
      : toEventDate();

    const files = formData
      .getAll("images")
      .filter((item): item is File => item instanceof File && item.size > 0);

    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: "IMAGE_REQUIRED" }, { status: 400 });
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
      progress: 4,
      message: "Upload selesai. Scan akan dimulai...",
    });

    void runAttendanceScanJob({
      jobId: job.id,
      eventDate,
      deviceId,
      images,
    });

    return NextResponse.json(
      {
        ok: true,
        jobId: job.id,
      },
      { status: 202 },
    );
  } catch (error) {
    console.error("Failed to start AI attendance scan", error);
    return NextResponse.json(
      {
        ok: false,
        error: "AI_SCAN_START_FAILED",
        detail: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      },
      { status: 500 },
    );
  }
}
