import { LAYER_META, LAYER_ORDER } from "./types";
import type { RunWizardCtl } from "./useRunWizard";

/** Paso «Detección»: muestra stack/arquitectura y permite elegir qué capas correr. */
export function DetectStep({ w }: { w: RunWizardCtl }) {
  const { detection } = w;
  if (!detection) return null;
  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold">Esto detecté en tu proyecto</h2>
        <p className="text-[11px] text-muted font-mono break-all">{w.repoRoot}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="badge bg-panel2 text-gray-200">backend: {detection.stack.backend}</span>
          <span className="badge bg-panel2 text-gray-200">frontend: {detection.stack.frontend}</span>
          <span className="badge bg-panel2 text-gray-200">db: {detection.stack.db}</span>
          <span className="badge bg-accent/15 text-accent">arquitectura: {detection.architecture}</span>
        </div>
      </div>
      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">Capas a ejecutar</h2>
          <p className="text-sm text-muted mt-1">
            Marqué las capas con herramienta disponible. Ajusta lo que quieras correr.
          </p>
        </div>
        <div className="space-y-2">
          {LAYER_ORDER.map((l) => {
            const info = detection.layers[l];
            const meta = LAYER_META[l];
            const available = info?.enabled || (info?.targets?.length ?? 0) > 0;
            const tool = info?.tool || info?.targets?.[0]?.tool;
            return (
              <label
                key={l}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${
                  w.layerOn[l] ? "border-accent/40 bg-accent/5" : "border-border bg-panel2/30"
                } ${!available ? "opacity-60" : ""}`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!!w.layerOn[l]}
                  onChange={(e) => w.setLayerOn((s) => ({ ...s, [l]: e.target.checked }))}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{meta.label}</span>
                    {available ? (
                      <span className="badge bg-accent2/15 text-accent2 text-[10px]">
                        {tool}
                        {info?.cwd ? ` · ${info.cwd}` : ""}
                      </span>
                    ) : (
                      <span className="badge bg-panel2 text-muted text-[10px]">no disponible</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted">{meta.desc}</p>
                  {!available && info?.reason && <p className="text-[11px] text-warn mt-0.5">⚠ {info.reason}</p>}
                </div>
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={w.back}>
          ← Atrás
        </button>
        <button className="btn-primary" onClick={w.next} disabled={!Object.values(w.layerOn).some(Boolean)}>
          Continuar →
        </button>
      </div>
    </div>
  );
}
