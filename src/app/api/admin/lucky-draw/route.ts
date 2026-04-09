import { NextResponse } from "next/server";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { prisma } from "@/lib/prisma";
import { formatJakartaDate, getJakartaDate, toEventDate } from "@/lib/time";
import { normalizePersonName } from "@/lib/name-matching";

dayjs.extend(utc);

type LuckyDrawParticipant = {
  participantId: string;
  name: string;
  address: string | null;
};

type AvailableWeek = {
  weekStart: string;
  weekEnd: string;
  sessionDates: string[];
};

function getWeekStartKey(date: Date) {
  return dayjs.utc(date).startOf("day").subtract(dayjs.utc(date).day(), "day").format("YYYY-MM-DD");
}

function choosePreferredText(current: string | null, incoming: string | null) {
  const currentValue = current?.trim() || "";
  const incomingValue = incoming?.trim() || "";

  if (!currentValue) {
    return incomingValue || null;
  }

  if (!incomingValue) {
    return currentValue;
  }

  return incomingValue.length > currentValue.length ? incomingValue : currentValue;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const requestedWeekStart = searchParams.get("weekStart")?.trim() ?? "";
  const todayStart = toEventDate();
  const currentWeekStart = dayjs
    .utc(todayStart)
    .startOf("day")
    .subtract(dayjs.utc(todayStart).day(), "day")
    .toDate();

  const sessionRows = await prisma.attendance.findMany({
    select: {
      eventDate: true,
    },
    distinct: ["eventDate"],
    orderBy: [{ eventDate: "desc" }],
  });

  const availableWeekMap = new Map<string, AvailableWeek>();

  for (const row of sessionRows) {
    const weekStart = getWeekStartKey(row.eventDate);
    const weekEnd = dayjs.utc(toEventDate(weekStart)).add(6, "day").format("YYYY-MM-DD");
    const eventDate = formatJakartaDate(row.eventDate);

    if (!availableWeekMap.has(weekStart)) {
      availableWeekMap.set(weekStart, {
        weekStart,
        weekEnd,
        sessionDates: [],
      });
    }

    const week = availableWeekMap.get(weekStart);
    if (week && !week.sessionDates.includes(eventDate)) {
      week.sessionDates.push(eventDate);
    }
  }

  const availableWeeks = Array.from(availableWeekMap.values()).sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  const latestCompletedWeek = availableWeeks.find((week) => toEventDate(week.weekStart) < currentWeekStart) ?? null;
  const selectedWeek =
    availableWeeks.find((week) => week.weekStart === requestedWeekStart) ??
    latestCompletedWeek ??
    availableWeeks[0] ??
    null;

  if (!selectedWeek) {
    return NextResponse.json({
      ok: true,
      selectedWeekStart: null,
      sourceDate: null,
      sourceDateEnd: null,
      sourceSessionDates: [] as string[],
      availableWeeks: [] as AvailableWeek[],
      participants: [] as LuckyDrawParticipant[],
      totalParticipants: 0,
      message: "Belum ada data presensi mingguan.",
    });
  }

  const weekStart = toEventDate(selectedWeek.weekStart);
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
    const participantKey = normalizePersonName(row.participant.name) || row.participant.id;

    if (!uniqueParticipants.has(participantKey)) {
      uniqueParticipants.set(participantKey, {
        participantId: row.participant.id,
        name: row.participant.name,
        address: row.participant.address,
      });
      continue;
    }

    const existing = uniqueParticipants.get(participantKey);
    if (!existing) {
      continue;
    }

    existing.address = choosePreferredText(existing.address, row.participant.address);
    if (row.participant.name.trim().length > existing.name.trim().length) {
      existing.name = row.participant.name;
    }
  }

  const participants = Array.from(uniqueParticipants.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "id"),
  );

  return NextResponse.json({
    ok: true,
    selectedWeekStart: selectedWeek.weekStart,
    sourceDate: selectedWeek.weekStart,
    sourceDateEnd: selectedWeek.weekEnd,
    sourceSessionDates: Array.from(sessions).sort((a, b) => a.localeCompare(b)),
    availableWeeks,
    participants,
    totalParticipants: participants.length,
    generatedAt: getJakartaDate().toISOString(),
  });
}
