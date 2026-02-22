import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toEventDate } from "@/lib/time";
import { syncAttendanceSheetFromDatabase } from "@/lib/attendance-sheet-sync";

const patchSchema = z.object({
  participantId: z.string().min(1),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

type ParamsPromise = {
  params: Promise<{ id: string }>;
};

export async function PATCH(req: Request, { params }: ParamsPromise) {
  const { id } = await params;
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
      dataToUpdate.eventDate = toEventDate(parsed.data.eventDate);
    }

    const updated = await prisma.attendance.update({
      where: { id },
      data: dataToUpdate,
      include: { participant: true },
    });

    const syncResult = await syncAttendanceSheetFromDatabase().catch((error) => {
      console.error("Failed to sync attendance sheet after update", error);
      return { ok: false } as const;
    });

    return NextResponse.json({
      ok: true,
      data: updated,
      warning: syncResult.ok ? null : "SHEET_SYNC_FAILED",
    });
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

export async function DELETE(_req: Request, { params }: ParamsPromise) {
  try {
    const { id } = await params;
    await prisma.attendance.delete({ where: { id } });
    const syncResult = await syncAttendanceSheetFromDatabase().catch((error) => {
      console.error("Failed to sync attendance sheet after delete", error);
      return { ok: false } as const;
    });
    return NextResponse.json({
      ok: true,
      warning: syncResult.ok ? null : "SHEET_SYNC_FAILED",
    });
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
