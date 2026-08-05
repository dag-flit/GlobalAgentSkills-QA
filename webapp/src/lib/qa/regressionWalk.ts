import { importKit } from "./kit";
import type { RegressionTarget, RegressionRecorrido, SelectorCatalog } from "@/lib/types";

// Puente entre la ruta API y el WALK-THROUGH del motor (runtime/regression/walk.mjs). Corre SOLO en el
// servidor: abre Playwright, entra al asistente, inicia sesión si aplica (credenciales EFÍMERAS
// ${QA_USER}/${QA_PASS}, descifradas aquí, NUNCA al navegador) y camina el Recorrido cosechando cada
// etapa. El catálogo del target se pasa para resolver los ALIAS de los avances.

export interface WalkResult {
  ok: boolean;
  pages?: Array<Record<string, unknown>>;
  count?: number;
  reached?: number;
  cataloged?: number;
  skipped?: string[];
  total?: number;
  stalledAt?: string | null;
  stallReason?: "no_advance" | "advance_failed" | null;
  message?: string | null;
  prefix?: string;
}

export async function walkTargetRecorrido(
  target: RegressionTarget,
  recorrido: RegressionRecorrido,
  opts: { filesDir?: string } = {},
): Promise<WalkResult> {
  const { walkRecorrido } = await importKit("runtime/regression/walk.mjs");

  let chromium: any;
  try {
    const pw: any = await import("playwright");
    chromium = pw.chromium ?? pw.default?.chromium;
  } catch {
    /* playwright no instalado */
  }
  if (!chromium) return { ok: false, message: "Playwright (chromium) no está disponible en el servidor; no se puede escanear el recorrido." };

  const vars: Record<string, string> = {};
  if (target.authMode === "login") {
    vars.QA_USER = target.username;
    vars.QA_PASS = target.password; // descifrada en el repo; se queda en el proceso, nunca al cliente
  }
  // Directorio de archivos de prueba del tenant → el paso «subir archivo» de un avance resuelve
  // ${QA_FILES}/<nombre> (p.ej. cargar documentos obligatorios para poder avanzar de pantalla).
  if (opts.filesDir) vars.QA_FILES = opts.filesDir;

  return walkRecorrido({
    name: recorrido.name,
    baseUrl: target.baseUrl,
    auth: { mode: target.authMode },
    entry: recorrido.entryRoute || "",
    stages: recorrido.stages ?? [],
    catalog: target.catalog ?? { baseUrl: target.baseUrl, pages: [] },
    vars,
    env: process.env,
    launchBrowser: () => chromium.launch(),
  });
}

// Reexporta el tipo del catálogo para las rutas que fusionan el resultado del walk.
export type { SelectorCatalog };
