import { NextResponse } from "next/server";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { prisma } from "@/lib/prisma";
import { formatJakartaDate, getJakartaDate, toEventDate } from "@/lib/time";

dayjs.extend(utc);

type LuckyDrawParticipant = {
  participantId: string;
  name: string;
  address: string | null;
};

export async function GET() {
  const todayStart = toEventDate();
  const currentWeekStart = dayjs
    .utc(todayStart)
    .startOf("day")
    .subtract(dayjs.utc(todayStart).day(), "day")
    .toDate();

  const latestCompletedWeekDate = await prisma.attendance.findFirst({
    where: {
      eventDate: {
        lt: currentWeekStart,
      },
    },
    select: {
      eventDate: true,
    },
    orderBy: {
      eventDate: "desc",
    },
  });

  if (!latestCompletedWeekDate?.eventDate) {
    return NextResponse.json({
      ok: true,
      sourceDate: null,
      sourceDateEnd: null,
      sourceSessionDates: [] as string[],
      participants: [] as LuckyDrawParticipant[],
      totalParticipants: 0,
      message: "Belum ada data presensi pekan lalu.",
    });
  }

  const weekStart = dayjs
    .utc(latestCompletedWeekDate.eventDate)
    .startOf("day")
    .subtract(dayjs.utc(latestCompletedWeekDate.eventDate).day(), "day")
    .toDate();
  const weekEnd = dayjs.utc(weekStart).add(6, "day").toDate();

  const attendanceRows = await prisma.attendance.findMany({
    where: {
      eventDate: {
        gte: weekStart,
        lte: weekEnd,
      },
    },
    select: {
      participantId: true,
      eventDate: true,
      participant: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
    },
  });

  const uniqueParticipants = new Map<string, LuckyDrawParticipant>();
  const sessions = new Set<string>();

  for (const row of attendanceRows) {
    sessions.add(formatJakartaDate(row.eventDate));
    if (!uniqueParticipants.has(row.participantId)) {
      uniqueParticipants.set(row.participantId, {
        participantId: row.participant.id,
        name: row.participant.name,
        address: row.participant.address,
      });
    }
  }

  const participants = Array.from(uniqueParticipants.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "id"),
  );

  return NextResponse.json({
    ok: true,
    sourceDate: formatJakartaDate(weekStart),
    sourceDateEnd: formatJakartaDate(weekEnd),
    sourceSessionDates: Array.from(sessions).sort((a, b) => a.localeCompare(b)),
    participants,
    totalParticipants: participants.length,
    generatedAt: getJakartaDate().toISOString(),
  });
}
