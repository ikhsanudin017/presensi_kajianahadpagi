import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatJakartaDate, getJakartaDate, isSunday } from "@/lib/time";

type LuckyDrawParticipant = {
  participantId: string;
  name: string;
  address: string | null;
};

export async function GET() {
  const todayStart = getJakartaDate().startOf("day").toDate();

  const recentDates = await prisma.attendance.findMany({
    where: {
      eventDate: {
        lt: todayStart,
      },
    },
    select: {
      eventDate: true,
    },
    distinct: ["eventDate"],
    orderBy: {
      eventDate: "desc",
    },
    take: 180,
  });

  const latestSunday = recentDates.find((row) => isSunday(row.eventDate))?.eventDate;

  if (!latestSunday) {
    return NextResponse.json({
      ok: true,
      sourceDate: null,
      participants: [] as LuckyDrawParticipant[],
      totalParticipants: 0,
      message: "Belum ada data presensi Ahad sebelum hari ini.",
    });
  }

  const attendanceRows = await prisma.attendance.findMany({
    where: {
      eventDate: latestSunday,
    },
    select: {
      participantId: true,
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

  for (const row of attendanceRows) {
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
    sourceDate: formatJakartaDate(latestSunday),
    participants,
    totalParticipants: participants.length,
    generatedAt: getJakartaDate().toISOString(),
  });
}
