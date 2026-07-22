import { importKit } from "./kit";
import type { RegressionTarget, SelectorCatalog } from "@/lib/types";

// Puente entre la ruta API y el ESCÁNER del motor (runtime/regression/scan.mjs). Corre SOLO en el
// servidor: abre Playwright, pasa las credenciales del sistema como variables EFÍMERAS
// (${QA_USER}/${QA_PASS}) para el login genérico — descifradas aquí, JAMÁS enviadas al navegador —
// y devuelve el catálogo (que no contiene secretos). Sin login → el escáner va directo a la URL.

export interface ScanResult {
  ok: boolean;
  catalog?: SelectorCatalog;
  count?: number;
  message?: string;
}

export async function scanTarget(
  target: RegressionTarget,
  routes: Array<{ route: string; name?: string }> = [],
): Promise<ScanResult> {
  const { scanSelectors } = await importKit("runtime/regression/scan.mjs");

  // Navegador real (mismo patrón que la exploración E2E). Si no está, no se puede escanear.
  let chromium: any;
  try {
    const pw: any = await import("playwright");
    chromium = pw.chromium ?? pw.default?.chromium;
  } catch {
    /* playwright no instalado */
  }
  if (!chromium) return { ok: false, message: "Playwright (chromium) no está disponible en el servidor; no se puede escanear." };

  const vars: Record<string, string> = {};
  if (target.authMode === "login") {
    vars.QA_USER = target.username;
    vars.QA_PASS = target.password; // descifrada en el repo; se queda en el proceso, nunca al cliente
  }

  return scanSelectors({
    baseUrl: target.baseUrl,
    auth: { mode: target.authMode },
    routes: routes.length ? routes : undefined,
    vars,
    env: process.env,
    launchBrowser: () => chromium.launch(),
  });
}
