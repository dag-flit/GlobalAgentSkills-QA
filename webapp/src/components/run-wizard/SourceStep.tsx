import { Field, Spinner } from "@/components/ui";
import type { RunWizardCtl } from "./useRunWizard";

/** Paso «Código»: elegir ruta local o URL de Git y disparar la detección. */
export function SourceStep({ w }: { w: RunWizardCtl }) {
  return (
    <div className="space-y-4">
      <div className="card space-y-4 max-w-2xl">
        <div>
          <h2 className="font-semibold">¿Dónde está el código a probar?</h2>
          <p className="text-sm text-muted mt-1">
            Pega una URL de Git (se clona) o usa una carpeta de este equipo.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={w.sourceKind === "local" ? "btn-primary" : "btn-ghost"}
            onClick={() => w.setSourceKind("local")}
          >
            📁 Ruta local
          </button>
          <button
            className={w.sourceKind === "git" ? "btn-primary" : "btn-ghost"}
            onClick={() => w.setSourceKind("git")}
          >
            🌐 URL de Git
          </button>
        </div>
        {w.sourceKind === "local" ? (
          <Field label="Ruta de la carpeta del proyecto" hint="Carpeta en este equipo">
            <input
              className="input font-mono"
              placeholder="C:\\ruta\\al\\proyecto"
              value={w.localPath}
              onChange={(e) => w.setLocalPath(e.target.value)}
            />
          </Field>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <Field label="URL del repositorio Git" hint="Se clona en una carpeta interna">
                <input
                  className="input font-mono"
                  placeholder="https://github.com/org/proyecto"
                  value={w.gitUrl}
                  onChange={(e) => w.setGitUrl(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Rama (opcional)">
              <input className="input" placeholder="main" value={w.branch} onChange={(e) => w.setBranch(e.target.value)} />
            </Field>
          </div>
        )}
        {w.detectError && (
          <div className="text-sm rounded-lg px-3 py-2 border border-red-700 bg-red-900/30 text-red-300">
            {w.detectError}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={w.back}>
          ← Atrás
        </button>
        <button
          className="btn-primary"
          disabled={!w.canDetect || w.detecting}
          onClick={async () => {
            if (await w.runDetect()) w.next();
          }}
        >
          {w.detecting ? (
            <span className="flex items-center gap-2">
              <Spinner /> Detectando…
            </span>
          ) : (
            "Detectar capas →"
          )}
        </button>
      </div>
    </div>
  );
}
