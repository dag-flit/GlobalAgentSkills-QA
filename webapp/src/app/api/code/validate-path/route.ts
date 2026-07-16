import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { codeValidatePathSchema } from "@/lib/validation/schemas";
import { importKit } from "@/lib/qa/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/code/validate-path { sourcePath } → valida (en el server) que la ruta apunte a un
// PROYECTO real antes de dejar avanzar al paso «Ejecutar» del modo QA del código. Reúsa el motor
// (validate-project.mjs): confina a CODE_QA_BASE_DIR si está definido + heurística de "es un repo".
// Requiere sesión (withTenantScope) para no exponer sondeo del FS del server a anónimos.
export async function POST(req: Request) {
  const parsed = await parseJson(req, codeValidatePathSchema, "ok");
  if (!parsed.ok) return parsed.response;
  return withTenantScope(async () => {
    try {
      const { validateProjectPath } = await importKit("runtime/source/validate-project.mjs");
      const res = validateProjectPath({ sourcePath: parsed.data.sourcePath, env: process.env });
      return NextResponse.json(res.ok ? { ok: true, resolved: res.resolved, marker: res.marker } : { ok: false, reason: res.reason });
    } catch (e: any) {
      return NextResponse.json({ ok: false, reason: e?.message ?? "No se pudo validar la ruta." }, { status: 500 });
    }
  });
}
