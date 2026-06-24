"use client";

import { useState } from "react";
import type { TrackerName } from "@/lib/types";
import { Field, Spinner } from "@/components/ui";
import { useAction } from "@/components/ActionFeedback";

export interface WorkItemLite {
  id: string;
  title?: string;
  state?: string;
  type?: string;
}

export function FeatureStep({
  tracker,
  onBack,
  onContinue,
}: {
  tracker: TrackerName;
  onBack: () => void;
  onContinue: (featureId: string, hus: WorkItemLite[]) => void;
}) {
  const action = useAction();
  const [featureId, setFeatureId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState<WorkItemLite | null>(null);
  const [children, setChildren] = useState<WorkItemLite[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  const isLocal = tracker === "local";

  async function fetchChildren() {
    setLoading(true);
    setError(null);
    setFeature(null);
    setChildren([]);
    await action
      .run(
        {
          loading: `Consultando el Feature #${featureId} y sus HUs en ${tracker}…`,
          success: (m) => String(m),
        },
        async () => {
          let res: any;
          try {
            const r = await fetch("/api/tracker/children", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ featureId }),
            });
            res = await r.json();
          } catch (e: any) {
            const message = e?.message ?? "Error de red";
            setError(message);
            throw new Error(message);
          }
          if (!res.ok) {
            const message = res.error || "No se pudo consultar el Feature.";
            setError(message);
            throw new Error(message);
          }
          setFeature(res.feature);
          setChildren(res.children || []);
          const sel: Record<string, boolean> = {};
          for (const c of res.children || []) sel[c.id] = true;
          setPicked(sel);
          const n = (res.children || []).length;
          return `Feature #${featureId} encontrado · ${n} HU(s) hija(s)`;
        }
      )
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  const selected = children.filter((c) => picked[c.id]);

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold">Feature y sus historias hijas</h2>
          <p className="text-sm text-muted mt-1">
            Escribe el ID del Feature; traeré sus HUs hijas desde el tracker (
            <span className="text-accent">{tracker}</span>) usando la conexión que configuraste.
            Elige contra cuáles correr y trazar.
          </p>
        </div>

        {!isLocal && (
          <div className="text-xs rounded-lg px-3 py-2 border border-border bg-panel2/40 text-muted">
            💡 <b>Trazabilidad por-HU:</b> para que una novedad se registre en su HU (y no en el
            Feature), etiqueta tus pruebas con <code>[HU-###]</code> en el título (p.ej.{" "}
            <code>describe("[HU-103] Checkout", …)</code>). Lo no etiquetado y las capas
            transversales (lint/seguridad) se reportan al Feature.
          </div>
        )}

        {isLocal ? (
          <div className="text-sm rounded-lg px-3 py-2 border border-warn/50 bg-amber-900/20 text-amber-200">
            El tracker <b>local</b> no expone jerarquía de Features/HUs. Vuelve al paso anterior y
            elige un tracker remoto (Azure DevOps, GitHub o Jira) para usar este modo.
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <div className="flex-1 max-w-xs">
              <Field label="ID del Feature">
                <input
                  className="input font-mono"
                  placeholder="ej. 10118"
                  value={featureId}
                  onChange={(e) => setFeatureId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && featureId.trim()) fetchChildren();
                  }}
                />
              </Field>
            </div>
            <button
              className="btn-ghost"
              onClick={fetchChildren}
              disabled={loading || !featureId.trim()}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Buscando…
                </span>
              ) : (
                "Buscar HUs"
              )}
            </button>
          </div>
        )}

        {error && (
          <div className="text-sm rounded-lg px-3 py-2 border border-red-700 bg-red-900/30 text-red-300">
            {error}
          </div>
        )}

        {feature && (
          <div className="rounded-lg border border-border bg-panel2/30 p-3">
            <div className="text-sm">
              <span className="badge bg-accent/15 text-accent text-[10px] mr-2">
                {feature.type || "Feature"}
              </span>
              <span className="font-medium">#{feature.id}</span> — {feature.title || "(sin título)"}
              {feature.state && <span className="text-muted"> · {feature.state}</span>}
            </div>
          </div>
        )}

        {children.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted">
                {selected.length} de {children.length} HU(s) seleccionadas
              </p>
              <div className="flex gap-2 text-xs">
                <button
                  className="underline text-muted hover:text-white"
                  onClick={() => setPicked(Object.fromEntries(children.map((c) => [c.id, true])))}
                >
                  Todas
                </button>
                <button
                  className="underline text-muted hover:text-white"
                  onClick={() => setPicked({})}
                >
                  Ninguna
                </button>
              </div>
            </div>
            <ul className="space-y-1">
              {children.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-3 rounded-lg border border-border bg-panel2/30 px-3 py-2 cursor-pointer hover:bg-panel2">
                    <input
                      type="checkbox"
                      checked={!!picked[c.id]}
                      onChange={(e) => setPicked((s) => ({ ...s, [c.id]: e.target.checked }))}
                    />
                    <span className="text-sm">
                      <span className="font-mono text-muted">#{c.id}</span> {c.title || ""}
                    </span>
                    {c.state && <span className="badge bg-panel2 text-muted text-[10px] ml-auto">{c.state}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {feature && children.length === 0 && !error && (
          <p className="text-sm text-muted">Este Feature no tiene HUs hijas (o no se encontraron).</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={onBack}>
          ← Atrás
        </button>
        <button
          className="btn-primary"
          onClick={() => onContinue(featureId.trim(), selected)}
          disabled={isLocal}
        >
          {featureId.trim() ? "Continuar →" : "Omitir (sin Feature) →"}
        </button>
        {!isLocal && (
          <span className="text-xs text-muted">
            Opcional: sin Feature se reporta localmente; con Feature se traza/comenta en él (y sus HUs).
          </span>
        )}
      </div>
    </div>
  );
}
