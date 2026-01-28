import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().optional(),
  gender: z.enum(["L", "P"]).nullable().optional(),
});

type Params = { params: { id: string } };

export async function PATCH(req: Request, { params }: Params) {
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }

  try {
    const updated = await prisma.participant.update({
      where: { id: params.id },
      data: {
        name: parsed.data.name,
        address: parsed.data.address ?? null,
        gender: parsed.data.gender ?? null,
      },
    });
    return NextResponse.json({ ok: true, data: updated });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "P2002") {
        return NextResponse.json({ ok: false, error: "NAME_EXISTS" }, { status: 409 });
      }
      if (code === "P2025") {
        return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }
    }
    console.error("Failed to update participant", error);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    await prisma.participant.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error) {
      const code = (error as { code?: string }).code;
      if (code === "P2025") {
        return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      }
    }
    console.error("Failed to delete participant", error);
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
