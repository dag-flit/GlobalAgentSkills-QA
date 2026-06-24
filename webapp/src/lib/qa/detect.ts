import fs from "node:fs";
import { importKit } from "./kit";
import { cloneOrUpdate } from "./gitService";

/** De dónde sale el código a analizar. */
export type ProjectSource =
  | { kind: "local"; localPath: string }
  | { kind: "git"; gitUrl: string; branch?: string };

/** Resuelve la fuente a una carpeta local lista para analizar (clona si es Git). */
export async function resolveRepoRoot(src: ProjectSource): Promise<string> {
  if (src.kind === "git") {
    if (!src.gitUrl?.trim()) throw new Error("Falta la URL del repositorio Git.");
    return cloneOrUpdate(src.gitUrl.trim(), src.branch?.trim() || undefined);
  }
  const p = src.localPath?.trim();
  if (!p) throw new Error("Falta la ruta local del proyecto.");
  if (!fs.existsSync(p)) throw new Error(`La ruta no existe: ${p}`);
  if (!fs.statSync(p).isDirectory()) throw new Error(`La ruta no es una carpeta: ${p}`);
  return p;
}

/** Resuelve la fuente y corre la detección de capas/stack del kit. */
export async function detectProject(
  src: ProjectSource
): Promise<{ repoRoot: string; detection: any }> {
  const repoRoot = await resolveRepoRoot(src);
  const { detectRepo } = await importKit("runtime/detect/qa-detect.mjs");
  const detection = detectRepo({ repoRoot });
  return { repoRoot, detection };
}
