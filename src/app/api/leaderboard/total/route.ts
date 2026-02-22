import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getJakartaDate, toEventDate } from "@/lib/time";

function getStartDate(range: string | null) {
  const now = getJakartaDate();
  if (range === "30d") {
    return toEventDate(now.subtract(30, "day").format("YYYY-MM-DD"));
  }
  if (range === "90d") {
    return toEventDate(now.subtract(90, "day").format("YYYY-MM-DD"));
  }
  return null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get("range") ?? "all";
  const startDate = getStartDate(range);

  const grouped = await prisma.attendance.groupBy({
    by: ["participantId"],
    where: startDate ? { eventDate: { gte: startDate } } : undefined,
    _count: { participantId: true },
    orderBy: { _count: { participantId: "desc" } },
    take: 10,
  });

  const participants = await prisma.participant.findMany({
    where: { id: { in: grouped.map((row) => row.participantId) } },
  });

  const lookup = new Map(participants.map((p) => [p.id, p]));
  const data = grouped.map((row) => ({
    participantId: row.participantId,
    name: lookup.get(row.participantId)?.name ?? "Unknown",
    total: row._count.participantId,
  }));

  return NextResponse.json({ ok: true, data });
}
