import { NextResponse } from "next/server";
import { getRun } from "@/lib/runStore";
import { readEvents } from "@/lib/events";
import { withTenantScope } from "@/lib/auth/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withTenantScope(async () => {
    const record = await getRun(id);
    if (!record) return NextResponse.json({ error: "Run no encontrado" }, { status: 404 });
    return NextResponse.json({ record, events: await readEvents(id) });
  });
}
