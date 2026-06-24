import { NextResponse } from "next/server";
import { loadConfig, applySecretPreserving } from "@/lib/config";
import { testTracker, trackerEnv } from "@/lib/qa/tracker";
import type { TrackerConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Body: { tracker: TrackerConfig }  (los tokens enmascarados se resuelven contra lo guardado)
 * Devuelve el resultado del preflight: { ok, mode, detail }.
 */
export async function POST(req: Request) {
  let body: { tracker: TrackerConfig };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, mode: "?", detail: "JSON inválido" }, { status: 400 });
  }
  if (!body?.tracker) {
    return NextResponse.json({ ok: false, mode: "?", detail: "Falta 'tracker'." }, { status: 400 });
  }
  const current = loadConfig();
  // resuelve tokens enmascarados contra lo guardado
  const resolved = applySecretPreserving(current, { ...current, tracker: body.tracker }).tracker;
  try {
    const result = await testTracker(resolved.selected, trackerEnv(resolved));
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, mode: resolved.selected, detail: e?.message ?? String(e) });
  }
}
