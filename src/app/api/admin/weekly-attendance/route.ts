import { NextResponse } from "next/server";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { prisma } from "@/lib/prisma";
import { eventDateToKey, getJakartaDate, toEventDate } from "@/lib/time";
import { normalizePersonName } from "@/lib/name-matching";
import { syncAttendanceSheetFromDatabase } from "@/lib/attendance-sheet-sync";

dayjs.extend(utc);

type WeeklyParticipant = {
  mergeKey: string;
  participantIds: string[];
  name: string;
  address: string | null;
  attendedSessions: number;
  attendedDates: string[];
  dateTargets: Array<{
    eventDate: string;
    participantIds: string[];
  }>;
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

function normalizeWeeklyKey(name: string) {
  return normalizePersonName(name) || name.trim().toLowerCase();
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
          mergeKey: string;
          participantIds: Set<string>;
          name: string;
          address: string | null;
          datesMap: Map<string, Set<string>>;
        }
      >;
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
      });
    }

    const weekGroup = weeklyMap.get(weekStartKey);
    if (!weekGroup) {
      continue;
    }

    weekGroup.sessionDates.add(eventDateKey);
    const mergeKey = normalizeWeeklyKey(row.participant.name);

    if (!weekGroup.participantsMap.has(mergeKey)) {
      weekGroup.participantsMap.set(mergeKey, {
        mergeKey,
        participantIds: new Set<string>(),
        name: row.participant.name,
        address: row.participant.address,
        datesMap: new Map<string, Set<string>>(),
      });
    }

    const participantGroup = weekGroup.participantsMap.get(mergeKey);
    if (!participantGroup) {
      continue;
    }

    participantGroup.participantIds.add(row.participant.id);
    participantGroup.name = choosePreferredText(participantGroup.name, row.participant.name) ?? row.participant.name;
    participantGroup.address = choosePreferredText(participantGroup.address, row.participant.address);

    if (!participantGroup.datesMap.has(eventDateKey)) {
      participantGroup.datesMap.set(eventDateKey, new Set<string>());
    }
    participantGroup.datesMap.get(eventDateKey)?.add(row.participant.id);
  }

  const data: WeeklyGroup[] = Array.from(weeklyMap.values())
    .map((group) => {
      const participants: WeeklyParticipant[] = Array.from(group.participantsMap.values())
        .map((participant) => {
          const dateTargets = Array.from(participant.datesMap.entries())
            .map(([eventDate, participantIds]) => ({
              eventDate,
              participantIds: Array.from(participantIds.values()).sort((a, b) => a.localeCompare(b)),
            }))
            .sort((a, b) => a.eventDate.localeCompare(b.eventDate));
          const attendedDates = dateTargets.map((item) => item.eventDate);
          return {
            mergeKey: participant.mergeKey,
            participantIds: Array.from(participant.participantIds.values()).sort((a, b) => a.localeCompare(b)),
            name: participant.name,
            address: participant.address,
            attendedSessions: attendedDates.length,
            attendedDates,
            dateTargets,
          };
        })
        .sort((a, b) => b.attendedSessions - a.attendedSessions || a.name.localeCompare(b.name, "id"));

      const sessionDates = Array.from(group.sessionDates).sort((a, b) => a.localeCompare(b));
      const totalAttendance = participants.reduce((sum, participant) => sum + participant.attendedSessions, 0);

      return {
        weekStart: group.weekStart,
        weekEnd: group.weekEnd,
        sessionDates,
        sessionsCount: sessionDates.length,
        uniqueParticipants: participants.length,
        totalAttendance,
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

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = body as
    | {
        weekStart?: string;
        participantIds?: string[];
        eventDate?: string;
      }
    | null;

  if (!parsed) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }

  const { weekStart, participantIds, eventDate } = parsed;

  try {
    if (weekStart) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
        return NextResponse.json({ ok: false, error: "INVALID_WEEK_START" }, { status: 400 });
      }

      const start = toEventDate(weekStart);
      const end = dayjs.utc(start).add(6, "day").toDate();
      const deleted = await prisma.attendance.deleteMany({
        where: {
          eventDate: {
            gte: start,
            lte: end,
          },
        },
      });

      await syncAttendanceSheetFromDatabase().catch((error) => {
        console.error("Failed to sync attendance sheet after weekly delete", error);
      });

      return NextResponse.json({ ok: true, deletedCount: deleted.count });
    }

    if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !participantIds?.length) {
      return NextResponse.json({ ok: false, error: "PARTICIPANTS_AND_DATE_REQUIRED" }, { status: 400 });
    }

    const deleted = await prisma.attendance.deleteMany({
      where: {
        participantId: {
          in: participantIds,
        },
        eventDate: toEventDate(eventDate),
      },
    });

    await syncAttendanceSheetFromDatabase().catch((error) => {
      console.error("Failed to sync attendance sheet after merged delete", error);
    });

    return NextResponse.json({ ok: true, deletedCount: deleted.count });
  } catch (error) {
    console.error("Failed to delete weekly attendance", error);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
