import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { listRuns } from "@/lib/runStore";
import { withTenantScope } from "@/lib/auth/route";
import { isWithin } from "@/lib/security/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webm": "video/webm",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

// Raíces permitidas = los repoRoot de los runs DEL TENANT ACTIVO. listRuns corre dentro de
// withTenantScope → RLS solo devuelve los runs del tenant, así que un tenant nunca puede
// pedir evidencia de otro (antes se permitía todo DATA_DIR → fuga cross-tenant).
async function allowedRoots(): Promise<string[]> {
  const roots = new Set<string>();
  for (const r of await listRuns()) if (r.repoRoot) roots.add(path.resolve(r.repoRoot));
  return [...roots];
}

async function isAllowed(target: string): Promise<boolean> {
  const roots = await allowedRoots();
  return roots.some((root) => isWithin(root, target));
}

/** GET /api/artifacts?path=<ruta absoluta> — sirve evidencia, sandbox a los runs del tenant. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("path");
  if (!p) return new NextResponse("Falta 'path'", { status: 400 });
  return withTenantScope(async () => {
    if (!(await isAllowed(p))) return new NextResponse("Ruta no permitida", { status: 403 });
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
      return new NextResponse("No encontrado", { status: 404 });
    }
    // Solo extensiones de evidencia: bloquea leer .env/.pem/código aunque la ruta pase la
    // contención (defensa extra contra un repoRoot manipulado en el registro del run).
    const ext = path.extname(p).toLowerCase();
    const type = TYPES[ext];
    if (!type) return new NextResponse("Tipo de archivo no permitido", { status: 415 });
    const data = fs.readFileSync(p);
    return new NextResponse(data, {
      headers: { "Content-Type": type, "Cache-Control": "no-store" },
    });
  });
}
