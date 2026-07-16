// secret-scan-suite.mjs — escáner de SECRETOS quemados (Paso 2 de seguridad). Verifica OFFLINE
// (listFiles/readFile inyectables, sin disco ni red): (1) detecta formas reales de credencial de alta
// confianza; (2) NO marca placeholders/refs de entorno (autonomía sin ruido); (3) el valor JAMÁS viaja
// completo — se REDACTA en las 4 rutas (el escáner no puede ser él mismo una fuga); (4) escaneo de repo
// (fail/pass) con casos agrupados por regla y plain/action; (5) escape hatch del perfil (off / ignore);
// (6) integración en runSecurityTests (objeto propio secret-scan + SAST); (7) coherencia HU/MD/HTML.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanText, scanSecrets } from "../runners/secret-scan.mjs";
import { runSecurityTests } from "../runners/security.mjs";
import { renderFindingsDescription } from "../evidence/findings-workitem.mjs";
import { writeLocalReport } from "../evidence/local-sink.mjs";

// Secretos de PRUEBA (con forma válida pero inventados). El aserto clave: ninguno aparece COMPLETO en
// la evidencia. AWS_KEY es una forma AKIA + 16 mayúsculas/dígitos; el resto, formas reconocibles.
const AWS_KEY = "AKIA" + "ABCDEFGH1234WXYZ";
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1c\n-----END RSA PRIVATE KEY-----";
const DB_PASS = "S3cr3t-Pg-9xQz!7";

function renderReport(results) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-secret-"));
  try {
    const r = writeLocalReport({ repoRoot: dir, profile: {}, workItemId: "local", results });
    return { md: fs.readFileSync(r.mdPath, "utf8"), html: fs.readFileSync(r.htmlPath, "utf8") };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
// listFiles/readFile falsos sobre un mapa {ruta: contenido} → escaneo 100% en memoria.
function fakeRepo(map) {
  return { listFiles: () => Object.keys(map), readFile: (_root, rel) => map[rel] ?? null };
}

export async function run(ctx) {
  const { ok } = ctx;

  // (1) Detecta formas reales de credencial y REDACTA el valor.
  const hits = scanText(`const k="${AWS_KEY}";\nconst db="postgres://app:${DB_PASS}@db.internal:5432/prod";\n${PEM}`, "src/config.ts");
  const rules = new Set(hits.map((h) => h.rule));
  assert.ok(rules.has("aws-key") && rules.has("conn-url") && rules.has("private-key"), "detecta clave AWS + contraseña en URL de conexión + llave privada");
  assert.ok(hits.every((h) => !JSON.stringify(h).includes(AWS_KEY) && !JSON.stringify(h).includes(DB_PASS)), "el valor detectado va REDACTADO (nunca completo)");
  assert.ok(hits.find((h) => h.rule === "aws-key").line === 1 && hits.find((h) => h.rule === "conn-url").line === 2, "reporta la línea exacta de cada hallazgo");
  ok("Secretos: detecta clave AWS + contraseña de conexión + llave privada, con valor redactado y línea exacta");

  // (2) NO marca placeholders ni referencias de entorno (autonomía sin falsos positivos).
  const clean = scanText(
    [
      'const pass = process.env.DB_PASSWORD;',
      'const url = "postgres://app:${DB_PASS}@host/db";',
      'password = changeme',
      'api_key: "your-api-key-here"',
      'const token = "xxxxxxxxxxxx";',
      'Server=localhost;Database=app;Password=<set-me>;',
    ].join("\n"),
    "src/settings.ts",
  );
  assert.strictEqual(clean.length, 0, `placeholders/env-refs no son hallazgos (se marcaron ${clean.length})`);
  ok("Secretos: placeholders y referencias de entorno NO se marcan (sin ruido)");

  // (3) La regla KV exige contexto de cadena de conexión; y la genérica exige alta entropía.
  assert.strictEqual(scanText('somePassword = "abc"', "a.cs").length, 0, "un 'Password=' suelto (sin Server/Host) no es hallazgo");
  const kv = scanText('var cs = "Server=db;Database=app;User Id=sa;Password=Zx9!Kp2$Lm7q";', "a.cs");
  assert.ok(kv.some((h) => h.rule === "conn-kv"), "detecta la contraseña de una cadena de conexión .NET real");
  const generic = scanText('const CLIENT_SECRET = "aB3xK9pL2qR7sT1uV5wY8zC4";', "a.ts");
  assert.ok(generic.some((h) => h.rule === "generic-assign"), "detecta un secreto de alta entropía asignado en el código");
  assert.strictEqual(scanText('const label = "Iniciar sesión ahora";', "a.ts").length, 0, "un texto normal de baja entropía no es secreto");
  ok("Secretos: la regla KV exige contexto de conexión y la genérica exige alta entropía");

  // (4) Escaneo de repo con hallazgos → fail, casos agrupados por regla, con plain/action.
  const dirty = scanSecrets("/repo", fakeRepo({
    "src/a.ts": `const k1="${AWS_KEY}";`,
    "src/b.ts": `const conn="postgres://svc:${DB_PASS}@db:5432/prod";`,
    "README.md": "para conectarte usa postgres://user:${PASS}@host (poné tu clave)", // placeholder → no cuenta
  }));
  assert.strictEqual(dirty.status, "fail", "un repo con secretos → fail");
  const awsCase = dirty.cases.find((c) => c.name === "Clave de acceso de AWS");
  assert.ok(awsCase && awsCase.plain && awsCase.action, "cada tipo de secreto es un caso con explicación (plain) y qué hacer (action)");
  assert.ok(!JSON.stringify(dirty.cases).includes(AWS_KEY), "ningún caso incluye el secreto completo");
  ok("Secretos: escaneo de repo agrupa por regla, con plain/action, sin filtrar el valor");

  // (5) Repo limpio → pass con un caso explicativo (evidencia positiva, invariante 8).
  const okScan = scanSecrets("/repo", fakeRepo({ "src/app.ts": 'const x = process.env.TOKEN;' }));
  assert.strictEqual(okScan.status, "pass", "repo sin secretos → pass");
  assert.ok(okScan.cases.length === 1 && okScan.cases[0].status === "pass" && okScan.cases[0].plain, "el pass trae un caso con plain (se muestra como evidencia)");
  // Escape hatch del perfil: off desactiva; ignore descarta una ruta concreta.
  assert.strictEqual(scanSecrets("/repo", { ...fakeRepo({ "a.ts": `x="${AWS_KEY}"` }), profile: { security: { secrets: { off: true } } } }).cases.length, 0, "profile.security.secrets.off desactiva el escáner");
  assert.strictEqual(scanSecrets("/repo", { ...fakeRepo({ "test/fixtures.ts": `x="${AWS_KEY}"` }), profile: { security: { secrets: { ignore: ["test/fixtures"] } } } }).status, "pass", "profile.security.secrets.ignore descarta rutas de falsos positivos");
  ok("Secretos: repo limpio da evidencia positiva; escape hatch off/ignore respetado");

  // (6) Integración: runSecurityTests devuelve el objeto propio secret-scan + el SAST.
  const repo2 = fs.mkdtempSync(path.join(os.tmpdir(), "qa-sec-"));
  try {
    fs.writeFileSync(path.join(repo2, "config.ts"), `const k="${AWS_KEY}";`, "utf8");
    const results = await runSecurityTests({ repoRoot: repo2, exec: () => ({ code: 0, stdout: "", stderr: "" }) });
    const secObj = results.find((r) => r.metrics?.tool === "secret-scan");
    assert.ok(secObj, "runSecurityTests incluye un objeto de evidencia secret-scan");
    assert.strictEqual(secObj.status, "fail", "el objeto secret-scan reporta el hallazgo real del repo");
    assert.ok(results.length >= 2, "corre junto al SAST (dos objetos: secret-scan + escáner SAST)");
    ok("Secretos: runSecurityTests emite el objeto secret-scan junto al SAST");

    // (7) Coherencia en 4 rutas: HU + MD + HTML muestran el hallazgo con plain/action y SIN el valor.
    const hu = renderFindingsDescription({ results, layersRun: ["security"], when: "w" });
    const rep = renderReport(results);
    for (const [route, s] of [["HU", hu], ["MD", rep.md], ["HTML", rep.html]]) {
      assert.ok(s.includes("Clave de acceso de AWS"), `${route}: nombra el tipo de secreto`);
      assert.ok(!s.includes(AWS_KEY), `${route}: NO filtra el secreto completo (redactado)`);
    }
    ok("Secretos: HU/MD/HTML muestran el hallazgo coherente y con el valor REDACTADO");
  } finally {
    fs.rmSync(repo2, { recursive: true, force: true });
  }
}
