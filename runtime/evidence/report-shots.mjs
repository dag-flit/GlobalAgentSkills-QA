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

export default { slug, collectShots };
