"use client";

import { useState } from "react";
import { AliasPicker } from "./AliasPicker";
import { FileField } from "./FileField";
import { STEP_TYPES, stepType, type AliasOption } from "@/lib/qa/regressionSteps";
import type { RegressionStage, RegressionStep } from "@/lib/types";

// Editor de ETAPAS de un Recorrido. Cada etapa = una pantalla del asistente. Tiene dos listas de pasos
// (ambas por ALIAS del catálogo, mismo selector buscable que las suites):
//   • «Mostrar todo» (prepare): acciones a hacer ANTES de capturar, para revelar elementos que aparecen
//     al interactuar (p.ej. consultar el RUNT habilita checkbox) → así la captura no deja nada suelto.
//   • «Avanzar» (advance): pasos que llevan a la SIGUIENTE pantalla (la última etapa no lo necesita).
// Sólo se ofrecen las operaciones útiles para interactuar/avanzar.

const OPS = ["clic", "escribir", "seleccionar", "subir_archivo", "verificar_visible", "verificar_texto", "esperar_tiempo"];
const TYPES = STEP_TYPES.filter((s) => OPS.includes(s.op));

function emptyStep(): RegressionStep {
  return { op: "clic" };
}

// Editor de UNA lista de pasos (reusado por «Mostrar todo» y «Avanzar»).
function StepList({ steps, aliasOpts, addLabel, onChange }: { steps: RegressionStep[]; aliasOpts: AliasOption[]; addLabel: string; onChange: (steps: RegressionStep[]) => void }) {
  function patch(pi: number, p: Partial<RegressionStep>) {
    onChange(steps.map((st, j) => (j === pi ? { ...st, ...p } : st)));
  }
  return (
    <div className="space-y-1.5">
      {steps.map((st, pi) => {
        const t = stepType(st.op);
        return (
          <div key={pi} className="flex items-center gap-2 flex-wrap">
            <select className="input" value={st.op} onChange={(e) => patch(pi, { op: e.target.value })}>
              {TYPES.map((o) => (
                <option key={o.op} value={o.op}>{o.label}</option>
              ))}
            </select>
            {t?.needsElement && <AliasPicker options={aliasOpts} value={st.alias ?? ""} onChange={(alias) => patch(pi, { alias })} />}
            {t?.field === "ruta" ? (
              <FileField value={(st.ruta as string) ?? ""} onChange={(v) => patch(pi, { ruta: v })} />
            ) : (
              t?.field && (
                <input
                  className="input flex-1 min-w-[120px]"
                  placeholder={t.placeholder}
                  value={(st[t.field] as string) ?? ""}
                  onChange={(e) => patch(pi, { [t.field!]: e.target.value })}
                />
              )
            )}
            <button className="btn-ghost text-[11px] text-red-300 px-1.5" onClick={() => onChange(steps.filter((_, j) => j !== pi))}>×</button>
          </div>
        );
      })}
      <button className="btn-ghost text-[11px]" onClick={() => onChange([...steps, emptyStep()])}>+ {addLabel}</button>
    </div>
  );
}

export function RecorridoStages({
  stages,
  aliasOpts,
  onChange,
}: {
  stages: RegressionStage[];
  aliasOpts: AliasOption[];
  onChange: (stages: RegressionStage[]) => void;
}) {
  // Qué etapas tienen abierta la sección «Mostrar todo» (se abre sola si ya tiene pasos).
  const [prepOpen, setPrepOpen] = useState<Record<number, boolean>>({});

  function patchStage(i: number, patch: Partial<RegressionStage>) {
    onChange(stages.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  }
  function moveStage(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    const copy = stages.slice();
    [copy[i], copy[j]] = [copy[j], copy[i]];
    onChange(copy);
  }

  return (
    <div className="space-y-2">
      {stages.length === 0 && (
        <p className="text-[11px] text-muted">Todavía no hay etapas. Agregá la primera pantalla del asistente (p.ej. «Consulta RUNT»).</p>
      )}
      {stages.map((stage, si) => {
        const isLast = si === stages.length - 1;
        const prep = stage.prepare ?? [];
        const adv = stage.advance ?? [];
        const nextName = stages[si + 1]?.name?.trim();
        const nextLabel = nextName ? `«${nextName}»` : "la siguiente pantalla";
        const showPrep = prep.length > 0 || prepOpen[si];
        return (
          <div key={si} className="rounded-lg border border-border bg-panel2/40 p-2 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted w-5 shrink-0">{si + 1}.</span>
              <input
                className="input flex-1"
                placeholder="Nombre de la pantalla (ej. Consulta RUNT)"
                value={stage.name}
                onChange={(e) => patchStage(si, { name: e.target.value })}
              />
              <button className="btn-ghost text-[11px] px-1.5" title="Subir" onClick={() => moveStage(si, -1)} disabled={si === 0}>↑</button>
              <button className="btn-ghost text-[11px] px-1.5" title="Bajar" onClick={() => moveStage(si, 1)} disabled={isLast}>↓</button>
              <button className="btn-ghost text-[11px] text-red-300" onClick={() => onChange(stages.filter((_, j) => j !== si))}>Quitar</button>
            </div>

            {/* Etapa condicional: solo aplica si aparece cierto texto (pantallas que dependen de los datos). */}
            <div className="pl-7 flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted whitespace-nowrap">Mostrar esta pantalla solo si aparece el texto:</span>
              <input
                className="input flex-1 min-w-[140px]"
                placeholder="(opcional) ej. Validación de identidad — vacío = siempre aparece"
                value={stage.guardText ?? ""}
                onChange={(e) => patchStage(si, { guardText: e.target.value })}
              />
            </div>

            {/* Mostrar todo: revela elementos que aparecen al interactuar, para que la captura sea completa. */}
            <div className="pl-7">
              {showPrep ? (
                <div className="space-y-1.5">
                  <div className="text-[11px] text-muted">
                    Para mostrar todo en esta pantalla, primero hacé <span className="opacity-70">(opcional)</span>:
                  </div>
                  <p className="text-[10px] text-muted">Si al interactuar aparecen checkbox, campos o botones nuevos (p.ej. tras «Consultar»), poné esas acciones acá: la captura se hace después y los incluye.</p>
                  <StepList steps={prep} aliasOpts={aliasOpts} addLabel="acción para revelar" onChange={(steps) => patchStage(si, { prepare: steps })} />
                </div>
              ) : (
                <button className="btn-ghost text-[11px]" onClick={() => setPrepOpen((o) => ({ ...o, [si]: true }))}>
                  + ¿Esta pantalla muestra más al interactuar? Capturá esos elementos
                </button>
              )}
            </div>

            {/* Avanzar a la siguiente pantalla (no aplica a la última). */}
            {isLast ? (
              <p className="text-[11px] text-muted pl-7">Última etapa: no necesita pasos de avance.</p>
            ) : (
              <div className="pl-7 space-y-1.5">
                <div className="text-[11px] text-muted">Cómo avanzar a {nextLabel}:</div>
                {adv.length === 0 && (
                  <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1">
                    Falta indicar cómo pasar a {nextLabel}. Agregá al menos un paso (normalmente: escribir un dato + clic en el botón que continúa). Sin esto, el escaneo cataloga hasta acá y se detiene.
                  </div>
                )}
                <StepList steps={adv} aliasOpts={aliasOpts} addLabel="paso de avance" onChange={(steps) => patchStage(si, { advance: steps })} />
              </div>
            )}
          </div>
        );
      })}
      <button className="btn-ghost text-[12px]" onClick={() => onChange([...stages, { name: "", advance: [] }])}>+ etapa (pantalla)</button>
    </div>
  );
}
