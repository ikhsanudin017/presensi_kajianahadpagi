import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatJakartaDate, getJakartaDate, isSunday } from "@/lib/time";

type StreakRow = {
  participantId: string;
  name: string;
  bestStreak: number;
  currentStreak: number;
};

function computeStreaks(records: Array<{ participantId: string; name: string; eventDate: Date }>) {
  const byParticipant = new Map<string, { name: string; dates: string[] }>();
  let lastSunday: string | null = null;

  records.forEach((record) => {
    if (!isSunday(record.eventDate)) {
      return;
    }
    const date = formatJakartaDate(record.eventDate);
    lastSunday = lastSunday ? (date > lastSunday ? date : lastSunday) : date;
    const entry = byParticipant.get(record.participantId) ?? {
      name: record.name,
      dates: [],
    };
    entry.dates.push(date);
    byParticipant.set(record.participantId, entry);
  });

  const results: StreakRow[] = [];

  byParticipant.forEach((value, participantId) => {
    const uniqueDates = Array.from(new Set(value.dates)).sort();
    let bestStreak = 0;
    let currentStreak = 0;

    let streak = 0;
    for (let i = 0; i < uniqueDates.length; i += 1) {
      if (i === 0) {
        streak = 1;
      } else {
        const prev = new Date(uniqueDates[i - 1]);
        const current = new Date(uniqueDates[i]);
        const diffDays = (current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays === 7) {
          streak += 1;
        } else {
          streak = 1;
        }
      }
      bestStreak = Math.max(bestStreak, streak);
    }

    if (lastSunday && uniqueDates.includes(lastSunday)) {
      const lastIndex = uniqueDates.indexOf(lastSunday);
      currentStreak = 1;
      for (let i = lastIndex - 1; i >= 0; i -= 1) {
        const prev = new Date(uniqueDates[i]);
        const next = new Date(uniqueDates[i + 1]);
        const diffDays = (next.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays === 7) {
          currentStreak += 1;
        } else {
          break;
        }
      }
    }

    results.push({
      participantId,
      name: value.name,
      bestStreak,
      currentStreak,
    });
  });

  return results;
}

export async function GET() {
  const attendance = await prisma.attendance.findMany({
    select: {
      participantId: true,
      eventDate: true,
      participant: { select: { name: true } },
    },
  });

  const records = attendance.map((row) => ({
    participantId: row.participantId,
    name: row.participant.name,
    eventDate: row.eventDate,
  }));

  const streaks = computeStreaks(records)
    .sort((a, b) => b.bestStreak - a.bestStreak || b.currentStreak - a.currentStreak)
    .slice(0, 10);

  const lastSundayData = records
    .map((record) => (isSunday(record.eventDate) ? record.eventDate : null))
    .filter(Boolean)
    .sort((a, b) => (a as Date).getTime() - (b as Date).getTime())
    .pop();

  const lastSundayLabel = lastSundayData ? formatJakartaDate(lastSundayData as Date) : null;

  return NextResponse.json({
    ok: true,
    data: streaks,
    lastSunday: lastSundayLabel,
    generatedAt: getJakartaDate().toISOString(),
  });
}
