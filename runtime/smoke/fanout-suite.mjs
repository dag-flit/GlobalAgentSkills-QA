// runtime/smoke/fanout-suite.mjs — resumen de la corrida a nivel Feature (comentario en el WI
// padre). El fan-out en sí se orquesta en la webapp (TS, con BD); acá se cubre el render PURO del
// motor (renderFanoutSummary) que produce el HTML del comentario del Feature. Offline.
import assert from "node:assert";
import { renderFanoutSummary } from "../evidence/fanout-comment.mjs";

export async function run(ctx) {
  const { ok } = ctx;

  const html = renderFanoutSummary({
    feature: "10515",
    hus: [
      { id: "10516", title: "[BACKEND] Endpoint", status: "skipped", origen: "backend (no E2E)" },
      { id: "10517", title: "[FRONTEND] Listado & <toggle>", status: "passed", origen: "login+captura (sin guion)" },
      { id: "10518", title: "[BACKEND] Enforcement", status: "skipped", origen: "backend (no E2E)" },
    ],
  });
  // Encabezado con el nº de Feature + conteo por estado.
  assert.ok(/Feature 10515/.test(html));
  assert.ok(/✅ 1 pasó/.test(html) && /❌ 0 falló/.test(html) && /⏭ 2 omitida/.test(html));
  assert.ok(/3 HU/.test(html));
  // Una fila por HU con su icono, título, estado y origen.
  assert.ok(/10517/.test(html) && /login\+captura \(sin guion\)/.test(html));
  assert.ok(/✅ passed/.test(html) && /⏭ skipped/.test(html));
  // Escapado de HTML en el título (no se inyecta markup).
  assert.ok(/&lt;toggle&gt;/.test(html) && !/<toggle>/.test(html));
  // Sin HU → tabla vacía pero válida (no rompe).
  const empty = renderFanoutSummary({ feature: "1", hus: [] });
  assert.ok(/0 HU/.test(empty) && /<tbody><\/tbody>/.test(empty));
  ok("resumen de Feature: renderFanoutSummary arma el comentario (conteo + tabla por HU, HTML escapado)");
}
