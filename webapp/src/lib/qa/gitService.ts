import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { REPOS_DIR, ensureDataDirs } from "@/lib/paths";

const pexec = promisify(execFile);

/** Nombre de carpeta seguro a partir de una URL de repo. */
export function repoSlug(url: string): string {
  const last = url.replace(/\/+$/, "").split(/[\\/]/).pop() ?? "repo";
  return last.replace(/\.git$/i, "").replace(/[^a-zA-Z0-9._-]/g, "-") || "repo";
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await pexec("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

/**
 * Clona (o actualiza si ya existe) un repo Git en data/repos/<slug>.
 * Devuelve la ruta absoluta del repo local listo para analizar.
 */
export async function cloneOrUpdate(url: string, branch?: string): Promise<string> {
  ensureDataDirs();
  const dir = path.join(REPOS_DIR, repoSlug(url));
  const isRepo = fs.existsSync(path.join(dir, ".git"));

  if (!isRepo) {
    const args = ["clone", "--depth", "1"];
    if (branch) args.push("--branch", branch);
    args.push(url, dir);
    await git(args);
  } else {
    await git(["fetch", "--depth", "1", "origin", ...(branch ? [branch] : [])], dir);
    const ref = branch ? `origin/${branch}` : "FETCH_HEAD";
    await git(["reset", "--hard", ref], dir);
  }
  return dir;
}
