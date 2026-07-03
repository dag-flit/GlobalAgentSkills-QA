import { Spinner } from "@/components/ui";
import { MODES } from "./types";
import { stepFilled } from "./steps-catalog";
import type { RunWizardCtl } from "./useRunWizard";

/** Paso «Ejecutar»: resumen de la configuración y botón para lanzar el ciclo. */
export function RunSummary({ w }: { w: RunWizardCtl }) {
  const modeMeta = MODES.find((m) => m.id === w.mode)!;
  const stepCount = w.flow.filter(stepFilled).length;
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
          {w.tracker === "azure-devops" && (
            <li>
              <span className="text-muted">WI destino:</span>{" "}
              {w.workItem.trim() ? <span className="font-mono">{w.workItem.trim()}</span> : <span className="text-muted">— (solo reporte local)</span>}
            </li>
          )}
          {w.appUrl && (
            <li>
              <span className="text-muted">URL:</span>{" "}
              <span className="font-mono">{w.appUrl}</span>
            </li>
          )}
          <li>
            <span className="text-muted">Pasos del flujo:</span>{" "}
            {stepCount > 0 ? `${stepCount} paso(s)` : "— (solo smoke + captura)"}
          </li>
        </ul>
        <div className="text-sm rounded-lg px-3 py-2 border border-border bg-panel2/40 text-muted">
          {stepCount > 0
            ? "Abriré un navegador (Playwright), iré a la URL y ejecutaré el flujo paso a paso, con una captura por paso."
            : "Abriré un navegador (Playwright) para explorar la URL: revisa el estado HTTP, errores de consola y guarda una captura."}
        </div>
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
