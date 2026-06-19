// build.mjs — empaquetador multi-target. `core/` es la FUENTE DE VERDAD; cada target de
// entrega se GENERA desde aquí. El motor compartido (core/runtime/adapters/profiles) se
// copia tal cual —preservando los imports relativos— y encima se añaden los envoltorios
// específicos de cada runtime (frontmatter/entrypoint/instalador). Una edición en core/
// alcanza a los tres targets. Node puro, cross-platform.
//
//   import { buildTarget, buildAll, TARGETS } from "./build.mjs";
//   buildAll({ rootDir, outRoot });

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TARGETS = ["plain", "claude-code", "cursor"];

// Motor compartido: se copia idéntico a cada target (imports relativos intactos).
const ENGINE = ["core", "runtime", "adapters", "profiles", "manifest.yaml"];

const BIN_SHIM =
  `#!/usr/bin/env node\n` +
  `// qa-kit — entrypoint del target. Corre el ciclo QA y sale con código según fallos.\n` +
  `import { main } from "../runtime/cli.mjs";\n` +
  `main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(3); });\n`;

// ── helpers de IO ─────────────────────────────────────────────────────────────
function rel(outDir, abs) {
  return path.relative(outDir, abs).split(path.sep).join("/");
}
function writeOut(outDir, relPath, content) {
  const abs = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return relPath.split(path.sep).join("/");
}
function copyTree(rootDir, outDir, relPath) {
  const src = path.join(rootDir, relPath);
  if (!fs.existsSync(src)) return [];
  fs.cpSync(src, path.join(outDir, relPath), { recursive: true });
  return [relPath];
}
function copyFile(srcAbs, destAbs, outDir) {
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(srcAbs, destAbs);
  return rel(outDir, destAbs);
}

// ── descubrimiento de contenido portable ─────────────────────────────────────
function listDocs(dir, fname) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, file: path.join(dir, d.name, fname) }))
    .filter((x) => fs.existsSync(x.file));
}
function discover(rootDir) {
  return {
    skills: listDocs(path.join(rootDir, "core", "skills"), "SKILL.md"),
    agents: listDocs(path.join(rootDir, "core", "agents"), "AGENT.md"),
  };
}

// frontmatter YAML simple (maneja escalares y bloques plegados `>`/`|`).
function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const mk = lines[i].match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!mk) continue;
    let val = mk[2];
    if (val === ">" || val === "|") {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      val = block.join(" ");
    } else {
      val = val.replace(/^["']|["']$/g, "");
    }
    meta[mk[1]] = val;
  }
  return { meta, body: m[2] };
}

// Convierte un SKILL.md/AGENT.md (frontmatter del kit) a una regla .mdc de Cursor.
function toMdc(text) {
  const { meta, body } = parseFrontmatter(text);
  const desc = (meta.description || meta.name || "qa-kit").replace(/\s+/g, " ").trim();
  return `---\ndescription: ${desc}\nalwaysApply: false\n---\n\n${body.trim()}\n`;
}

// ── targets ───────────────────────────────────────────────────────────────────
function claudeMd(skills, agents) {
  const list = (xs) => xs.map((x) => `- \`${x.name}\``).join("\n") || "- (ninguno)";
  return (
    `# qa-kit (target Claude Code)\n\n` +
    `Generado desde \`core/\` por \`runtime/delivery/build.mjs\`. NO editar a mano: editar core/.\n\n` +
    `Ejecuta el ciclo QA local-first con \`node bin/qa.mjs [repoRoot]\`.\n\n` +
    `## Skills\n${list(skills)}\n\n## Agents\n${list(agents)}\n`
  );
}
function plainReadme(skills) {
  return (
    `# qa-kit (target plano)\n\n` +
    `Generado desde \`core/\`. Kit autocontenido + CLI Node.\n\n` +
    `\`\`\`bash\nnode bin/qa.mjs [repoRoot] --work-item <id>\n\`\`\`\n\n` +
    `Corre static/unit/e2e/db/security/api según lo que el repo permita y deja \`qa-evidence/\`.\n` +
    `Skills: ${skills.map((s) => s.name).join(", ") || "(ninguna)"}.\n`
  );
}
function cursorInstall() {
  return (
    `# install.ps1 — target Cursor (generado desde core/).\n` +
    `# Copia .cursor/ al repo destino. El motor (runtime/core/adapters/profiles) ya viaja en este paquete.\n` +
    `param([string]$TargetRepo = ".")\n` +
    `Copy-Item -Recurse -Force "$PSScriptRoot/.cursor" "$TargetRepo/.cursor"\n` +
    `Write-Host "qa-kit (cursor) instalado en $TargetRepo/.cursor"\n`
  );
}

/**
 * Genera un target de entrega.
 * @param {object} opts
 * @param {"plain"|"claude-code"|"cursor"} opts.target
 * @param {string} opts.rootDir   raíz del kit (fuente de verdad)
 * @param {string} opts.outDir    carpeta de salida del target
 * @returns {{target:string, outDir:string, files:string[]}}
 */
export function buildTarget({ target, rootDir, outDir }) {
  if (!TARGETS.includes(target)) throw new Error(`target desconocido: ${target}`);
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];

  // 1) motor compartido (idéntico en los tres targets)
  for (const r of ENGINE) files.push(...copyTree(rootDir, outDir, r));

  // 2) envoltorios específicos del runtime
  const { skills, agents } = discover(rootDir);
  if (target === "plain") {
    files.push(writeOut(outDir, path.join("bin", "qa.mjs"), BIN_SHIM));
    files.push(writeOut(outDir, "README.md", plainReadme(skills)));
  } else if (target === "claude-code") {
    for (const s of skills) files.push(copyFile(s.file, path.join(outDir, "skills", s.name, "SKILL.md"), outDir));
    for (const a of agents) files.push(copyFile(a.file, path.join(outDir, "agents", `${a.name}.md`), outDir));
    files.push(writeOut(outDir, path.join("bin", "qa.mjs"), BIN_SHIM));
    files.push(writeOut(outDir, "CLAUDE.md", claudeMd(skills, agents)));
  } else if (target === "cursor") {
    for (const s of skills) files.push(writeOut(outDir, path.join(".cursor", "skills", `${s.name}.mdc`), toMdc(fs.readFileSync(s.file, "utf8"))));
    for (const a of agents) files.push(writeOut(outDir, path.join(".cursor", "agents", `${a.name}.mdc`), toMdc(fs.readFileSync(a.file, "utf8"))));
    files.push(writeOut(outDir, "install.ps1", cursorInstall()));
  }

  return { target, outDir, files };
}

/** Genera los tres targets bajo outRoot/<target>. */
export function buildAll({ rootDir, outRoot }) {
  return TARGETS.map((target) => buildTarget({ target, rootDir, outDir: path.join(outRoot, target) }));
}

export default { buildTarget, buildAll, TARGETS };

// CLI: node runtime/delivery/build.mjs [outRoot] [--target <t>]
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2);
  let outRoot = "dist", only = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--target" || argv[i] === "-t") only = argv[++i];
    else if (!argv[i].startsWith("-")) outRoot = argv[i];
  }
  const rootDir = path.resolve(fileURLToPath(import.meta.url), "..", "..", ".."); // raíz del kit
  const targets = only ? [only] : TARGETS;
  for (const target of targets) {
    const res = buildTarget({ target, rootDir, outDir: path.join(outRoot, target) });
    console.log(`✓ ${target}: ${res.files.length} entradas → ${res.outDir}`);
  }
}
