"use client";

import { useEffect, useState } from "react";

// Nivel 1 de "QA del código guiado por AC": mostrar los criterios del Feature/HU JUNTO a los
// resultados de las pruebas, como CONTEXTO para que el humano juzgue. NO se cruzan automáticamente
// con los tests del repo (eso sería adivinar por nomenclatura → cobertura no confiable). Solo lectura.
// Reusa la ruta /api/tracker/workitem (el PAT nunca viaja al navegador). Independiente del wizard.

interface Ac {
  title: string;
  detail?: string;
}
interface WiLite {
  id: string;
  title: string;
  type: string;
  state: string;
  acceptance_criteria: Ac[];
}
interface Wi extends WiLite {
  children?: WiLite[]; // presente solo si el WI es un Feature
}

function AcList({ items }: { items: Ac[] }) {
  if (!items.length) return null;
  return (
    <ol className="space-y-1 list-decimal list-inside">
      {items.map((ac, i) => (
        <li key={i} className="text-sm">
          <span className="font-medium">{ac.title}</span>
          {ac.detail && <div className="text-[11px] text-muted whitespace-pre-line pl-4">{ac.detail}</div>}
        </li>
      ))}
    </ol>
  );
}

/** Tarjeta de criterios del WI (Feature + HU hijas, o HU sola) traída en vivo de Azure. Contexto puro. */
export function AcContext({ wid, tracker }: { wid?: string; tracker?: string }) {
  const [wi, setWi] = useState<Wi | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const id = (wid || "").trim();
  const azure = tracker === "azure-devops";

  useEffect(() => {
    if (!id || !azure) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(`/api/tracker/workitem?wid=${encodeURIComponent(id)}`);
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo leer el work item.");
        if (!cancel) setWi(j as Wi);
      } catch (e: any) {
        if (!cancel) {
          setWi(null);
          setErr(e?.message ?? "No se pudo leer el work item.");
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [id, azure]);

  // Sin WI o sin Azure no hay criterios que traer → no se muestra la tarjeta.
  if (!id || !azure) return null;

  const isFeature = wi?.type === "Feature";

  return (
    <details className="card space-y-2" open>
      <summary className="cursor-pointer text-sm font-medium">
        Criterios de aceptación {wi ? (isFeature ? "del Feature y sus HU" : "de la HU") : "del work item"}
        {loading && <span className="text-muted"> · cargando…</span>}
      </summary>
      <p className="text-[11px] text-muted mt-1">
        Se muestran como <b>contexto</b> para interpretar los resultados de abajo. No se cruzan
        automáticamente con los tests del repo: la relación AC↔prueba la juzgás vos.
      </p>

      {err && <p className="text-[11px] text-red-300">{err}</p>}

      {wi && (
        <div className="space-y-3 mt-2">
          <div className="text-xs text-muted">
            <span className="font-mono">{wi.type}</span> {wi.id} — {wi.title}{" "}
            <span className="text-muted">({wi.state})</span>
          </div>

          {/* HU simple: sus propios criterios */}
          {!isFeature && (
            <div className="space-y-2">
              {wi.acceptance_criteria.length ? (
                <AcList items={wi.acceptance_criteria} />
              ) : (
                <p className="text-[11px] text-warn">Esta HU no tiene criterios de aceptación declarados en Azure.</p>
              )}
            </div>
          )}

          {/* Feature: criterios propios (si tuviera) + cada HU hija con sus criterios */}
          {isFeature && (
            <div className="space-y-3">
              {wi.acceptance_criteria.length > 0 && (
                <div>
                  <div className="text-[11px] text-muted mb-1">Criterios del Feature:</div>
                  <AcList items={wi.acceptance_criteria} />
                </div>
              )}
              {(wi.children ?? []).length === 0 ? (
                <p className="text-[11px] text-warn">Este Feature no tiene HU hijas en Azure.</p>
              ) : (
                <div className="space-y-2">
                  <div className="text-[11px] text-muted">{wi.children!.length} HU hija(s):</div>
                  {wi.children!.map((h) => (
                    <div key={h.id} className="rounded-lg border border-border bg-panel2/30 p-2 space-y-1">
                      <div className="text-xs font-medium">
                        HU {h.id} — {h.title} <span className="text-muted">({h.state})</span>
                      </div>
                      {h.acceptance_criteria.length ? (
                        <AcList items={h.acceptance_criteria} />
                      ) : (
                        <p className="text-[11px] text-warn">Sin criterios de aceptación declarados.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </details>
  );
}
