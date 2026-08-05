import fs from "node:fs";
import path from "node:path";
import { tenantDir } from "@/lib/paths";

// Archivos de PRUEBA para la carga de documentos (paso «subir archivo»). Se guardan por TENANT en
// disco (aislados, defensa en profundidad; la API ya acota por RLS), NO en la BD (son binarios). El
// paso guarda `${QA_FILES}/<nombre>`; el runner/walk resuelve ${QA_FILES} a este directorio en el
// server y el motor hace setInputFiles con el archivo real — nunca viaja una ruta del cliente.

const MAX_BYTES = 15 * 1024 * 1024; // 15 MB por archivo (documentos de prueba, no cargas pesadas)

/** Directorio absoluto de archivos de prueba del tenant. */
export function filesDir(tenantId: string): string {
  return path.join(tenantDir(tenantId), "regression-files");
}

// Nombre seguro: solo base (sin separadores ni `..`), caracteres acotados. Evita path traversal y
// colisiones con rutas del sistema. Conserva la extensión para que la app destino la reconozca.
export function safeName(name: string): string {
  const base = path.basename(String(name ?? "")).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 80);
  return base || "archivo";
}

/** Guarda un archivo subido y devuelve el nombre almacenado (seguro). */
export function saveFile(tenantId: string, name: string, bytes: Buffer): { ok: boolean; name?: string; error?: string } {
  if (bytes.length > MAX_BYTES) return { ok: false, error: `El archivo supera el máximo (${Math.round(MAX_BYTES / 1024 / 1024)} MB).` };
  const dir = filesDir(tenantId);
  fs.mkdirSync(dir, { recursive: true });
  const stored = safeName(name);
  fs.writeFileSync(path.join(dir, stored), bytes);
  return { ok: true, name: stored };
}

/** Lista los archivos de prueba ya subidos por el tenant. */
export function listFiles(tenantId: string): string[] {
  const dir = filesDir(tenantId);
  try {
    return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
  } catch {
    return [];
  }
}

/** Elimina un archivo de prueba (por nombre; se sanea → no escapa del directorio). */
export function deleteFile(tenantId: string, name: string): void {
  const stored = safeName(name);
  try {
    fs.unlinkSync(path.join(filesDir(tenantId), stored));
  } catch {
    /* no existe → nada que borrar */
  }
}
