"use client";

import { TrackerStep } from "@/components/TrackerStep";
import { MODES } from "@/components/run-wizard/types";
import { useRunWizard } from "@/components/run-wizard/useRunWizard";
import { Stepper } from "@/components/run-wizard/Stepper";
import { UrlStep } from "@/components/run-wizard/UrlStep";
import { RunSummary } from "@/components/run-wizard/RunSummary";

// Asistente de ejecución: el kit quedó acotado a pruebas E2E sobre una URL viva (modo
// "Explorar una URL"). El paso a paso es Tracker → URL → Ejecutar.
export function RunWizard() {
  const w = useRunWizard();
  const { mode, key } = w;

  // mode picker
  if (!mode) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Asistente de ejecución</h1>
          <p className="text-sm text-muted mt-1">
            Elige el modo y te pediré solo lo necesario para ese flujo.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => w.chooseMode(m.id)}
              className="text-left card hover:border-accent transition-colors"
            >
              <div className="text-2xl">{m.icon}</div>
              <div className="font-semibold mt-2">{m.label}</div>
              <p className="text-sm text-muted mt-1">{m.desc}</p>
              <div className="text-accent text-sm mt-3">Elegir →</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const modeMeta = MODES.find((m) => m.id === mode)!;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Asistente de ejecución</h1>
          <p className="text-sm text-muted mt-1">
            Modo: <span className="text-accent">{modeMeta.icon} {modeMeta.label}</span>
          </p>
        </div>
        <button className="btn-ghost text-xs px-2 py-1" onClick={() => w.setMode(null)}>
          ← Cambiar modo
        </button>
      </div>

      <Stepper steps={w.steps} idx={w.safeIdx} />

      {key === "tracker" && (
        <TrackerStep
          onBack={w.back}
          onContinue={(t) => {
            w.setTracker(t);
            w.next();
          }}
        />
      )}

      {key === "url" && <UrlStep w={w} />}
      {key === "run" && <RunSummary w={w} />}
    </div>
  );
}
