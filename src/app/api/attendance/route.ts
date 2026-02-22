import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toEventDate } from "@/lib/time";
import { syncAttendanceSheetFromDatabase } from "@/lib/attendance-sheet-sync";

const markSchema = z.object({
  participantId: z.string().min(1),
  deviceId: z.string().optional(),
  eventDate: z.string().optional(), // YYYY-MM-DD (opsional)
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get("date");
  const range = searchParams.get("range"); // last30 | year | all
  const query = searchParams.get("q")?.trim();
  const take = Number(searchParams.get("limit") ?? "50");
  const id = searchParams.get("id");

  if (!dateParam && !range) {
    return NextResponse.json({ ok: false, error: "DATE_OR_RANGE_REQUIRED" }, { status: 400 });
  }
  if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ ok: false, error: "INVALID_DATE" }, { status: 400 });
  }

  const today = toEventDate();
  const eventDate = dateParam ? toEventDate(dateParam) : null;
  const currentYearStart = toEventDate(`${today.getUTCFullYear()}-01-01`);

  const whereDate =
    range === "all"
      ? undefined
      : range === "last30"
        ? {
            gte: new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000),
            lte: today,
          }
        : range === "year"
          ? {
              gte: currentYearStart,
              lte: today,
            }
          : eventDate
            ? { equals: eventDate }
            : undefined;

  const attendance = await prisma.attendance.findMany({
    where: {
      eventDate: whereDate,
      id: id ?? undefined,
      participant: query
        ? {
            name: { contains: query, mode: "insensitive" },
          }
        : undefined,
    },
    include: {
      participant: true,
    },
    orderBy: { createdAt: "desc" },
    take: Number.isFinite(take) ? Math.min(take, 100) : 50,
  });

  return NextResponse.json({ ok: true, data: attendance });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = markSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }

  const { participantId, deviceId, eventDate: eventDateStr } = parsed.data;
  const eventDate = eventDateStr ? toEventDate(eventDateStr) : toEventDate();

  const existing = await prisma.attendance.findUnique({
    where: {
      participantId_eventDate: {
        participantId,
        eventDate,
      },
    },
    include: { participant: true },
  });

  if (existing) {
    return NextResponse.json({
      ok: true,
      status: "ALREADY_PRESENT",
      data: existing,
    });
  }

  const attendance = await prisma.attendance.create({
    data: {
      participantId,
      eventDate,
      deviceId: deviceId || null,
    },
    include: { participant: true },
  });

  let sheetWarning: string | null = null;
  const syncResult = await syncAttendanceSheetFromDatabase().catch((error) => {
    console.error("Failed to sync attendance sheet", error);
    return { ok: false } as const;
  });

  if (!syncResult.ok) {
    sheetWarning = "SHEET_SYNC_FAILED";
  }

  return NextResponse.json({
    ok: true,
    status: "CREATED",
    data: attendance,
    warning: sheetWarning,
  });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const participantId = searchParams.get("participantId");
  const eventDateParam = searchParams.get("eventDate");

  if (!id && (!participantId || !eventDateParam)) {
    return NextResponse.json({ ok: false, error: "ID_OR_PARTICIPANT_DATE_REQUIRED" }, { status: 400 });
  }

  if (eventDateParam && !/^\d{4}-\d{2}-\d{2}$/.test(eventDateParam)) {
    return NextResponse.json({ ok: false, error: "INVALID_DATE" }, { status: 400 });
  }

  try {
    if (id) {
      await prisma.attendance.delete({ where: { id } });
    } else if (participantId && eventDateParam) {
      await prisma.attendance.delete({
        where: {
          participantId_eventDate: {
            participantId,
            eventDate: toEventDate(eventDateParam),
          },
        },
      });
    }
    await syncAttendanceSheetFromDatabase().catch((error) => {
      console.error("Failed to sync attendance sheet after delete", error);
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "P2025") {
        return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }
    }
    console.error("Failed to delete attendance", error);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
