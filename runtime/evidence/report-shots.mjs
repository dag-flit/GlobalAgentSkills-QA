// report-shots.mjs — manejo de capturas para el reporte local: copia las imágenes a
// <dir>/capturas/ (archivos sueltos) y calcula su data-URI para embeberlas en el HTML (reporte
// AUTOCONTENIDO). También el slug de nombres de carpeta. Extraído de local-sink por presupuesto
// de líneas. Puro/offline; best-effort (si un archivo no existe/no se lee, se omite sin romper).

import fs from "node:fs";
import path from "node:path";

// Convierte un valor libre (nombre de dev, id, capa) en un segmento seguro y portable: quita
// tildes (ñ→n, á→a), colapsa lo no [A-Za-z0-9._-] en `-`, recorta. Cross-platform.
export function slug(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// data-URI de una imagen (png/jpg) → el HTML embebe la captura y NO depende de rutas externas.
// Así el reporte funciona servido por un proxy, abierto del disco o adjunto por correo.
function dataUri(buf, file) {
  const mime = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

// Copia las capturas (png/jpg) de los resultados a <dir>/capturas/ Y calcula su data-URI.
export function collectShots(results, dir) {
  const out = [];
  const capDir = path.join(dir, "capturas");
  let made = false;
  for (const r of results) {
    for (const f of Array.isArray(r.files) ? r.files : []) {
      if (!/\.(png|jpe?g)$/i.test(f)) continue;
      try {
        if (!fs.existsSync(f)) continue;
        if (!made) {
          fs.mkdirSync(capDir, { recursive: true });
          made = true;
        }
        const buf = fs.readFileSync(f);
        const baseName = `${slug(r.layer)}-${path.basename(f)}`;
        fs.writeFileSync(path.join(capDir, baseName), buf);
        out.push({ layer: r.layer, rel: `capturas/${baseName}`, name: path.basename(f), src: f, data: dataUri(buf, f) });
      } catch {
        /* best-effort */
      }
    }
  }
  return out;
}

// Marca de hora local HH-MM-SS (para nombrar la subcarpeta de CADA corrida).
function timeStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// Carpeta de evidencia de UNA corrida: qa-evidence/<fecha>/<grupo>/<hora>. El <grupo> es FT-<feature>__
// <dev> (o WI-<id> de fallback); la subcarpeta por HORA hace que cada corrida quede en la SUYA y NO
// sobreescriba las evidencias previas (bug: antes todas caían en el mismo <grupo> y se pisaban). Si dos
// corridas caen en el mismo segundo, se desambigua con -2/-3… La crea (mkdir) y devuelve la ruta.
export function evidenceRunDir({ repoRoot, outDir, stamp, featureId, developer, workItemId }) {
  const segParts = [];
  if (featureId) segParts.push(`FT-${slug(featureId)}`);
  if (developer) segParts.push(slug(developer));
  if (segParts.length === 0) segParts.push(`WI-${workItemId}`);
  const groupDir = path.join(repoRoot, outDir, stamp, segParts.join("__"));
  const base = timeStamp();
  let dir = path.join(groupDir, base);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(groupDir, `${base}-${n}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export default { slug, collectShots, evidenceRunDir };
