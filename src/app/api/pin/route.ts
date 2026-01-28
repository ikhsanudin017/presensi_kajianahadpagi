import { NextResponse } from "next/server";
import { z } from "zod";

const pinSchema = z.object({
  pin: z.string().min(1),
});

export async function GET() {
  const adminPin = process.env.ADMIN_PIN;
  return NextResponse.json({ enabled: Boolean(adminPin) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = pinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_INPUT" }, { status: 400 });
  }

  const adminPin = process.env.ADMIN_PIN;
  if (!adminPin) {
    return NextResponse.json({ ok: true, bypass: true });
  }

  if (parsed.data.pin === adminPin) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: "INVALID_PIN" }, { status: 401 });
}
