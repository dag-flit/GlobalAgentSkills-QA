import { NextResponse } from "next/server";
import { loadConfig, applySecretPreserving } from "@/lib/config";
import { testTracker, trackerEnv } from "@/lib/qa/tracker";
import { withTenantScope } from "@/lib/auth/route";
import { trackerTestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Body: { tracker: TrackerConfig }  (los tokens enmascarados se resuelven contra lo guardado)
 * Devuelve el resultado del preflight: { ok, mode, detail }.
 */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, mode: "?", detail: "JSON inválido" }, { status: 400 });
  }
  const parsed = trackerTestSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ ok: false, mode: "?", detail: `Datos inválidos — ${detail}` }, { status: 400 });
  }
  return withTenantScope(async () => {
    const current = await loadConfig();
    // resuelve tokens enmascarados contra lo guardado
    const resolved = applySecretPreserving(current, { ...current, tracker: parsed.data.tracker }).tracker;
    try {
      const result = await testTracker(resolved.selected, trackerEnv(resolved));
      return NextResponse.json(result);
    } catch (e: any) {
      return NextResponse.json({ ok: false, mode: resolved.selected, detail: e?.message ?? String(e) });
    }
  });
}
