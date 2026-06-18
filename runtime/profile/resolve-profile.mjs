// resolve-profile.mjs — resuelve el perfil efectivo por deep-merge.
// Cadena: default.yaml <- presets/<tracker>.yaml <- overlays/<org>.yaml <- qa-project.profile.yaml
// Si un perfil declara `profile:` o `extends:`, se carga ese eslabón antes.
//
// Uso:
//   import { resolveProfile } from "./resolve-profile.mjs";
//   const profile = resolveProfile({ repoRoot: process.cwd() });

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./yaml-lite.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = path.resolve(__dirname, "..", "..", "profiles");

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

export function deepMerge(base, override) {
  if (!isObject(base)) return override === undefined ? base : override;
  if (!isObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    if (isObject(base[key]) && isObject(override[key])) {
      out[key] = deepMerge(base[key], override[key]);
    } else {
      out[key] = override[key]; // listas y escalares: override gana
    }
  }
  return out;
}

function loadYamlFile(file) {
  if (!fs.existsSync(file)) return null;
  return parseYaml(fs.readFileSync(file, "utf8"));
}

// localiza un perfil por nombre lógico: default | <preset> | <overlay>
function locateNamed(name) {
  const candidates = [
    path.join(PROFILES_DIR, `${name}.yaml`),
    path.join(PROFILES_DIR, "presets", `${name}.yaml`),
    path.join(PROFILES_DIR, "overlays", `${name}.yaml`),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

// expande la cadena de herencia de un perfil con nombre (sigue `extends`)
function expandChain(name, seen = new Set()) {
  if (!name || seen.has(name)) return [];
  seen.add(name);
  const file = locateNamed(name);
  if (!file) return [];
  const data = loadYamlFile(file) || {};
  const parentName = data.extends || (name !== "default" ? null : null);
  const parents = parentName ? expandChain(parentName, seen) : [];
  return [...parents, { name, data }];
}

/**
 * Resuelve el perfil efectivo.
 * @param {object} opts
 * @param {string} opts.repoRoot  raíz del repo destino
 * @param {string} [opts.projectProfilePath]  ruta a qa-project.profile.yaml (override final)
 * @returns {{profile: object, chain: string[]}}
 */
export function resolveProfile({ repoRoot = process.cwd(), projectProfilePath } = {}) {
  const defaultData = loadYamlFile(path.join(PROFILES_DIR, "default.yaml")) || {};
  let chainNames = ["default"];
  let merged = defaultData;

  // perfil del proyecto (override final). Puede declarar profile: <preset|overlay>
  const projPath =
    projectProfilePath ||
    [
      path.join(repoRoot, ".qa", "qa-project.profile.yaml"),
      path.join(repoRoot, "qa-project.profile.yaml"),
      path.join(repoRoot, ".cursor", "qa-project.profile.yaml"),
    ].find((p) => fs.existsSync(p));

  const projData = projPath ? loadYamlFile(projPath) : null;

  // si el proyecto referencia un perfil con nombre, expandir su cadena primero
  const requested = projData && projData.profile ? projData.profile : null;
  if (requested) {
    const chain = expandChain(requested);
    for (const link of chain) {
      merged = deepMerge(merged, link.data);
      chainNames.push(link.name);
    }
  } else if (defaultData.tracker && defaultData.tracker !== "local") {
    // default declara un tracker no-local → aplicar su preset
    const chain = expandChain(defaultData.tracker);
    for (const link of chain) {
      merged = deepMerge(merged, link.data);
      chainNames.push(link.name);
    }
  }

  if (projData) {
    const { profile: _omit, extends: _omit2, ...rest } = projData;
    merged = deepMerge(merged, rest);
    chainNames.push(projPath);
  }

  return { profile: merged, chain: chainNames };
}

export default { resolveProfile, deepMerge };
