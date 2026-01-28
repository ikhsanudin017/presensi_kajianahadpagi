import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { appendRow } from "@/lib/googleSheets";

const participantSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().optional(),
  gender: z.enum(["L", "P"]).optional(),
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q")?.trim();
  const take = Number(searchParams.get("limit") ?? "200");
  const page = Number(searchParams.get("page") ?? "1");
  const skip = page > 1 && Number.isFinite(page) ? (page - 1) * take : 0;

  const where: Prisma.ParticipantWhereInput | undefined = query
    ? {
        name: {
          contains: query,
          mode: "insensitive",
        },
      }
    : undefined;

  const participants = await prisma.participant.findMany({
    where,
    orderBy: { name: "asc" },
    skip: Number.isFinite(skip) ? skip : 0,
    take: Number.isFinite(take) ? Math.min(take, 500) : 200,
  });

  const total = await prisma.participant.count({ where });

  return NextResponse.json({
    data: participants,
    meta: {
      total,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(take) ? Math.min(take, 500) : 200,
    },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = participantSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }

  const { name, address, gender } = parsed.data;
  const existing = await prisma.participant.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });

  let created = false;
  const participant =
    existing ??
    (await prisma.participant.create({
      data: {
        name,
        address: address || null,
        gender: gender ?? null,
      },
    }));
  if (!existing) {
    created = true;
  }

  const sheetName =
    process.env.GOOGLE_SHEETS_PARTICIPANTS_SHEET_NAME ?? "Participants";

  let sheetWarning: string | null = null;
  if (created) {
    const appendResult = await appendRow(sheetName, [
      participant.createdAt.toISOString(),
      participant.name,
      participant.address ?? "",
      participant.gender ?? "",
    ]).catch((error) => {
      console.error("Failed to append participant to sheet", error);
      return { ok: false } as const;
    });

    if (!appendResult.ok) {
      sheetWarning = "SHEET_SYNC_FAILED";
    }
  }

  return NextResponse.json({
    ok: true,
    data: participant,
    warning: sheetWarning,
  });
}
