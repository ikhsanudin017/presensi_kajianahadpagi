import { NextResponse } from "next/server";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { prisma } from "@/lib/prisma";
import { eventDateToKey, getJakartaDate, toEventDate } from "@/lib/time";

dayjs.extend(utc);

type WeeklyParticipant = {
  participantId: string;
  name: string;
  address: string | null;
  attendedSessions: number;
  attendedDates: string[];
};

type WeeklyGroup = {
  weekStart: string;
  weekEnd: string;
  sessionDates: string[];
  sessionsCount: number;
  uniqueParticipants: number;
  totalAttendance: number;
  participants: WeeklyParticipant[];
};

function getWeekStart(date: Date) {
  const eventDate = dayjs.utc(date).startOf("day");
  return eventDate.subtract(eventDate.day(), "day");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const weeksParam = Number(searchParams.get("weeks") ?? "12");
  const safeWeeks = Number.isFinite(weeksParam) && weeksParam > 0 && weeksParam <= 52 ? Math.floor(weeksParam) : 12;

  const todayJakarta = getJakartaDate().startOf("day");
  const today = toEventDate(todayJakarta.format("YYYY-MM-DD"));
  const rangeStart = toEventDate(
    todayJakarta.subtract(safeWeeks - 1, "week").startOf("week").format("YYYY-MM-DD"),
  );

  const rows = await prisma.attendance.findMany({
    where: {
      eventDate: {
        gte: rangeStart,
        lte: today,
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
    orderBy: [{ eventDate: "desc" }, { participant: { name: "asc" } }],
  });

  const weeklyMap = new Map<
    string,
    {
      weekStart: string;
      weekEnd: string;
      sessionDates: Set<string>;
      participantsMap: Map<
        string,
        {
          participantId: string;
          name: string;
          address: string | null;
          attendedDates: Set<string>;
        }
      >;
      totalAttendance: number;
    }
  >();

  for (const row of rows) {
    const weekStart = getWeekStart(row.eventDate);
    const weekStartKey = weekStart.format("YYYY-MM-DD");
    const weekEndKey = weekStart.add(6, "day").format("YYYY-MM-DD");
    const eventDateKey = eventDateToKey(row.eventDate);

    if (!weeklyMap.has(weekStartKey)) {
      weeklyMap.set(weekStartKey, {
        weekStart: weekStartKey,
        weekEnd: weekEndKey,
        sessionDates: new Set<string>(),
        participantsMap: new Map(),
        totalAttendance: 0,
      });
    }

    const weekGroup = weeklyMap.get(weekStartKey);
    if (!weekGroup) {
      continue;
    }

    weekGroup.totalAttendance += 1;
    weekGroup.sessionDates.add(eventDateKey);

    if (!weekGroup.participantsMap.has(row.participantId)) {
      weekGroup.participantsMap.set(row.participantId, {
        participantId: row.participant.id,
        name: row.participant.name,
        address: row.participant.address,
        attendedDates: new Set<string>(),
      });
    }

    weekGroup.participantsMap.get(row.participantId)?.attendedDates.add(eventDateKey);
  }

  const data: WeeklyGroup[] = Array.from(weeklyMap.values())
    .map((group) => {
      const participants: WeeklyParticipant[] = Array.from(group.participantsMap.values())
        .map((participant) => {
          const attendedDates = Array.from(participant.attendedDates).sort((a, b) => a.localeCompare(b));
          return {
            participantId: participant.participantId,
            name: participant.name,
            address: participant.address,
            attendedSessions: attendedDates.length,
            attendedDates,
          };
        })
        .sort((a, b) => b.attendedSessions - a.attendedSessions || a.name.localeCompare(b.name, "id"));

      const sessionDates = Array.from(group.sessionDates).sort((a, b) => a.localeCompare(b));

      return {
        weekStart: group.weekStart,
        weekEnd: group.weekEnd,
        sessionDates,
        sessionsCount: sessionDates.length,
        uniqueParticipants: participants.length,
        totalAttendance: group.totalAttendance,
        participants,
      };
    })
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart));

  return NextResponse.json({
    ok: true,
    data,
    meta: {
      weeksRequested: safeWeeks,
      generatedAt: getJakartaDate().toISOString(),
    },
  });
}
