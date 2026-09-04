import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { roleAtLeast } from "@/lib/auth/context";
import { parseJson } from "@/lib/validation/parse";
import { scheduleSaveSchema, scheduleDeleteSchema } from "@/lib/validation/schemas";
import { listSchedules, upsertSchedule, deleteSchedule } from "@/lib/db/schedulesRepo";
import { computeNextRun } from "@/lib/qa/cadence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () =>
  NextResponse.json({ ok: false, error: "Necesitás rol miembro o superior." }, { status: 403 });

// GET → lista los horarios del tenant. PUT → crea/actualiza (calcula next_run_at desde la cadencia).
// DELETE → elimina. Escrituras: rol member+ (viewer solo lee).
export async function GET() {
  return withTenantScope(async () => NextResponse.json({ ok: true, schedules: await listSchedules() }));
}

export async function PUT(req: Request) {
  const parsed = await parseJson(req, scheduleSaveSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const d = parsed.data;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    await upsertSchedule({
      id: d.id, targetId: d.targetId, suiteId: d.suiteId, cadence: d.cadence,
      enabled: d.enabled, nextRunAt: computeNextRun(d.cadence),
    });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: Request) {
  const parsed = await parseJson(req, scheduleDeleteSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async (auth) => {
    if (!roleAtLeast(auth.role, "member")) return forbidden();
    await deleteSchedule(parsed.data.id);
    return NextResponse.json({ ok: true });
  });
}
