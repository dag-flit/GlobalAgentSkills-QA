import { NextResponse } from "next/server";
import { loadConfig, applySecretPreserving } from "@/lib/config";
import { fetchFeatureTree, trackerEnv } from "@/lib/qa/tracker";
import { parseJson } from "@/lib/validation/parse";
import { featureTreeSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Body: { featureId: string, tracker?: TrackerConfig }
 * Usa el tracker guardado (o el enviado, resolviendo tokens enmascarados) para traer
 * el Feature y sus HUs hijas vía el adapter del kit.
 */
export async function POST(req: Request) {
  const parsed = await parseJson(req, featureTreeSchema, "ok");
  if (!parsed.ok) return parsed.response;
  const featureId = parsed.data.featureId.trim();
  if (!featureId) return NextResponse.json({ ok: false, error: "Falta featureId." }, { status: 400 });

  const current = await loadConfig();
  const incoming = parsed.data.tracker ?? current.tracker;
  const resolved = applySecretPreserving(current, { ...current, tracker: incoming }).tracker;

  try {
    const { feature, children } = await fetchFeatureTree(
      resolved.selected,
      trackerEnv(resolved),
      featureId
    );
    return NextResponse.json({ ok: true, tracker: resolved.selected, feature, children });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) });
  }
}
