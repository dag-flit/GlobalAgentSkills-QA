import fs from "node:fs";
import path from "node:path";

// Grounding (Fase 2): recolecta CONTEXTO del repo que se va a probar para que la IA NO invente
// imports, rutas ni APIs. Es 100% local (lee archivos del disco), best-effort y acotado en tamaño.
// Vive en la webapp (no en el core del kit). Si no hay nada que leer, devuelve contexto vacío y
// el generador trabaja como antes (sin contexto) — nunca rompe.

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "build", "coverage", "out", "vendor",
  "qa-generated", "qa-evidence", ".turbo", ".cache", "__pycache__", ".venv", "bin", "obj",
]);
const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const TEST_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/i;

export interface RepoContext {
  /** Tests existentes (muestra de estilo/convenciones). */
  exampleTests: { path: string; content: string }[];
  /** Código relacionado al criterio por coincidencia de palabras clave. */
  relevantSources: { path: string; content: string }[];
  /** Índice (rutas reales) de archivos de código, para que la IA importe SOLO de lo que existe. */
  sourceFiles: string[];
}

const EMPTY: RepoContext = { exampleTests: [], relevantSources: [], sourceFiles: [] };

function walk(dir: string, root: string, acc: { tests: string[]; sources: string[] }, depth: number) {
  if (depth > 8 || acc.tests.length + acc.sources.length > 4000) return;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (acc.tests.length + acc.sources.length > 4000) return;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      walk(path.join(dir, e.name), root, acc, depth + 1);
    } else if (CODE_RE.test(e.name)) {
      const rel = path.relative(root, path.join(dir, e.name)).replace(/\\/g, "/");
      if (TEST_RE.test(e.name)) acc.tests.push(rel);
      else acc.sources.push(rel);
    }
  }
}

function readTruncated(baseDir: string, rel: string, maxBytes: number): string {
  let content = "";
  try {
    content = fs.readFileSync(path.join(baseDir, rel), "utf-8");
  } catch {
    return "";
  }
  return content.length > maxBytes ? content.slice(0, maxBytes) + "\n/* …(truncado)… */" : content;
}

/** Palabras clave útiles (>3 letras, sin Gherkin/stopwords) para emparejar código relacionado. */
export function keywordsFrom(text: string): string[] {
  const stop = new Set([
    "para", "que", "como", "cuando", "entonces", "dado", "debe", "este", "esta", "with", "when",
    "then", "given", "shall", "should", "criterio", "usuario", "sistema", "valida", "validar",
  ]);
  return Array.from(
    new Set(
      String(text || "")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3 && !stop.has(w))
    )
  ).slice(0, 12);
}

/**
 * Recolecta contexto del repo bajo `baseDir`. Si pasas `keywords`, incluye el contenido de los
 * archivos de código cuya RUTA mejor coincide (código relacionado). Todo acotado en tamaño.
 */
export function gatherRepoContext({
  baseDir,
  keywords = [],
  maxFileBytes = 1800,
  maxSourceFiles = 60,
}: {
  baseDir: string;
  keywords?: string[];
  maxFileBytes?: number;
  maxSourceFiles?: number;
}): RepoContext {
  if (!baseDir) return EMPTY;
  try {
    if (!fs.statSync(baseDir).isDirectory()) return EMPTY;
  } catch {
    return EMPTY;
  }

  const acc = { tests: [] as string[], sources: [] as string[] };
  walk(baseDir, baseDir, acc, 0);

  // Tests de ejemplo: los de ruta más corta (suelen ser los más representativos), hasta 2.
  const exampleTests = acc.tests
    .sort((a, b) => a.length - b.length)
    .slice(0, 2)
    .map((rel) => ({ path: rel, content: readTruncated(baseDir, rel, maxFileBytes) }));

  // Código relacionado: por coincidencia de palabras clave en la ruta, hasta 2 archivos.
  let relevantSources: { path: string; content: string }[] = [];
  if (keywords.length) {
    const scored = acc.sources
      .map((rel) => {
        const low = rel.toLowerCase();
        const score = keywords.reduce((n, k) => (low.includes(k) ? n + 1 : n), 0);
        return { rel, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.rel.length - b.rel.length)
      .slice(0, 2);
    relevantSources = scored.map((s) => ({ path: s.rel, content: readTruncated(baseDir, s.rel, maxFileBytes) }));
  }

  const relevantSet = new Set(relevantSources.map((r) => r.path));
  const sourceFiles = acc.sources
    .sort((a, b) => a.length - b.length)
    .filter((f) => !relevantSet.has(f))
    .slice(0, maxSourceFiles);

  return { exampleTests, relevantSources, sourceFiles };
}

/** Convierte el contexto en un bloque de texto para inyectar en el prompt. "" si no hay nada. */
export function contextToPromptBlock(ctx: RepoContext): string {
  if (!ctx.exampleTests.length && !ctx.relevantSources.length && !ctx.sourceFiles.length) return "";
  const parts: string[] = ["", "CONTEXTO DEL PROYECTO (úsalo para NO inventar imports, rutas ni APIs):"];

  if (ctx.relevantSources.length) {
    parts.push("", "Código relacionado al criterio (impórtalo/úsalo si aplica):");
    for (const s of ctx.relevantSources) parts.push(`\n// ── ${s.path} ──\n${s.content}`);
  }
  if (ctx.sourceFiles.length) {
    parts.push("", "Otros archivos de código existentes (rutas reales — importa SOLO de estos):");
    parts.push(ctx.sourceFiles.map((f) => `- ${f}`).join("\n"));
  }
  if (ctx.exampleTests.length) {
    parts.push("", "Tests existentes (imita su ESTILO, imports y convenciones):");
    for (const t of ctx.exampleTests) parts.push(`\n// ── ${t.path} ──\n${t.content}`);
  }
  return parts.join("\n");
}
