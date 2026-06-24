// full-suite.mjs — batería E2E completa de la webapp Quality Ops Framework.
// Requiere el dev server corriendo en :4312 (y, para cobertura, el seed cargado:
// data/runs.json = test/fixtures/seed-runs.json). Cubre TODOS los escenarios de hoy:
// BD (espacios/SSH), trackers (preflight), children, detección, ejecución de los 2 modos,
// TLS endurecido, artefactos (sandbox), cobertura de HUs y carga de páginas.
//
// Uso:  node test/full-suite.mjs     (con el dev server arriba)

import path from "node:path";
import fs from "node:fs";

const BASE = "http://localhost:4312";
const KIT = "C:\\FLIT\\GlobalizacionAgentsSkills QA\\qa-kit";
const SHOTS = "C:\\Users\\damadog\\AppData\\Local\\Temp\\claude\\C--FLIT-GlobalizacionAgentsSkills-QA-qa-kit\\458844a1-aa16-4f63-97a5-0407737e5576\\scratchpad\\verify";
try { fs.mkdirSync(SHOTS, { recursive: true }); } catch {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function skip(msg) { const e = new Error(msg); e.__skip = true; throw e; }
async function check(name, fn) {
  try {
    const detail = await fn();
    out.push({ name, status: "PASS", detail: detail || "" });
    console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`);
  } catch (e) {
    if (e && e.__skip) { out.push({ name, status: "SKIP", detail: e.message }); console.log(`  ⏭ ${name} — ${e.message}`); }
    else { out.push({ name, status: "FAIL", detail: String(e?.message ?? e) }); console.log(`  ❌ ${name} — ${String(e?.message ?? e)}`); }
  }
}

async function api(p, opts) {
  const r = await fetch(BASE + p, opts);
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const post = (p, body) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const SSH0 = { enabled: false, host: "", port: 22, user: "", authMethod: "password", password: "", privateKeyPath: "", passphrase: "", forwardHost: "", forwardPort: 0 };
const dbConn = (over = {}) => ({ id: "__t__", name: "t", engine: "postgres", host: "localhost", port: 5432, database: "d", user: "u", password: "p", ssl: false, sslAllowSelfSigned: false, ssh: { ...SSH0 }, isDefault: false, ...over });
const trk = (selected, over = {}) => ({ selected, azure: { orgUrl: "", project: "", pat: "", userEmail: "" }, github: { repository: "", token: "" }, jira: { baseUrl: "", email: "", token: "", projectKey: "" }, ...over });

async function runAndWait(body, timeoutMs = 180000) {
  const r = await post("/api/runs", body);
  assert(r.json && r.json.id, "POST /api/runs no devolvió id: " + r.text.slice(0, 200));
  const id = r.json.id;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await sleep(2000);
    const d = await api(`/api/runs/${id}`);
    if (d.json && d.json.record && d.json.record.status !== "running") return d.json.record;
  }
  throw new Error("timeout esperando el run " + id);
}

console.log("== Suite Webapp Quality Ops Framework ==\n");
console.log("-- API & ejecución --");

// ---- BD ----
await check("config: /api/config trae databases[] y tracker", async () => {
  const r = await api("/api/config");
  assert(r.status === 200, "status " + r.status);
  assert(Array.isArray(r.json.databases), "sin databases[]");
  assert(r.json.tracker && r.json.tracker.selected, "sin tracker.selected");
  return `${r.json.databases.length} conexión(es), tracker=${r.json.tracker.selected}`;
});

await check("BD: detecta espacios en la contraseña (passwordHasEdgeSpaces)", async () => {
  const r = await post("/api/db/test", { db: dbConn({ id: "__probe_sp__", password: "  abc  ", database: "x", user: "x" }) });
  assert(r.json.target && r.json.target.passwordHasEdgeSpaces === true, "no marcó espacios: " + r.text.slice(0, 120));
  return "detecta el espacio sobrante";
});

await check("BD: ruta SSH (viaSsh) intenta el túnel", async () => {
  const r = await post("/api/db/test", { db: dbConn({ id: "__probe_ssh__", ssh: { ...SSH0, enabled: true, host: "127.0.0.1", port: 1, user: "u", password: "p" } }) });
  assert(r.json.target && r.json.target.viaSsh === true, "viaSsh != true: " + r.text.slice(0, 120));
  return `viaSsh=true · ${r.json.message}`;
});

// ---- Trackers ----
await check("tracker: preflight local OK", async () => {
  const r = await post("/api/tracker/test", { tracker: trk("local") });
  assert(r.json.ok === true, "local no dio ok: " + r.text.slice(0, 120));
  return r.json.detail;
});
await check("tracker: azure sin credenciales avisa variables faltantes", async () => {
  const r = await post("/api/tracker/test", { tracker: trk("azure-devops") });
  assert(r.json.ok === false && /Faltan variables/.test(r.json.detail || ""), "no avisó faltantes: " + r.text.slice(0, 120));
  return r.json.detail;
});
await check("tracker: github token falso → 401 (red real)", async () => {
  let r;
  try { r = await post("/api/tracker/test", { tracker: trk("github", { github: { repository: "octocat/Hello-World", token: "ghp_fake_xyz" } }) }); }
  catch (e) { skip("sin red: " + e.message); }
  if (/no se pudo contactar|fetch failed|ENOTFOUND|ETIMEDOUT/i.test(r.json.detail || "")) skip("sin red: " + r.json.detail);
  assert(r.json.ok === false && /401/.test(r.json.detail || ""), "no dio 401: " + r.text.slice(0, 120));
  return r.json.detail;
});

// ---- Children ----
await check("children: local devuelve estructura vacía", async () => {
  const r = await post("/api/tracker/children", { featureId: "100", tracker: trk("local") });
  assert(r.json.ok === true && Array.isArray(r.json.children) && r.json.children.length === 0, "no vacío: " + r.text.slice(0, 120));
  return "ok, children=[]";
});

// ---- Detección ----
let detection;
await check("detect: el kit detecta 6 capas (static+security activas)", async () => {
  const r = await post("/api/detect", { kind: "local", localPath: KIT });
  assert(r.json.ok === true, "detect falló: " + r.text.slice(0, 200));
  detection = r.json.detection;
  assert(Object.keys(detection.layers).length === 6, "no son 6 capas");
  assert(detection.enabled.includes("static") && detection.enabled.includes("security"), "static/security no activas");
  return `enabled: ${detection.enabled.join(", ")}`;
});

// ---- Ejecución modo código (TLS: security debe pasar limpio) ----
let codeReport;
await check("run código: ejecuta static+security; security PASA (TLS endurecido, 0 hallazgos)", async () => {
  const rec = await runAndWait({ mode: "code", repoRoot: KIT, layers: ["static", "security"] }, 180000);
  const sec = (rec.summary.results || []).find((x) => x.layer === "security");
  const stat = (rec.summary.results || []).find((x) => x.layer === "static");
  assert(sec, "sin resultado de security");
  const findings = (sec.cases || []).map((c) => c.name).join("; ");
  assert(sec.status === "pass", `security no pasó: ${sec.narrative} | ${findings}`);
  assert(stat && stat.status === "pass", "static no pasó: " + (stat && stat.narrative));
  codeReport = rec.summary.report && (rec.summary.report.local || rec.summary.report);
  assert(codeReport && codeReport.htmlPath, "sin report.htmlPath");
  return `status=${rec.status} · security=${sec.status} · static=${stat.status}`;
});

// ---- Artefactos (sandbox) ----
await check("artefactos: sirve el report.html (200)", async () => {
  assert(codeReport && codeReport.htmlPath, "sin reporte del paso anterior");
  const r = await api("/api/artifacts?path=" + encodeURIComponent(codeReport.htmlPath));
  assert(r.status === 200, "status " + r.status);
  assert(/text\/html/.test(r.headers.get("content-type") || ""), "content-type no html");
  return "200 text/html";
});
await check("artefactos: bloquea path traversal (403)", async () => {
  const r = await api("/api/artifacts?path=" + encodeURIComponent("C:\\Windows\\win.ini"));
  assert(r.status === 403, "no bloqueó (status " + r.status + ")");
  return "403";
});

// ---- Ejecución modo explorar (Playwright/Chromium real) ----
let exploreShot;
await check("run explorar: Chromium visita la URL, explore PASA y guarda captura", async () => {
  const rec = await runAndWait({ mode: "explore", appUrl: "https://example.com" }, 120000);
  const exp = (rec.summary.results || []).find((x) => x.layer === "explore");
  assert(exp, "sin resultado explore");
  assert(exp.status === "pass", "explore no pasó: " + exp.narrative);
  assert(Array.isArray(exp.files) && exp.files.length > 0, "sin captura");
  exploreShot = exp.files[0];
  assert(fs.existsSync(exploreShot), "el archivo de captura no existe en disco");
  return `explore=pass · captura ${path.basename(exploreShot)}`;
});
await check("artefactos: sirve la captura del crawler (png 200)", async () => {
  assert(exploreShot, "sin captura del paso anterior");
  const r = await api("/api/artifacts?path=" + encodeURIComponent(exploreShot));
  assert(r.status === 200 && /image\/png/.test(r.headers.get("content-type") || ""), "no sirvió png");
  return "200 image/png";
});

// ---- Navegador (Playwright) ----
console.log("\n-- Navegador (UI) --");
const pwMod = await import("playwright");
const chromium = pwMod.chromium ?? pwMod.default?.chromium;
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

try {
  for (const [name, url] of [["/", "/"], ["/runs", "/runs"], ["/databases", "/databases"], ["/settings", "/settings"]]) {
    await check(`página ${name} carga 200`, async () => {
      const resp = await page.goto(BASE + url, { waitUntil: "networkidle" });
      assert(resp.status() === 200, "status " + resp.status());
      return "200";
    });
  }

  await check("UI: mode-picker muestra los 2 modos", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    assert(await page.getByText("QA del código").first().isVisible(), "falta QA del código");
    assert(await page.getByText("Explorar una URL").first().isVisible(), "falta Explorar una URL");
    await page.screenshot({ path: SHOTS + "\\suite-mode-picker.png", fullPage: true });
    return "QA del código + Explorar una URL";
  });

  await check("UI: wizard 'QA del código' recorre origen→detección→tracker→ejecutar", async () => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /QA del código/ }).click();
    await page.getByText("¿Dónde está el código a probar?").waitFor({ timeout: 10000 });
    await page.getByPlaceholder(/ruta.*proyecto/).fill(KIT);
    await page.getByRole("button", { name: /Detectar capas/ }).click();
    await page.getByText("Esto detecté en tu proyecto").waitFor({ timeout: 30000 });
    const body = await page.locator("body").innerText();
    const six = ["Análisis estático", "Pruebas unitarias", "Contrato de API", "Pruebas E2E", "Base de datos", "Seguridad"].filter((l) => body.includes(l));
    assert(six.length === 6, "no se ven las 6 capas: " + six.length);
    await page.screenshot({ path: SHOTS + "\\suite-detect.png", fullPage: true });
    await page.getByRole("button", { name: /^Continuar/ }).click();
    await page.getByText("¿Dónde se reportan los resultados?").waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: /Continuar/ }).click();
    await page.getByText("Resumen — listo para ejecutar").waitFor({ timeout: 15000 });
    return "llegó a 'Ejecutar' con las 6 capas detectadas";
  });

  await check("UI: cobertura de HUs marca cubiertas y la HU sin pruebas (seed)", async () => {
    const resp = await page.goto(BASE + "/runs/SEED-coverage-demo", { waitUntil: "networkidle" });
    if (resp.status() !== 200) skip("seed no cargado (data/runs.json sin SEED-coverage-demo)");
    await page.getByText("Cobertura de HUs seleccionadas").waitFor({ timeout: 10000 });
    const t = await page.locator("body").innerText();
    assert(/#103/.test(t) && /#104/.test(t), "faltan HUs cubiertas");
    assert(/#105[\s\S]*sin pruebas etiquetadas/.test(t) || /sin pruebas etiquetadas \[HU-105\]/.test(t), "no marcó la HU 105 sin cobertura");
    assert(/sin cobertura/.test(t), "no muestra el aviso de cobertura");
    await page.screenshot({ path: SHOTS + "\\suite-coverage.png", fullPage: true });
    return "103/104 cubiertas, 105 sin cobertura";
  });

  await check("UI: 0 errores de consola en el recorrido", async () => {
    if (consoleErrors.length) throw new Error(consoleErrors.slice(0, 5).join(" | "));
    return "0 errores";
  });
} finally {
  await browser.close();
}

// ---- Resumen ----
const pass = out.filter((o) => o.status === "PASS").length;
const fail = out.filter((o) => o.status === "FAIL").length;
const skipN = out.filter((o) => o.status === "SKIP").length;
console.log(`\n== Resumen webapp: ${pass} PASS · ${fail} FAIL · ${skipN} SKIP (de ${out.length}) ==`);
if (fail) {
  console.log("Fallos:");
  for (const o of out.filter((o) => o.status === "FAIL")) console.log(`  ❌ ${o.name}: ${o.detail}`);
  process.exitCode = 1;
}
