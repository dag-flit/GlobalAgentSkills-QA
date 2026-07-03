"use client";

import { useEffect, useState } from "react";
import type { RunWizardCtl } from "./useRunWizard";

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

// Lista numerada de criterios (título + detalle opcional). Vacía → no renderiza.
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

// Panel «Criterios de aceptación» — SOLO LECTURA. Trae los AC declarados en Azure para tenerlos a
// la vista al armar el guion (así se sabe QUÉ verificar). Aditivo: no cambia el guion ni la corrida.
// Si el WI es un Feature, además detecta sus HU hijas y muestra los AC de cada una (igual que el
// fan-out). Solo aplica con tracker Azure y un WI destino definido.
export function AcPanel({ w }: { w: RunWizardCtl }) {
  const [wi, setWi] = useState<Wi | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const wid = w.workItem.trim();

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/tracker/workitem?wid=${encodeURIComponent(wid)}`);
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo leer el work item.");
      const loaded = j as Wi;
      setWi(loaded);
      // Alimenta el desplegable «¿Qué AC prueba?» de los pasos. Solo aplica a una HU: el guion del
      // constructor apunta a UNA HU. Para un Feature, la cobertura se arma por HU en el fan-out.
      w.setAcs(loaded.type === "Feature" ? [] : loaded.acceptance_criteria);
    } catch (e: any) {
      setWi(null);
      setErr(e?.message ?? "No se pudo leer el work item.");
    } finally {
      setLoading(false);
    }
  };

  // Carga AUTOMÁTICA al entrar con una HU/Feature (Azure): así los AC quedan disponibles para el
  // desplegable «¿Qué AC prueba?» de los pasos sin que haya que tocar el botón. Se reintenta si
  // cambia el WI. (El botón sigue sirviendo para refrescar.)
  useEffect(() => {
    if (wid && w.tracker === "azure-devops") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wid, w.tracker]);

  // Early-return DESPUÉS de todos los hooks (regla de hooks de React): sin WI o sin Azure, no se muestra.
  if (!wid || w.tracker !== "azure-devops") return null;

  const isFeature = wi?.type === "Feature";

  return (
    <div className="card space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="text-sm font-medium">
          {/* Antes de cargar no se conoce el tipo → neutro; tras cargar, específico (HU o Feature). */}
          Criterios de aceptación {wi ? (isFeature ? "del Feature y sus HU" : "de la HU") : "del work item"}
        </div>
        <button className="btn-ghost text-xs px-2 py-1 ml-auto" onClick={load} disabled={loading}>
          {loading ? "Cargando…" : wi ? "↻ Actualizar" : `⤵ Ver criterios de ${wid}`}
        </button>
      </div>
      <p className="text-[11px] text-muted">
        Trae los criterios declarados en Azure para tenerlos a la vista mientras se arma el guion.
        Si el WI es un Feature, además lista sus HU hijas con los criterios de cada una. Es solo lectura.
      </p>

      {err && <p className="text-[11px] text-red-300">{err}</p>}

      {wi && (
        <div className="space-y-3">
          <div className="text-xs text-muted">
            <span className="font-mono">{wi.type}</span> {wi.id} — {wi.title}{" "}
            <span className="text-muted">({wi.state})</span>
          </div>

          {/* HU simple: sus propios criterios */}
          {!isFeature &&
            (wi.acceptance_criteria.length ? (
              <AcList items={wi.acceptance_criteria} />
            ) : (
              <p className="text-[11px] text-warn">Esta HU no tiene criterios de aceptación declarados en Azure.</p>
            ))}

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
    </div>
  );
}
