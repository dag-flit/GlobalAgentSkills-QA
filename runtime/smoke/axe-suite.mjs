// axe-suite.mjs — accesibilidad (axe) en el modo Explorar URL. Verifica OFFLINE (page inyectable, fuente
// de axe inyectada como string): (1) buildAxeEvidence agrupa por regla y mapea severidad (crítica/grave →
// bloquea, moderada/menor → sugerencia), respeta off/ignore y queda en silencio si axe no analizó nada;
// (2) scanPageAccessibility inyecta+corre axe sobre una página falsa; (3) runExplore anexa el objeto axe
// SOLO si hay fuente de axe (sin ella, NADA → la QA de código nunca lo ve); (4) coherencia MD/HTML.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanPageAccessibility, buildAxeEvidence } from "../runners/axe-scan.mjs";
import { runExplore } from "../runners/explore.mjs";
import { writeLocalReport } from "../evidence/local-sink.mjs";

const AXE_SRC = "/* fuente de axe-core (falsa) */";
// Página falsa: evaluate(string) = inyección de la fuente (→ undefined); evaluate(fn) = corrida de axe
// (→ violaciones canned). Además cubre lo que usa el URL-smoke: goto/screenshot/close/on.
function fakePage(violations) {
  return {
    on() {},
    async goto() { return { status: () => 200 }; },
    async screenshot() {},
    async close() {},
    async evaluate(arg) { return typeof arg === "string" ? undefined : violations; },
  };
}

export async function run(ctx) {
  const { ok } = ctx;

  const violations = [
    { id: "image-alt", impact: "critical", help: "Las imágenes necesitan texto alternativo", helpUrl: "https://x/image-alt", count: 1, nodes: ["img.logo"] },
    { id: "color-contrast", impact: "minor", help: "Contraste insuficiente", helpUrl: "https://x/contrast", count: 2, nodes: [".btn", ".link"] },
  ];

  // (1) buildAxeEvidence: severidad → estado; agrupa por regla; off/ignore; silencio si nada corrió.
  const ev = buildAxeEvidence([{ url: "/inicio", ran: true, violations }]);
  assert.strictEqual(ev.status, "fail", "una violación crítica bloquea el objeto");
  assert.strictEqual(ev.metrics.tool, "axe", "el objeto es de la herramienta axe (modo explore)");
  const crit = ev.cases.find((c) => /image-alt|alternativo/i.test(c.name));
  const minor = ev.cases.find((c) => /contrast|Contraste/i.test(c.name));
  assert.ok(crit.status === "fail" && crit.plain && crit.action, "crítica → fail con plain/action");
  assert.ok(minor.status === "skip", "menor → sugerencia (skip), no bloquea");
  assert.strictEqual(buildAxeEvidence([{ url: "/x", ran: true, violations: [] }]).status, "pass", "sin violaciones → pass");
  assert.strictEqual(buildAxeEvidence([{ url: "/x", ran: false, violations: [] }]), null, "si axe no analizó nada → null (silencio)");
  assert.strictEqual(buildAxeEvidence([{ url: "/x", ran: true, violations }], { profile: { explore: { accessibility: { off: true } } } }), null, "off desactiva la accesibilidad");
  const ignored = buildAxeEvidence([{ url: "/x", ran: true, violations }], { profile: { explore: { accessibility: { ignore: ["color-contrast"] } } } });
  assert.ok(!ignored.cases.some((c) => /contrast|Contraste/i.test(c.name)), "ignore descarta esa regla");
  ok("Accesibilidad: buildAxeEvidence agrupa por regla, mapea severidad (crítica bloquea/menor sugiere), off/ignore, silencio sin datos");

  // (2) scanPageAccessibility: con fuente inyecta+corre; sin fuente no corre.
  const scanned = await scanPageAccessibility(fakePage(violations), { axeSource: AXE_SRC });
  assert.ok(scanned.ran && scanned.violations.length === 2, "con axeSource: inyecta la fuente y corre axe en la página");
  const noSrc = await scanPageAccessibility(fakePage(violations), {});
  assert.strictEqual(noSrc.ran, false, "sin axeSource no corre (queda en silencio)");
  ok("Accesibilidad: scanPageAccessibility inyecta la fuente y corre axe (página inyectable); sin fuente no corre");

  // (3) runExplore: con axeSource anexa el objeto axe; SIN axeSource no aparece nada (la QA de código nunca lo ve).
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "qa-axe-"));
  try {
    const launch = () => ({ async newPage() { return fakePage(violations); }, async close() {} });
    const withAxe = await runExplore({ repoRoot: repo, appUrl: "http://app.local", launchBrowser: launch, axeSource: AXE_SRC });
    assert.ok(withAxe.some((r) => r.metrics?.tool === "playwright"), "corre la exploración de URL (playwright)");
    const axeObj = withAxe.find((r) => r.metrics?.tool === "axe");
    assert.ok(axeObj && axeObj.layer === "explore" && axeObj.cases.length, "anexa el objeto de accesibilidad (layer explore, tool axe)");
    // Sin axeSource: loadAxeSource() no resuelve axe-core cerca del kit → NO se anexa nada de accesibilidad.
    const noAxe = await runExplore({ repoRoot: repo, appUrl: "http://app.local", launchBrowser: launch });
    assert.ok(!noAxe.some((r) => r.metrics?.tool === "axe"), "sin fuente de axe → ningún objeto de accesibilidad (silencio total)");
    ok("Accesibilidad: runExplore anexa el objeto axe SOLO si hay fuente; sin ella no aparece (aislado del modo Explorar URL)");

    // (4) Coherencia MD/HTML: la violación crítica aparece con su explicación en las dos superficies.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-axe-rep-"));
    try {
      const r = writeLocalReport({ repoRoot: dir, profile: {}, workItemId: "local", results: withAxe });
      const md = fs.readFileSync(r.mdPath, "utf8");
      const html = fs.readFileSync(r.htmlPath, "utf8");
      for (const [route, s] of [["MD", md], ["HTML", html]]) {
        assert.ok(/accesibilidad/i.test(s), `${route}: menciona la accesibilidad`);
        assert.ok(/alternativo|image-alt/i.test(s), `${route}: nombra la violación crítica con su explicación`);
      }
      ok("Accesibilidad: la violación se plasma coherente en MD/HTML (pass-through de plain/action; UX/ADO usan la misma ruta)");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
}
