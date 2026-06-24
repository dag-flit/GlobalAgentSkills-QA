import fs from "node:fs";
import path from "node:path";
import { listRuns } from "@/lib/runStore";
import { DATA_DIR } from "@/lib/paths";

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

/** Raíces permitidas: data/ de la webapp + los repoRoot de las corridas registradas. */
function allowedRoots(): string[] {
  const roots = new Set<string>([path.resolve(DATA_DIR)]);
  for (const r of listRuns()) if (r.repoRoot) roots.add(path.resolve(r.repoRoot));
  return [...roots];
}

function isAllowed(target: string): boolean {
  const t = path.resolve(target);
  return allowedRoots().some((root) => t === root || t.startsWith(root + path.sep));
}

/** GET /api/artifacts?path=<ruta absoluta> — sirve un archivo de evidencia (sandbox a raíces conocidas). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams.get("path");
  if (!p) return new Response("Falta 'path'", { status: 400 });
  if (!isAllowed(p)) return new Response("Ruta no permitida", { status: 403 });
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return new Response("No encontrado", { status: 404 });

  const ext = path.extname(p).toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  const data = fs.readFileSync(p);
  return new Response(data, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}
