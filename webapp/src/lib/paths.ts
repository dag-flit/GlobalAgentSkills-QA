import path from "node:path";
import fs from "node:fs";

/** Raíz de la app web (donde corre Next): qa-kit/webapp. */
export const PROJECT_ROOT = process.cwd();

/** Raíz del qa-kit (un nivel arriba de webapp/). Aquí viven runtime/, core/, adapters/. */
export const KIT_ROOT = path.resolve(PROJECT_ROOT, "..");

/** Carpeta de datos locales (gitignored): config con secretos, runs, repos, evidencia. */
export const DATA_DIR = path.join(PROJECT_ROOT, "data");

export const CONFIG_FILE = path.join(DATA_DIR, "config.json");
export const RUNS_FILE = path.join(DATA_DIR, "runs.json");
export const RUNS_DIR = path.join(DATA_DIR, "runs");
export const EVENTS_DIR = path.join(DATA_DIR, "events");
export const REPOS_DIR = path.join(DATA_DIR, "repos");

export function ensureDataDirs(): void {
  for (const dir of [DATA_DIR, RUNS_DIR, EVENTS_DIR, REPOS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Ruta absoluta a un módulo del motor del kit (p.ej. "runtime/orchestrator.mjs"). */
export function kitModule(rel: string): string {
  return path.join(KIT_ROOT, rel);
}
