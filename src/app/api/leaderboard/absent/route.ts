import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { eventDateToKey, getJakartaDate, toEventDate } from "@/lib/time";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const weeksParam = Number(searchParams.get("weeks") ?? "4");
  const safeWeeks = Number.isFinite(weeksParam) && weeksParam > 0 && weeksParam <= 52 ? Math.floor(weeksParam) : 4;

  const endOfWeekJakarta = getJakartaDate().endOf("week");
  const startDateKey = endOfWeekJakarta.subtract(safeWeeks - 1, "week").startOf("week").format("YYYY-MM-DD");
  const endDateKey = endOfWeekJakarta.format("YYYY-MM-DD");
  const startDate = toEventDate(startDateKey);
  const endDate = toEventDate(endDateKey);

  const attendance = await prisma.attendance.findMany({
    where: {
      eventDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    include: { participant: { select: { id: true, name: true } } },
  });

  // only count sessions (kajian) that actually happened in the range,
  // identified by unique eventDate values that have at least one attendance row
  const sessionDates = Array.from(
    new Set(attendance.map((row) => eventDateToKey(row.eventDate))),
  );
  const sessionsCount = sessionDates.length;

  const participants = await prisma.participant.findMany({
    select: { id: true, name: true },
  });

  const attendanceMap = new Map<string, Set<string>>(); // participantId -> set of session date keys

  for (const row of attendance) {
    const sessionKey = eventDateToKey(row.eventDate);
    if (!attendanceMap.has(row.participantId)) {
      attendanceMap.set(row.participantId, new Set());
    }
    attendanceMap.get(row.participantId)!.add(sessionKey);
  }

  const absentList = participants
    .map((p) => {
      const presentSessions = attendanceMap.get(p.id);
      const presentCount = presentSessions ? presentSessions.size : 0;
      return {
        participantId: p.id,
        name: p.name,
        attended: presentCount,
        absent: Math.max(sessionsCount - presentCount, 0),
      };
    })
    .filter((row) => row.absent > 0 && sessionsCount > 0)
    .sort((a, b) => b.absent - a.absent || a.name.localeCompare(b.name))
    .slice(0, 10);

  return NextResponse.json({
    ok: true,
    range: {
      start: startDateKey,
      end: endDateKey,
      weeks: safeWeeks,
      sessions: sessionsCount,
      sessionDates,
    },
    data: absentList,
  });
}
