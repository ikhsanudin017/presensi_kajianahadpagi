import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toEventDate } from "@/lib/time";
import dayjs from "dayjs";

function csvEscape(value: string) {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = (searchParams.get("range") as "single" | "last30" | "year" | "all") ?? "single";
  const dateParam = searchParams.get("date");
  const q = searchParams.get("q") ?? "";

  if (range === "single" && !dateParam) {
    return NextResponse.json({ ok: false, error: "DATE_REQUIRED" }, { status: 400 });
  }

  const today = toEventDate();
  const eventDate = dateParam ? toEventDate(dateParam) : null;

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
              gte: new Date(today.getFullYear(), 0, 1),
              lte: today,
            }
          : eventDate
            ? { equals: eventDate }
            : undefined;

  const attendance = await prisma.attendance.findMany({
    where: {
      eventDate: whereDate,
      participant: q
        ? {
            name: { contains: q, mode: "insensitive" },
          }
        : undefined,
    },
    include: {
      participant: true,
    },
    orderBy: { createdAt: "desc" },
    take: 5000, // safeguard
  });

  const header = ["tanggal_kajian", "dibuat_pada", "nama", "alamat", "jenis_kelamin", "id_perangkat"];
  const rows = attendance.map((row) => [
    dayjs(row.eventDate).format("YYYY-MM-DD"),
    dayjs(row.createdAt).toISOString(),
    row.participant.name ?? "",
    row.participant.address ?? "",
    row.participant.gender ?? "",
    row.deviceId ?? "",
  ]);

  const csv =
    header.join(",") +
    "\n" +
    rows
      .map((cols) => cols.map((c) => csvEscape(String(c ?? ""))).join(","))
      .join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="presensi-${range}-${dayjs().format("YYYYMMDD-HHmmss")}.csv"`,
    },
  });
}
