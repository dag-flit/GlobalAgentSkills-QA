import { pathToFileURL } from "node:url";
import { kitModule } from "@/lib/paths";

/**
 * Importa un módulo del motor del kit (ESM .mjs) por ruta absoluta.
 * Usa import dinámico nativo (webpackIgnore) para que Next NO intente
 * bundlear los .mjs del kit, que tienen sus propios imports relativos.
 */
export async function importKit(rel: string): Promise<any> {
  const url = pathToFileURL(kitModule(rel)).href;
  return import(/* webpackIgnore: true */ url);
}
