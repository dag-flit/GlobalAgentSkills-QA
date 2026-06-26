import { NextResponse } from "next/server";
import { loadConfig, saveConfig, redactConfig, applySecretPreserving } from "@/lib/config";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { appConfigSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withTenantScope(async () => {
    const cfg = await loadConfig();
    return NextResponse.json(redactConfig(cfg));
  });
}

export async function PUT(req: Request) {
  const parsed = await parseJson(req, appConfigSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async () => {
    const current = await loadConfig();
    const merged = applySecretPreserving(current, parsed.data);
    await saveConfig(merged);
    return NextResponse.json(redactConfig(merged));
  });
}
