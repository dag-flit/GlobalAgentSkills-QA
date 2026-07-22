// report.mjs — reporte AUTOCONTENIDO de una corrida de regresión: HTML con las capturas por paso y
// el video de cada prueba embebidos como data-URI → funciona servido por un proxy, abierto del disco
// o adjunto a una HU de ADO (no depende de rutas externas, mismo criterio que el sink de E2E).
// Puro salvo la LECTURA de archivos, que llega INYECTADA (`reader`) → offline-testable.

import fs from "node:fs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function dataUri(reader, file) {
  if (!file) return "";
  try {
    const buf = reader(file);
    if (!buf || !buf.length) return "";
    const mime = /\.webm$/i.test(file) ? "video/webm" : /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return ""; // best-effort: un archivo ilegible no rompe el reporte
  }
}

function stepRow(c, reader) {
  const ok = c.status === "pass";
  const shot = dataUri(reader, c.file);
  return `<div class="step ${ok ? "ok" : "bad"}"><div class="sl"><b>${ok ? "✓" : "✗"}</b> ${esc(c.name)}${c.message ? ` <span class="msg">— ${esc(c.message)}</span>` : ""}</div>${shot ? `<img src="${shot}" alt="captura del paso"/>` : ""}</div>`;
}

function testCard(t, reader) {
  const ok = t.status === "pass";
  const video = dataUri(reader, t.video);
  const warns = (t.warnings || []).map((w) => `<p class="warn">⚠ ${esc(w)}</p>`).join("");
  const steps = (t.cases || []).map((c) => stepRow(c, reader)).join("");
  return `<section class="test ${ok ? "ok" : "bad"}"><h3>${ok ? "✓" : "✗"} ${esc(t.name)}</h3>${warns}${video ? `<video controls preload="metadata" src="${video}"></video>` : `<p class="novideo">(sin video para esta prueba)</p>`}<div class="steps">${steps}</div></section>`;
}

/**
 * @param {object} o
 * @param {string} o.system  nombre del sistema
 * @param {string} o.suite   nombre de la suite
 * @param {Array<{name:string,status:string,warnings?:string[],video?:string,cases?:Array}>} o.tests
 * @param {string} [o.stamp] marca de tiempo legible
 * @param {(file:string)=>Buffer} [o.reader] lector de archivos (inyectable → offline-testable)
 * @returns {string} HTML autocontenido
 */
export function buildRegressionReport({ system = "", suite = "", tests = [], stamp = "", reader = (f) => fs.readFileSync(f) } = {}) {
  const passed = tests.filter((t) => t.status === "pass").length;
  const allOk = tests.length > 0 && passed === tests.length;
  const verdict = allOk ? `✓ Todo verde (${passed}/${tests.length})` : `✗ ${tests.length - passed} en rojo · ${passed}/${tests.length} OK`;
  const cards = tests.map((t) => testCard(t, reader)).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Regresión — ${esc(suite)}</title><style>
    body{font-family:system-ui,'Segoe UI',Arial,sans-serif;margin:0;padding:16px;background:#0b0e14;color:#e6e6e6}
    h1{font-size:18px;margin:0 0 4px}.meta{color:#9aa4b2;font-size:12px;margin-bottom:12px}
    .verdict{display:inline-block;padding:5px 12px;border-radius:8px;font-weight:600;margin-bottom:14px;color:#fff}
    .test{border:1px solid #22304a;border-radius:10px;padding:12px;margin-bottom:12px;background:#111722}
    .test.bad{border-color:#7f1d1d}.test.ok{border-color:#14532d}.test h3{margin:0 0 8px;font-size:14px}
    video{max-width:520px;width:100%;border-radius:8px;margin:6px 0;background:#000}
    .novideo{color:#667;font-size:11px;margin:2px 0}
    .step{border-left:3px solid #33415c;padding:4px 8px;margin:6px 0}
    .step.bad{border-color:#ef4444}.step.ok{border-color:#22c55e}
    .step img{display:block;max-width:520px;width:100%;border:1px solid #22304a;border-radius:6px;margin-top:6px}
    .sl{font-size:12px}.msg{color:#f88}.warn{color:#fbbf24;font-size:12px;margin:2px 0}
  </style></head><body><h1>Regresión — ${esc(suite)}</h1><div class="meta">Sistema: ${esc(system)}${stamp ? ` · ${esc(stamp)}` : ""}</div><div class="verdict" style="background:${allOk ? "#14532d" : "#7f1d1d"}">${esc(verdict)}</div>${cards}</body></html>`;
}

export default { buildRegressionReport };
