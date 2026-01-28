import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const patchSchema = z.object({
  participantId: z.string().min(1),
  eventDate: z.string().optional(), // ISO date string YYYY-MM-DD
});

type Params = {
  params: { id: string };
};

export async function PATCH(req: Request, { params }: Params) {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }

  try {
    const dataToUpdate: { participantId: string; eventDate?: Date } = {
      participantId: parsed.data.participantId,
    };
    if (parsed.data.eventDate) {
      dataToUpdate.eventDate = new Date(parsed.data.eventDate);
    }

    const updated = await prisma.attendance.update({
      where: { id: params.id },
      data: dataToUpdate,
      include: { participant: true },
    });

    return NextResponse.json({ ok: true, data: updated });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "P2002") {
        return NextResponse.json({ ok: false, error: "ALREADY_PRESENT" }, { status: 409 });
      }
      if (code === "P2025") {
        return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }
    }
    console.error("Failed to update attendance", error);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    await prisma.attendance.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "P2025") {
        return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }
    }
    console.error("Failed to delete attendance", error);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
