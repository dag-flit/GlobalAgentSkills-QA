import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { tenantDir, ensureDataDirs } from "@/lib/paths";
import { currentTenantId } from "@/lib/db/tenantContext";

const pexec = promisify(execFile);

/** Nombre de carpeta seguro a partir de una URL de repo. */
export function repoSlug(url: string): string {
  const last = url.replace(/\/+$/, "").split(/[\\/]/).pop() ?? "repo";
  return last.replace(/\.git$/i, "").replace(/[^a-zA-Z0-9._-]/g, "-") || "repo";
}

/**
 * Valida que la URL de clone sea SEGURA antes de pasarla a git (F2: hardening).
 * Permite solo `https://` o SSH (scp-like `git@host:path` o `ssh://`). Rechaza `file:`, `ext::`,
 * protocolos arbitrarios, opciones inyectadas (empieza por `-`) y saltos de línea. Lanza si no pasa.
 */
export function validateGitUrl(url: string): void {
  const u = String(url ?? "").trim();
  if (!u) throw new Error("URL de repositorio vacía");
  if (/[\n\r\t]/.test(u)) throw new Error("URL de repositorio inválida (caracteres de control)");
  if (u.startsWith("-")) throw new Error("URL de repositorio inválida (parece una opción)");
  const httpsOk = /^https:\/\/[^\s]+$/i.test(u);
  const sshScp = /^[a-z0-9._-]+@[a-z0-9.-]+:[a-z0-9._/-]+$/i.test(u);
  const sshUrl = /^ssh:\/\/[a-z0-9._-]+@[a-z0-9.-]+(:\d+)?\/[^\s]+$/i.test(u);
  if (!httpsOk && !sshScp && !sshUrl) {
    throw new Error("URL no permitida: usa https:// o SSH (git@host:path / ssh://). Se rechazan file:, ext::, etc.");
  }
}

/** Valida un nombre de branch (charset seguro, no empieza por `-`). */
export function validateBranch(branch?: string): void {
  if (branch == null || branch === "") return;
  if (branch.startsWith("-") || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new Error("Nombre de branch inválido");
  }
}

async function git(args: string[], cwd?: string): Promise<string> {
  // Endurecido (F2): deshabilita protocolos peligrosos (ext/file), helpers de credenciales y el
  // prompt interactivo. execFile (sin shell) ya evita inyección por el shell.
  const hardened = [
    "-c", "protocol.ext.allow=never",
    "-c", "protocol.file.allow=never",
    "-c", "credential.helper=",
    ...args,
  ];
  const { stdout } = await pexec("git", hardened, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

/**
 * Clona (o actualiza si ya existe) un repo Git en data/tenants/<tenantId>/repos/<slug>
 * (aislado por tenant). Devuelve la ruta absoluta del repo local listo para analizar.
 */
export async function cloneOrUpdate(url: string, branch?: string): Promise<string> {
  validateGitUrl(url);
  validateBranch(branch);
  ensureDataDirs();
  const reposDir = path.join(tenantDir(currentTenantId()), "repos");
  fs.mkdirSync(reposDir, { recursive: true });
  const dir = path.join(reposDir, repoSlug(url));
  const isRepo = fs.existsSync(path.join(dir, ".git"));

  if (!isRepo) {
    const args = ["clone", "--depth", "1"];
    if (branch) args.push("--branch", branch);
    args.push("--", url, dir); // `--` evita que una URL tipo `-opt` se interprete como flag
    await git(args);
  } else {
    await git(["fetch", "--depth", "1", "origin", ...(branch ? [branch] : [])], dir);
    const ref = branch ? `origin/${branch}` : "FETCH_HEAD";
    await git(["reset", "--hard", ref], dir);
  }
  return dir;
}
