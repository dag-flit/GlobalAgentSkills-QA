import { Spinner } from "@/components/ui";
import { LAYER_ORDER, MODES } from "./types";
import type { RunWizardCtl } from "./useRunWizard";

/** Paso «Ejecutar»: resumen de la configuración y botón para lanzar el ciclo. */
export function RunSummary({ w }: { w: RunWizardCtl }) {
  const modeMeta = MODES.find((m) => m.id === w.mode)!;
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold">Resumen — listo para ejecutar</h2>
        <ul className="text-sm space-y-1">
          <li>
            <span className="text-muted">Modo:</span> {modeMeta.label}
          </li>
          <li>
            <span className="text-muted">Tracker:</span> <span className="text-accent">{w.tracker}</span>
          </li>
          {w.mode === "code" && (w.featureId || w.hus.length > 0) && (
            <li>
              <span className="text-muted">Feature:</span> #{w.featureId || "—"} · {w.hus.length} HU(s) seleccionadas
            </li>
          )}
          {w.mode === "code" && (
            <li>
              <span className="text-muted">Código:</span> <span className="font-mono">{w.repoRoot || "—"}</span>
            </li>
          )}
          {w.mode === "code" && w.detection && (
            <li>
              <span className="text-muted">Capas:</span> {LAYER_ORDER.filter((l) => w.layerOn[l]).join(", ") || "—"}
            </li>
          )}
          {w.appUrl && (
            <li>
              <span className="text-muted">URL{w.mode === "code" ? " base (E2E)" : ""}:</span>{" "}
              <span className="font-mono">{w.appUrl}</span>
            </li>
          )}
        </ul>
        {w.mode === "explore" && (
          <div className="text-sm rounded-lg px-3 py-2 border border-border bg-panel2/40 text-muted">
            Abriré un navegador (Playwright) para explorar la URL: revisa el estado HTTP, errores de consola y
            guarda una captura por página.
          </div>
        )}
        {w.launchError && (
          <div className="text-sm rounded-lg px-3 py-2 border border-red-700 bg-red-900/30 text-red-300">
            {w.launchError}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={w.back}>
          ← Atrás
        </button>
        <button className="btn-primary" onClick={w.launch} disabled={w.launching}>
          {w.launching ? (
            <span className="flex items-center gap-2">
              <Spinner /> Iniciando…
            </span>
          ) : (
            "▶ Ejecutar ciclo QA"
          )}
        </button>
      </div>
    </div>
  );
}
