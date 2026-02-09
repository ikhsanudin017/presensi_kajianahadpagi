import { NextResponse } from "next/server";
import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import { prisma } from "@/lib/prisma";
import { getJakartaDate, isSunday, formatJakartaDate } from "@/lib/time";

dayjs.extend(isBetween);

type StreakRow = {
  participantId: string;
  name: string;
  bestStreak: number;
  currentStreak: number;
};

function csvEscape(value: string) {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function getStartDate(range: string | null) {
  const now = getJakartaDate();
  if (range === "30d" || range === "last30") {
    return now.subtract(30, "day").startOf("day").toDate();
  }
  if (range === "90d") {
    return now.subtract(90, "day").startOf("day").toDate();
  }
  if (range === "year") {
    return now.startOf("year").startOf("day").toDate();
  }
  return null;
}

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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") ?? "all";
  const weeksParam = Number(searchParams.get("weeks") ?? "24");
  const safeWeeks = Number.isFinite(weeksParam) && weeksParam > 0 && weeksParam <= 52 ? Math.floor(weeksParam) : 4;
  const startDate = getStartDate(range === "all" ? null : range);

  // Total hadir
  const grouped = await prisma.attendance.groupBy({
    by: ["participantId"],
    where: startDate ? { eventDate: { gte: startDate } } : undefined,
    _count: { participantId: true },
    orderBy: { _count: { participantId: "desc" } },
  });
  const participants = await prisma.participant.findMany({
    where: { id: { in: grouped.map((row) => row.participantId) } },
  });
  const lookup = new Map(participants.map((p) => [p.id, p]));
  const totals = grouped.map((row) => ({
    participantId: row.participantId,
    name: lookup.get(row.participantId)?.name ?? "Unknown",
    total: row._count.participantId,
  }));

  // Streak (all time)
  const attendanceAll = await prisma.attendance.findMany({
    select: { participantId: true, eventDate: true, participant: { select: { name: true } } },
  });
  const streaks = computeStreaks(
    attendanceAll.map((r) => ({ participantId: r.participantId, name: r.participant.name, eventDate: r.eventDate })),
  );

  // Absent (berdasarkan sesi dalam rentang weeks)
  const endDate = dayjs().endOf("week");
  const startWeek = endDate.subtract(safeWeeks - 1, "week").startOf("week");
  const attendanceRange = attendanceAll.filter(
    (r) => dayjs(r.eventDate).isBetween(startWeek, endDate, "day", "[]"),
  );
  const sessionDates = Array.from(new Set(attendanceRange.map((row) => dayjs(row.eventDate).format("YYYY-MM-DD"))));
  const sessionsCount = sessionDates.length;
  const attendanceMap = new Map<string, Set<string>>();
  for (const row of attendanceRange) {
    const key = dayjs(row.eventDate).format("YYYY-MM-DD");
    if (!attendanceMap.has(row.participantId)) attendanceMap.set(row.participantId, new Set());
    attendanceMap.get(row.participantId)!.add(key);
  }
  const absent = participants
    .map((p) => {
      const present = attendanceMap.get(p.id)?.size ?? 0;
      return {
        participantId: p.id,
        name: p.name,
        attended: present,
        absent: Math.max(sessionsCount - present, 0),
      };
    })
    .filter((r) => r.absent > 0 && sessionsCount > 0);

  // Build CSV
  const lines: string[] = [];
  lines.push("jenis,nama,total_hadir,streak_terbaik,streak_saat_ini,hadir,tidak_hadir");

  totals.forEach((row) => {
    lines.push(
      ["total", row.name, row.total, "", "", ""]
        .map((v) => csvEscape(String(v ?? "")))
        .join(","),
    );
  });

  streaks.forEach((row) => {
    lines.push(
      ["streak", row.name, "", row.bestStreak, row.currentStreak, "", ""]
        .map((v) => csvEscape(String(v ?? "")))
        .join(","),
    );
  });

  absent.forEach((row) => {
    lines.push(
      ["absent", row.name, "", "", "", row.attended, row.absent]
        .map((v) => csvEscape(String(v ?? "")))
        .join(","),
    );
  });

  const csv = lines.join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"leaderboard-${range}-${dayjs().format("YYYYMMDD-HHmmss")}.csv\"`,
    },
  });
}
