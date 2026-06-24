import { NextResponse } from "next/server";
import { getRun } from "@/lib/runStore";
import { readEvents } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = getRun(id);
  if (!record) return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });
  return NextResponse.json({ record, events: readEvents(id) });
}
