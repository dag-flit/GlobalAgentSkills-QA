import { Spinner } from "@/components/ui";
import { MODES } from "./types";
import { stepFilled } from "./steps-catalog";
import type { RunWizardCtl } from "./useRunWizard";

/** Paso «Ejecutar»: resumen de la configuración y botón para lanzar el ciclo. */
export function RunSummary({ w }: { w: RunWizardCtl }) {
  const modeMeta = MODES.find((m) => m.id === w.mode)!;

  // Modo "QA del código": resumen propio (ruta + capas). Aislado del bloque E2E de abajo.
  if (w.mode === "code") {
    return (
      <div className="space-y-4">
        <div className="card space-y-3">
          <h2 className="font-semibold">Resumen — listo para ejecutar</h2>
          <ul className="text-sm space-y-1">
            <li><span className="text-muted">Modo:</span> {modeMeta.label}</li>
            <li><span className="text-muted">Tracker:</span> <span className="text-accent">{w.tracker}</span></li>
            <li><span className="text-muted">Repo:</span> <span className="font-mono">{w.sourcePath.trim() || "—"}</span></li>
            <li><span className="text-muted">Capas:</span> detectadas automáticamente (se omite lo que no aplique)</li>
            <li><span className="text-muted">BD en pruebas:</span> {w.useDb ? "usar la BD configurada (inyecta la conexión)" : "no (las pruebas usan su propia configuración)"}</li>
            <li><span className="text-muted">Hallazgos:</span> HU nueva en el sprint en curso (incrementador #N) + reporte local</li>
          </ul>
          <div className="text-sm rounded-lg px-3 py-2 border border-border bg-panel2/40 text-muted">
            Correré las capas deterministas detectadas sobre el repo local (sandbox: solo herramientas
            de QA, con timeout). Los hallazgos se plasman en una <b>HU nueva</b> (User Story, no relacionada
            a nada) en el <b>sprint en curso</b> del proyecto de Azure, y el <b>reporte local</b> queda dentro
            del repo analizado. Si el operador definió <code>CODE_QA_BASE_DIR</code>, el análisis se confina a esa base.
          </div>
          {w.launchError && (
            <div className="text-sm rounded-lg px-3 py-2 border border-red-700 bg-red-900/30 text-red-300">{w.launchError}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={w.back}>← Atrás</button>
          <button className="btn-primary" onClick={w.launch} disabled={w.launching || !w.sourcePath.trim()}>
            {w.launching ? <span className="flex items-center gap-2"><Spinner /> Iniciando…</span> : "▶ Ejecutar QA del código"}
          </button>
        </div>
      </div>
    );
  }

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

        {/* WI Azure que es Feature → fan-out por HU hija con guion GUARDADO; las HU sin guion se saltan. */}
        {w.tracker === "azure-devops" && w.workItem.trim() && stepCount === 0 && (
          <div className="text-sm rounded-lg px-3 py-2 border border-border bg-panel2/40 text-muted">
            Si el WI destino es un <b>Feature</b>, ejecuto el <b>guion guardado</b> de cada HU hija (las HU sin
            guion se saltan). Para una HU sola sin pasos manuales, esto es el smoke de la URL.
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
