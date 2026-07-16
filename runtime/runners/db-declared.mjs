// db-declared.mjs — lee lo que el PROPIO CÓDIGO del repo probado declara sobre su base de datos.
//
// Por qué existe: la capa `db` no debe OPINAR ("toda tabla con tenant_id debería tener RLS") ni exigirle
// al usuario que configure nada. Debe hacer lo mismo que las demás capas: tomar lo que el repo YA declara
// y verificar que se cumpla — igual que `static` corre el .eslintrc que el equipo escribió, y que el check
// de migraciones contrasta "el código declara 82 ↔ la base tiene 81".
//
// Acá se detecta la intención del proyecto leyendo su DDL/migraciones (.sql y .cs de EF Core). Si el
// proyecto NO declara RLS en ninguna parte, el check no aplica y se omite (no es un hallazgo: es que ese
// proyecto no usa RLS). PURO/offline: solo lee archivos, sin red ni ejecución.

import fs from "node:fs";
import path from "node:path";

// Carpetas que nunca contienen fuente declarativa (y que además traen binarios que ensucian el match).
const SKIP_DIRS = new Set(["node_modules", "bin", "obj", ".git", "dist", "build", ".vs", ".next", "coverage"]);
const SRC_EXT = /\.(sql|cs)$/i;

// Nombre de tabla → {schema, name}. Soporta "esquema"."tabla", esquema.tabla y tabla suelta.
function parseTable(raw) {
  const parts = String(raw || "")
    .trim()
    .replace(/;$/, "")
    .split(".")
    .map((p) => p.replace(/["`\[\]]/g, "").trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const name = parts[parts.length - 1].toLowerCase();
  if (!name || !/^[a-z_][a-z0-9_]*$/.test(name)) return null;
  return { schema: parts.length > 1 ? parts[parts.length - 2].toLowerCase() : null, name };
}

// Un archivo puede declarar RLS de tres formas; se recogen todas.
const RE_ENABLE = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."`\[\]]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
const RE_FORCE = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."`\[\]]+)\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi;
const RE_POLICY = /CREATE\s+POLICY\s+[\w."`\[\]]+\s+ON\s+([\w."`\[\]]+)/gi;

function collect(text, re, into) {
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text))) {
    const t = parseTable(m[1]);
    if (t) into.set(`${t.schema || ""}.${t.name}`, t);
  }
}

/**
 * Escanea el repo y devuelve qué RLS declara su código.
 * @param {string} repoRoot
 * @returns {{tables:Array<{schema:string|null,name:string}>, force:boolean, policies:number, files:number}}
 *   tables  = tablas para las que el código habilita RLS o crea una policy
 *   force   = el código usa FORCE ROW LEVEL SECURITY (el dueño de la tabla tampoco puede saltarse el filtro)
 *   files   = archivos del repo donde se encontró la declaración (evidencia de dónde salió el criterio)
 */
export function scanDeclaredRls(repoRoot, { maxDepth = 9, maxFiles = 4000 } = {}) {
  const enabled = new Map();
  const forced = new Map();
  const policies = new Map();
  let files = 0;
  let seen = 0;

  function walk(dir, depth) {
    if (depth > maxDepth || seen > maxFiles) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (seen > maxFiles) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        walk(full, depth + 1);
      } else if (e.isFile() && SRC_EXT.test(e.name)) {
        seen++;
        let text;
        try {
          text = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        if (!/ROW\s+LEVEL\s+SECURITY|CREATE\s+POLICY/i.test(text)) continue;
        files++;
        collect(text, RE_ENABLE, enabled);
        collect(text, RE_FORCE, forced);
        collect(text, RE_POLICY, policies);
      }
    }
  }
  walk(repoRoot, 0);

  // La tabla se considera "declarada con RLS" si el código la habilita o le crea una policy.
  const all = new Map([...enabled, ...policies]);
  return { tables: [...all.values()], force: forced.size > 0, policies: policies.size, files };
}

export default { scanDeclaredRls };
