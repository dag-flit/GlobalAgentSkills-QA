"use client";

// Paso «Código» del asistente de Ejecución (modo "QA del código"). Indicás la carpeta del repo
// a analizar (relativa al directorio base permitido del server, CODE_QA_BASE_DIR). Las capas se
// DETECTAN automáticamente según lo que tenga el repo (linter/tests/OpenAPI/DB/escáner) y cada
// capa sin herramienta se OMITE sola durante la ejecución. Determinista, sin IA, sin navegador.
// La ruta se resuelve y CONFINA dentro de la base en el server (nunca una ruta libre); las
// herramientas corren en un sandbox con allowlist y timeout.

import type { RunWizardCtl } from "./useRunWizard";
import { AcPanel } from "./AcPanel";

export function CodeStep({ w }: { w: RunWizardCtl }) {
  const canContinue = w.sourcePath.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold">Repositorio a analizar</h2>
        <p className="text-sm text-muted">
          Indicá la <b>carpeta del repo</b> a analizar. Si el operador definió un directorio base
          (<code>CODE_QA_BASE_DIR</code>), poné la ruta <b>relativa</b> a esa base; si no, poné la
          ruta directa de la carpeta.
        </p>
        <input
          className="input font-mono w-full"
          placeholder="C:\FLIT\mi-repo   ·   o  mi-repo  (si hay base configurada)"
          value={w.sourcePath}
          onChange={(e) => w.setSourcePath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && canContinue && w.next()}
        />
        <div className="text-[11px] text-muted rounded-lg px-3 py-2 border border-border bg-panel2/40">
          ⚙️ El modo corre las herramientas de prueba del repo <b>en el server</b>, dentro de un
          sandbox (solo herramientas de QA conocidas, con timeout). En un server compartido, definí
          <code> CODE_QA_BASE_DIR</code> para confinar el análisis a esa carpeta.
        </div>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">Capas</h2>
        <p className="text-sm text-muted">
          Se <b>detectan automáticamente</b> según lo que tenga el repo: análisis estático
          (linter / type-checker), pruebas unitarias, contrato de API, base de datos y seguridad.
          Cada capa <b>sin herramienta en el proyecto se omite sola</b> durante la ejecución — no falla.
        </p>
      </div>

      {w.tracker === "azure-devops" && (
        <div className="card space-y-1">
          <div className="text-sm text-muted">
            WI destino: {w.workItem.trim() ? <span className="font-mono text-accent">{w.workItem.trim()}</span> : <span>— (solo reporte local)</span>}
          </div>
          <p className="text-[11px] text-muted">Podés fijar el WI en el paso Tracker para comentar la evidencia en la HU.</p>
        </div>
      )}

      {/* Visual de las HU + criterios del Feature/HU destino (solo lectura). Base para relacionar la
          evidencia del código con lo que pide cada historia. Solo con Azure y un WI definido. */}
      <AcPanel w={w} />

      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={w.back}>← Atrás</button>
        <button className="btn-primary" onClick={w.next} disabled={!canContinue}>Continuar →</button>
      </div>
    </div>
  );
}
