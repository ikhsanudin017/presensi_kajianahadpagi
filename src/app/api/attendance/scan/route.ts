import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toEventDate } from "@/lib/time";
import { appendRow } from "@/lib/googleSheets";
import { syncAttendanceSheetFromDatabase } from "@/lib/attendance-sheet-sync";
import { scanAttendanceImagesWithOcr, type AttendanceScanImageInput } from "@/lib/ocr-attendance";
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

function findExactParticipantByName(participants: ParticipantRecord[], rawName: string) {
  const normalizedTarget = normalizePersonName(rawName);
  if (!normalizedTarget) {
    return null;
  }

  return participants.find((participant) => normalizePersonName(participant.name) === normalizedTarget) ?? null;
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

function resolveParticipantBeforeCreate(params: {
  participants: ParticipantRecord[];
  proposedName: string;
}) {
  const exact = findExactParticipantByName(params.participants, params.proposedName);
  if (exact) {
    return { participant: exact, method: "exact" as const, shouldCreate: false, unresolvedReason: null };
  }

  const fuzzy = findBestParticipantMatch(params.proposedName, params.participants);
  if (fuzzy && !fuzzy.ambiguous && fuzzy.score >= 0.88) {
    return { participant: fuzzy.participant, method: fuzzy.reason, shouldCreate: false, unresolvedReason: null };
  }

  if (fuzzy && fuzzy.score >= 0.78) {
    return {
      participant: null,
      method: null,
      shouldCreate: false,
      unresolvedReason: `Nama "${params.proposedName}" mirip beberapa peserta, jadi ditahan untuk cek manual.`,
    };
  }

  return { participant: null, method: null, shouldCreate: true, unresolvedReason: null };
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

    const ocrResult = await scanAttendanceImagesWithOcr({
      images: params.images,
      participants,
      onProgress: ({ progress, message }) => {
        updateAttendanceScanJob(params.jobId, { status: "running", progress, message });
      },
    });

    const warnings = [...ocrResult.notes];
    const processedResults: AttendanceScanJobResult["results"] = [];
    const unresolved = [...ocrResult.skipped];
    const participantSeenInUpload = new Set<string>();
    const scanDeviceId = params.deviceId ? `ocr-scan:${params.deviceId}` : "ocr-scan";
    let createdParticipants = 0;
    let createdAttendance = 0;
    let alreadyPresent = 0;
    let duplicateInUpload = 0;
    const totalCandidates = Math.max(ocrResult.attendees.length, 1);

    for (let index = 0; index < ocrResult.attendees.length; index += 1) {
      const candidate = ocrResult.attendees[index];
      updateAttendanceScanJob(params.jobId, {
        status: "running",
        progress: 66 + (index / totalCandidates) * 28,
        message: `Menyimpan hasil ${index + 1} dari ${ocrResult.attendees.length}...`,
      });

      let participant =
        findExactParticipantByName(participants, candidate.resolvedName) ??
        findBestParticipantMatch(candidate.resolvedName, participants)?.participant ??
        null;
      let participantStatus: "EXISTING" | "CREATED" = "EXISTING";
      let resolutionMethod: "exact" | "phonetic" | "fuzzy" | "created" =
        participant && normalizePersonName(participant.name) === normalizePersonName(candidate.resolvedName)
          ? "exact"
          : participant
            ? "fuzzy"
            : "created";

      if (!participant) {
        const proposedName = toDisplayPersonName(candidate.resolvedName || candidate.sourceName);
        if (!looksLikeHumanName(proposedName)) {
          unresolved.push({
            pageNumber: candidate.pageNumber,
            sourceName: candidate.sourceName || proposedName,
            reason: "Nama belum cukup jelas untuk membuat peserta baru otomatis.",
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
            sourceName: candidate.sourceName || proposedName,
            reason: reuseDecision.unresolvedReason ?? "Nama terlalu mirip dengan peserta yang sudah ada.",
          });
          continue;
        }
      }

      if (!participant) {
        participant = await createParticipant({
          participants,
          resolvedName: toDisplayPersonName(candidate.resolvedName || candidate.sourceName),
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

    if (createdAttendance > 0) {
      const syncResult = await syncAttendanceSheetFromDatabase().catch((error) => {
        console.error("Failed to sync attendance sheet after OCR scan", error);
        return { ok: false } as const;
      });

      if (!syncResult.ok) {
        warnings.push("Data presensi tersimpan di database, tetapi sync ke sheet gagal.");
      }
    }

    updateAttendanceScanJob(params.jobId, {
      status: "completed",
      progress: 100,
      message: "Scan selesai.",
      result: {
        summary: {
          filesProcessed: params.images.length,
          detectedByOcr: ocrResult.attendees.length,
          createdAttendance,
          alreadyPresent,
          createdParticipants,
          duplicateInUpload,
          unresolved: unresolved.length,
        },
        results: processedResults,
        unresolved,
        warnings: Array.from(new Set(warnings)),
      },
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
    const deviceId = String(formData.get("deviceId") ?? "").trim();
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
      progress: 4,
      message: "Upload selesai. Scan akan dimulai...",
    });

    void runAttendanceScanJob({
      jobId: job.id,
      eventDate,
      deviceId,
      images,
    });

    return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
  } catch (error) {
    console.error("Failed to start OCR attendance scan", error);
    return NextResponse.json({ ok: false, error: "OCR_SCAN_START_FAILED" }, { status: 500 });
  }
}
