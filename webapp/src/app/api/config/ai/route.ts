import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { aiConfigSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Actualiza SOLO la config de IA del tenant. Carga la config actual, reemplaza `ai` y guarda → no
// hay clobber con la edición de otras secciones (tracker/databases). Sin secretos (Ollama local).
export async function PUT(req: Request) {
  const parsed = await parseJson(req, aiConfigSchema, "plain");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async () => {
    const current = await loadConfig();
    await saveConfig({ ...current, ai: parsed.data });
    return NextResponse.json(parsed.data);
  });
}
