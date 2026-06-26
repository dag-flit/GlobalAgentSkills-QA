import path from "node:path";

// Contención de rutas (anti path-traversal). `isWithin` evita el bug clásico de
// `target.startsWith(base)` (que deja pasar "/data-evil" cuando base es "/data"):
// usa path.relative, así "/data-evil" da una relativa que empieza con ".." → fuera.

/** ¿`target` es `base` o un descendiente real de `base`? */
export function isWithin(base: string, target: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Lanza si `target` escapa de `base`. Devuelve la ruta absoluta normalizada. */
export function assertWithin(base: string, target: string): string {
  const abs = path.resolve(target);
  if (!isWithin(base, abs)) {
    throw new Error(`Ruta fuera del área permitida: ${target}`);
  }
  return abs;
}

/** Exige una ruta absoluta y sin secuencias de traversal (`..`). Devuelve la normalizada. */
export function assertAbsoluteNoTraversal(p: string, label = "ruta"): string {
  if (!p || typeof p !== "string") throw new Error(`${label} vacía o inválida.`);
  if (p.includes("\0")) throw new Error(`${label} contiene caracteres nulos.`);
  if (!path.isAbsolute(p)) throw new Error(`${label} debe ser absoluta: ${p}`);
  const normalized = path.normalize(p);
  if (normalized.split(/[\\/]/).includes("..")) {
    throw new Error(`${label} no puede contener "..": ${p}`);
  }
  return normalized;
}
