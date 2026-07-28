import fs from "node:fs";
import path from "node:path";
import { importKit } from "./kit";
import { tenantDir, ensureDataDirs } from "@/lib/paths";

// Puente de la webapp para la MATERIALIZACIÓN EFÍMERA del repo (QA del código): construye el
// `prepareWorkspace` que consume runCodeCycle con los efectos REALES —copia de archivos + ejecutor
// endurecido (allowlist + timeout) del kit—. El motor (runtime/workspace/materialize.mjs) decide QUÉ
// hacer (aplicabilidad, gestor, comandos); aquí solo se proveen fs/exec. El repo CERTIFICADO nunca se
// toca: la copia va a data/tenants/<tenant>/workspace/qa-ws-… (aislada por tenant) y se borra al final.
//
// Seguridad: reusa `makeSandboxedExec` (mismo sandbox que las capas) → el install solo puede lanzar
// npm/pnpm/yarn de la allowlist, con timeout. Ningún dato del tenant/secreto viaja al subproceso de
// instalación (hereda process.env, sin la conexión de BD ni el PAT).

type Preparer = (ctx: { repoRoot: string; detection: unknown; profile?: unknown }) => Promise<
  { workRoot: string | null; cleanup?: () => Promise<void>; warnings?: string[]; managers?: string[] } | null
>;

/**
 * Crea el preparador de espacio de trabajo aislado para una corrida de QA del código.
 * @param tenantId  tenant dueño de la corrida (aísla la carpeta de trabajo en disco)
 * @param env       entorno de la corrida (solo se usa para leer el timeout del sandbox)
 */
export async function makeCodeWorkspacePreparer({
  tenantId,
  env,
}: {
  tenantId: string;
  env: Record<string, string>;
}): Promise<Preparer> {
  const { makeMaterializer, EXCLUDE_DIRS } = await importKit("runtime/workspace/materialize.mjs");
  const { makeSandboxedExec } = await importKit("runtime/source/exec-sandbox.mjs");

  ensureDataDirs();
  const wsRoot = path.join(tenantDir(tenantId), "workspace");
  fs.mkdirSync(wsRoot, { recursive: true });

  const exclude: Set<string> = EXCLUDE_DIRS;
  // Copia recursiva excluyendo dependencias/artefactos por NOMBRE de segmento (se reinstalan). El filtro
  // corta subárboles enteros: si un dir está excluido, su contenido no se copia.
  const copyTree = (src: string, dest: string) => {
    fs.cpSync(src, dest, {
      recursive: true,
      dereference: false,
      filter: (from: string) => {
        const rel = path.relative(src, from);
        if (!rel) return true; // la raíz misma
        return !rel.split(path.sep).some((seg) => exclude.has(seg));
      },
    });
  };

  // El ejecutor del install: endurecido (allowlist npm/pnpm/yarn + timeout). NO recibe el env de la
  // corrida (que puede traer la conexión de BD): el subproceso hereda process.env, suficiente para npm.
  const exec = makeSandboxedExec({ env });

  return makeMaterializer({
    mkdtemp: (prefix: string) => fs.mkdtempSync(path.join(wsRoot, prefix || "qa-ws-")),
    copyTree,
    rm: (dir: string) => fs.rmSync(dir, { recursive: true, force: true }),
    readdir: (abs: string) => {
      try {
        return fs.readdirSync(abs, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
      } catch {
        return [];
      }
    },
    readFile: (abs: string) => {
      try {
        return fs.readFileSync(abs, "utf8");
      } catch {
        return null;
      }
    },
    exec,
  }) as Preparer;
}
