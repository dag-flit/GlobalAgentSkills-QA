// findings-suite.mjs — casos del render de la HU de HALLAZGOS (findings-workitem). Extraído de code-suite
// para no pasar el guardrail de 400 líneas. Verifica: título con #N, números ETIQUETADOS (capas vs
// pruebas), evidencia de lo que pasó (lenguaje claro), sugerencias (advertencias del linter descritas),
// estructura visual en cajas, y humanización del fallo de BD. Puro/offline.

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderFindingsDescription, buildFindingsTitle, stampNow, summarizeFindings } from "../evidence/findings-workitem.mjs";
import { casesMd, casesHtml } from "../evidence/report-cases.mjs";
import { executedMd, executedHtml } from "../evidence/report-executed.mjs";
import { writeLocalReport } from "../evidence/local-sink.mjs";

// Escribe el reporte local REAL en un temporal y devuelve su md + html (para verificar que una misma
// evidencia se plasme igual en las 4 rutas). Se limpia solo.
function renderReport(results) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-report-"));
  try {
    const r = writeLocalReport({ repoRoot: dir, profile: {}, workItemId: "local", results });
    return { md: fs.readFileSync(r.mdPath, "utf8"), html: fs.readFileSync(r.htmlPath, "utf8") };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runFindingsCases(ctx) {
  const { ok } = ctx;
  assert.strictEqual(stampNow(new Date(2026, 6, 13, 9, 5)), "2026-07-13 09:05", "marca fecha/hora local con padding");
  assert.strictEqual(
    buildFindingsTitle({ seq: 3, when: "2026-07-13 09:05" }),
    "Hallazgos QA de código (Flit Certify) — 2026-07-13 09:05 #3",
    "título = prefijo + fecha/hora + #N",
  );
  const withFinds = [
    { layer: "unit", status: "fail", metrics: { tool: "dotnet-test" }, cases: [
      { name: "resta", status: "fail", message: "esperaba 2", blame: { author: "Ana", file: "calc.ts", line: 4 } },
      { name: "Crea_Throws", status: "fail", message: "Npgsql.PostgresException: 28P01: password authentication failed" },
      { name: "suma", status: "pass" },
    ] },
    { layer: "static", status: "pass", metrics: { tool: "eslint" }, cases: [] },
  ];
  const sHtml = renderFindingsDescription({ results: withFinds, layersRun: ["unit", "static"], when: "2026-07-13 09:05", reportPath: "C:/r/report.html" });
  // Números ETIQUETADOS: distingue CAPAS (1) de PRUEBAS (2) — ya no se mezclan en un solo "hallazgos".
  assert.ok(/1 capa\(s\) con hallazgos/.test(sHtml) && /2 prueba\(s\) en rojo/.test(sHtml) && /❌ Hallazgos/.test(sHtml), "veredicto separa capas vs pruebas");
  assert.ok(/Resumen por capa/.test(sHtml) && /Pasaron/.test(sHtml) && /Pruebas unitarias/.test(sHtml), "cuadro por capa con columnas claras + etiqueta legible");
  assert.ok(/resta/.test(sHtml) && /Ana/.test(sHtml) && /calc\.ts:4/.test(sHtml), "lista el caso fallido con su último autor");
  assert.ok(/base de datos/.test(sHtml) && /ENTORNO/.test(sHtml), "humaniza el fallo de BD (Npgsql/28P01 → problema de entorno)");
  assert.ok(/report\.html/.test(sHtml), "cita la ruta del reporte local");
  // Evidencia (capa que pasó, en lenguaje claro) + estructura visual (cajas/secciones inline).
  assert.ok(/Evidencia — lo que se validó/.test(sHtml) && /revisó el código/.test(sHtml), "muestra las capas que pasaron como evidencia, en claro");
  // Evidencia ESPECÍFICA por objetivo: dos proyectos .NET distintos → descripciones DISTINTAS (módulo/capa),
  // no el mismo molde. Domain → reglas de negocio; Application → casos de uso; y el módulo por nombre.
  const perObj = renderFindingsDescription({ results: [
    { layer: "unit", status: "pass", metrics: { tool: "dotnet-test", label: "Flit.Tramites.Domain.Tests" }, cases: [] },
    { layer: "unit", status: "pass", metrics: { tool: "dotnet-test", label: "Flit.Analytics.Application.Tests" }, cases: [] },
  ], layersRun: ["unit"], when: "w" });
  assert.ok(/reglas de negocio del dominio.*m.dulo de tr.mites/s.test(perObj), "Domain → reglas de negocio del dominio del módulo de trámites");
  assert.ok(/casos de uso.*anal.tica/s.test(perObj), "Application → casos de uso del módulo de analítica");
  assert.ok(/border-radius/.test(sHtml) && /border-left:5px/.test(sHtml), "usa cajas y barras de sección para claridad visual");
  // Sugerencias: agrupadas por REGLA (explicación una vez) + nombre AMIGABLE del componente + ruta EXACTA
  // (para agentes) + conteo. Dos usos de la misma regla en 2 componentes → un solo bloque, dos ocurrencias.
  const withWarn = renderFindingsDescription({ results: [{ layer: "static", status: "pass", metrics: { tool: "eslint", cwd: "frontend" }, cases: [
    { name: "components/atom/Login.tsx:126:11 @next/next/no-img-element", status: "skip" },
    { name: "app/invite/activate/page.tsx:22:11 @next/next/no-img-element", status: "skip" },
  ] }], layersRun: ["static"], when: "w" });
  assert.ok(/Capa: Análisis estático — eslint · frontend/.test(withWarn) && /Qué significa/.test(withWarn) && /Image/.test(withWarn), "sugerencias referenciadas a su capa + explicación");
  assert.ok(/2 uso\(s\) en 2 archivo\(s\)/.test(withWarn), "agrupa por regla con conteo (2 usos en 2 archivos)");
  assert.ok(/Componente «Login»/.test(withWarn) && /Página «\/invite\/activate»/.test(withWarn), "nombre amigable del componente/página");
  assert.ok(/components\/atom\/Login\.tsx:126:11/.test(withWarn), "conserva la ruta EXACTA para que los agentes corrijan");
  const clean = renderFindingsDescription({ results: [{ layer: "unit", status: "pass", metrics: { tool: "vitest" }, cases: [{ name: "ok", status: "pass" }] }], layersRun: ["unit"], when: "w" });
  assert.ok(/Sin hallazgos/.test(clean) && /Evidencia/.test(clean), "sin fallos → 'Sin hallazgos' + evidencia de lo que pasó");
  assert.strictEqual(summarizeFindings(withFinds).caseFails, 2, "cuenta 2 pruebas fallidas");
  ok("QA de código: HU de hallazgos — números claros (capas vs pruebas) + evidencia + sugerencias + cajas");

  // ── COHERENCIA en las 4 rutas (HU, MD, HTML, UX) ─────────────────────────────────────────────
  // Un caso que trae su propia explicación se muestra SIEMPRE —pase, falle o se omita— con la
  // etiqueta que corresponde a su estado. Antes solo se explicaban los ROJOS: un check «no
  // declarado» o uno en verde perdían su mensaje (y en la HU ni siquiera aparecían).
  const dbRes = [{ layer: "db", status: "fail", metrics: { tool: "postgres-probe" }, cases: [
    { name: "Conexión directa a PostgreSQL", status: "pass", message: "PostgreSQL 16.14", plain: "Se conectó a la base y respondió." },
    { name: "Migraciones al día", status: "fail", message: "código: 82 · base: 81", plain: "La base está DESACTUALIZADA respecto al código.", action: "Aplicá las migraciones pendientes." },
    { name: "Aislamiento por tenant (RLS)", status: "skip", message: "No declarado en el perfil del repo.", plain: "Este proyecto no declaró aislamiento por RLS.", action: "Declaralo en qa-project.profile.yaml: db.multitenant.rls: true" },
  ] }];
  const hu = renderFindingsDescription({ results: dbRes, layersRun: ["db"], when: "w" });
  assert.ok(/⏭ No verificado/.test(hu) && /no declaró aislamiento por RLS/.test(hu) && /db\.multitenant\.rls: true/.test(hu), "HU: el check «no declarado» es visible y dice cómo activarlo (antes desaparecía)");
  // La capa db quedó en ROJO pero conectó y validó: su evidencia sigue en «✅ Evidencia» (parcial),
  // nombrando cada punto cubierto. Antes la capa desaparecía entera de la evidencia por tener un hallazgo.
  assert.ok(/Evidencia — lo que se validó/.test(hu) && /evidencia parcial/.test(hu), "HU: una capa en rojo que igual validó cosas aparece como evidencia PARCIAL");
  assert.ok(/✅ Conexión directa a PostgreSQL — Se conectó a la base/.test(hu), "HU: nombra el punto concreto que sí se validó (y su explicación)");
  assert.ok(/🧩 <strong>Qué pasó:<\/strong> La base está DESACTUALIZADA/.test(hu), "HU: el hallazgo de BD se humaniza con la explicación del propio check");

  const dbMd = casesMd(dbRes).join("\n");
  assert.ok(/\*\*✔ Qué se validó:\*\* Se conectó a la base/.test(dbMd), "MD: el caso VERDE explica qué se validó (no «qué pasó»)");
  assert.ok(/\*\*🧩 Qué pasó:\*\* La base está DESACTUALIZADA/.test(dbMd) && /\*\*👉 Qué hacer:\*\* Aplicá/.test(dbMd), "MD: el ROJO trae qué pasó + qué hacer");
  assert.ok(/\*\*ℹ️ Qué significa:\*\* Este proyecto no declaró/.test(dbMd), "MD: el OMITIDO conserva su explicación (antes se perdía)");
  const dbHtml = casesHtml(dbRes);
  assert.ok(/✔ Qué se validó/.test(dbHtml) && /🧩 Qué pasó/.test(dbHtml) && /ℹ️ Qué significa/.test(dbHtml), "HTML: mismas etiquetas por estado que MD y HU");
  // Las 71 pruebas verdes de una suite NO se explican (no traen `plain`) → el reporte no se infla.
  const plainUnit = casesMd([{ layer: "unit", status: "pass", metrics: { tool: "vitest" }, cases: [{ name: "suma", status: "pass" }] }]).join("\n");
  assert.ok(/✅ suma/.test(plainUnit) && !/Qué se validó/.test(plainUnit), "un caso verde SIN explicación propia no agrega ruido");
  ok("Evidencia COHERENTE (HU/MD/HTML/UX): pase, falle u omita, cada check explica lo suyo con la etiqueta de su estado");

  // ── Un ítem de prueba OMITIDO de una capa que NO es el linter (invariante 8) ─────────────────
  // «Índices en llaves foráneas» es una sugerencia de la capa db: la sección «💡 Sugerencias» solo
  // cubre advertencias del linter (layer=static), así que sin «⏭ No verificado» este ítem quedaba
  // enterrado en el detalle por capa del md/html mientras la UX sí lo mostraba.
  const fk = [{ layer: "db", status: "fail", metrics: { tool: "postgres-probe" }, cases: [
    { name: "Índices en llaves foráneas", status: "skip", message: "37 llave(s) sin índice: a.b", plain: "37 relaciones entre tablas no tienen índice de apoyo.", action: "Crear un índice sobre esas columnas." },
    { name: "Migraciones al día", status: "fail", message: "código: 82 · base: 81", plain: "La base está desactualizada.", action: "Aplicá las migraciones." },
  ] }];
  const fkHu = renderFindingsDescription({ results: fk, layersRun: ["db"], when: "w" });
  assert.ok(/⏭ No verificado/.test(fkHu) && /Índices en llaves foráneas/.test(fkHu), "HU: el ítem omitido de una capa NO-linter tiene su sección propia");
  const fkRep = renderReport(fk);
  assert.ok(/## ⏭ No verificado \(1\)/.test(fkRep.md) && /Índices en llaves foráneas/.test(fkRep.md), "MD: misma sección «No verificado» que la HU");
  assert.ok(/⏭ No verificado \(1\)/.test(fkRep.html) && /Índices en llaves foráneas/.test(fkRep.html), "HTML: misma sección «No verificado» que la HU");
  ok("Un ítem OMITIDO de una capa no-linter (p.ej. «Índices en llaves foráneas») aparece en las 4 rutas, no solo en la UX");

  // ── Evidencia: NADA excluido, NADA recortado, con detalle técnico (invariante 8) ─────────────
  // Dos regresiones reales: (a) un tope de 8 escondía TODAS las verificaciones justo cuando la capa
  // tenía 9 (la sonda de BD llega a eso) — un ítem de prueba no puede desaparecer de «qué se validó»;
  // (b) la explicación se recortaba a 220 caracteres y moría en «…» (p.ej. la lista de tablas).
  const tablas = "audit_logs (21104 filas, 14 MB) · procedure_instances (1269 filas, 872 kB) · procedure_instance_status_history (1406 filas, 664 kB) · users (312 filas, 128 kB) · roles (14 filas, 48 kB)";
  const nine = [{ layer: "db", status: "pass", metrics: { tool: "postgres-probe" }, cases: [
    ...["Conexión directa a PostgreSQL", "Estructura de la base", "Migraciones al día", "Clave primaria por tabla",
      "Índices en llaves foráneas", "Capacidad de secuencias", "Codificación de la base", "Aislamiento por tenant (RLS)"]
      .map((name) => ({ name, status: "pass", message: `detalle de ${name}`, plain: `Se comprobó: ${name}.` })),
    { name: "Capacidad y tamaño (informativo)", status: "pass", message: tablas, plain: `Referencia de cuánto pesa hoy la base, para ver cómo crece entre corridas. Tablas más grandes: ${tablas}.` },
  ] }];
  const nineHu = renderFindingsDescription({ results: nine, layersRun: ["db"], when: "w" });
  const nineRep = renderReport(nine);
  for (const [route, s] of [["HU", nineHu], ["MD", nineRep.md], ["HTML", nineRep.html]]) {
    for (const c of nine[0].cases) assert.ok(s.includes(c.name), `${route}: la verificación «${c.name}» se lista (9 checks > el tope viejo de 8)`);
    assert.ok(s.includes("roles (14 filas, 48 kB)"), `${route}: la explicación va COMPLETA, sin recortar a «…»`);
    assert.ok(/Detalle técnico/.test(s), `${route}: la evidencia incluye el detalle técnico de cada verificación`);
  }
  // El tope sigue vigente para una suite CRUDA (sin `plain`): 71 tests verdes no inundan la evidencia.
  const bulk = renderFindingsDescription({ results: [{ layer: "unit", status: "pass", metrics: { tool: "vitest" },
    cases: Array.from({ length: 71 }, (_, i) => ({ name: `test ${i}`, status: "pass" })) }], layersRun: ["unit"], when: "w" });
  assert.ok(!/test 40/.test(bulk) && /Evidencia/.test(bulk), "una suite cruda de 71 pruebas NO se lista una por una (sigue resumida)");
  ok("Evidencia: lista TODAS las verificaciones (sin tope) y COMPLETAS (sin recortar) + detalle técnico, en HU/MD/HTML");

  // ── Bitácora «Qué se ejecutó por capa» → md + COMENTARIO de la HU (no la Description) ────────
  const exRes = [
    { layer: "unit", status: "pass", metrics: { tool: "vitest", command: "npx vitest run", ms: 4200, exitCode: 0, cwd: "frontend" }, cases: [{ name: "suma", status: "pass" }] },
    { layer: "db", status: "pass", metrics: { tool: "postgres-probe" }, cases: [{ name: "Conexión directa a PostgreSQL", status: "pass" }] },
  ];
  const exMd = executedMd(exRes).join("\n");
  assert.ok(/## Qué se ejecutó por capa/.test(exMd) && /npx vitest run/.test(exMd), "MD: la bitácora conserva el comando exacto");
  // La sonda de BD no lanza un binario: antes el filtro por `metrics.command` la dejaba FUERA del resumen.
  assert.ok(/Base de datos/.test(exMd) && /no ejecuta un comando de consola/.test(exMd), "MD: la capa db (sin comando de consola) también aparece en la bitácora");
  const exHtml = executedHtml(exRes, { when: "2026-07-15 11:27", reportPath: "C:/r/report.html" });
  assert.ok(/Qué se ejecutó en esta corrida/.test(exHtml) && /npx vitest run/.test(exHtml) && /Base de datos/.test(exHtml), "HTML del comentario: misma bitácora (comando + capa db)");
  assert.ok(/border-radius/.test(exHtml) && !/<style/.test(exHtml), "el comentario usa estilos EN LÍNEA (ADO descarta las hojas de estilo)");
  // La Description de la HU NO lleva la bitácora: ahí va el análisis de hallazgos.
  const exHu = renderFindingsDescription({ results: exRes, layersRun: ["unit", "db"], when: "w" });
  assert.ok(!/Qué se ejecutó en esta corrida/.test(exHu) && !/npx vitest run/.test(exHu), "la Description NO lleva la bitácora (va en la Discussion)");
  ok("Bitácora «Qué se ejecutó por capa»: en el md y en el COMENTARIO de la HU (Discussion), no en la Description");
}

export default { runFindingsCases };
