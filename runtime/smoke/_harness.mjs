// runtime/smoke/_harness.mjs — contexto y helpers compartidos del smoke test (F1 split).
// El smoke se partió por área en runtime/smoke/*.mjs; cada módulo exporta `run(ctx)` y usa
// este contexto. Los valores que un caso temprano produce y otros consumen (pDefault/pFlit/
// tmp/res) se fijan en el módulo `resolver` sobre `ctx` y los leen los demás módulos.
import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url)); // runtime/smoke/
export const HERE = path.resolve(THIS_DIR, "..");              // runtime/
export const REPO_ROOT = path.resolve(THIS_DIR, "..", "..");   // raíz del kit

// Credenciales ADO de prueba (constantes; ningún caso las muta).
export const creds = {
  AZURE_ORG_URL: "https://dev.azure.com/acme",
  AZURE_PROJECT_NAME: "Proj",
  AZURE_PAT: "secret",
  USER_REAL_EMAIL: "qa@acme.io",
};

// Transporte HTTP falso para ADO/GitHub/Jira: enruta por (match → respond) y registra llamadas.
export function makeFakeAdo(routes) {
  const calls = [];
  const http = async (req) => {
    calls.push(req);
    for (const [match, respond] of routes) if (match(req)) return respond(req);
    return { status: 200, json: {}, text: "{}" };
  };
  const find = (method, sub) => calls.find((c) => c.method === method && c.url.includes(sub));
  return { http, calls, find };
}

// Ejecutor que captura los argv (para verificar conexión/ruleset/colección).
export function capturingExec(code, out = {}) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push({ cmd, args });
    return { code, stdout: out.stdout || "", stderr: out.stderr || "" };
  };
  return { exec, calls };
}

// Contexto del smoke: estado de conteo + ok() + helpers + slots para valores compartidos
// entre módulos (pDefault/pFlit/tmp/res se fijan en el módulo resolver y los leen los demás).
export function makeCtx() {
  const state = { passed: 0 };
  const ok = (name) => { console.log(`  ✅ ${name}`); state.passed++; };
  return { state, ok, HERE, REPO_ROOT, creds, makeFakeAdo, capturingExec };
}
