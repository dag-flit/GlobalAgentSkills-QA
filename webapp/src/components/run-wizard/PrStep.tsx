"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui";
import type { RunWizardCtl } from "./useRunWizard";

// Paso «Desde un PR» (opcional) del asistente de Ejecución. Pegás un PR de GitHub → detecto la
// HU/Feature en Azure POR SU TIPO REAL (no por el título del PR), armo el brief de qué validar,
// y podés: confirmar el work item destino, publicar el brief en la HU, o generar un esqueleto de
// guion (andamiaje) para completar. También podés saltar el paso. Determinista, sin IA.

interface DetectedWi { id: string; title: string; type?: string }
interface Detected { features: DetectedWi[]; hus: DetectedWi[]; other: DetectedWi[]; notFound: number[] }
interface Scaffold { huId: string | null; flow: Array<Record<string, unknown>>; notes: string[] }
interface PrMeta { number: number; title: string; branch: string; author: string; state: string; merged: boolean; candidates: number[]; featureHint: number | null; url: string }
interface BriefResult { ok: boolean; pr: PrMeta; detected: Detected; scaffold: Scaffold | null; html: string; tracker: string; warnings: string[]; error?: string }

export function PrStep({ w }: { w: RunWizardCtl }) {
  const [prUrl, setPrUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<BriefResult | null>(null);
  const [coverage, setCoverage] = useState<Record<string, boolean>>({}); // huId → tiene guion guardado
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<string | null>(null); // aviso: WI enviado ≠ detectado del PR

  async function analyze() {
    // WI que el usuario envió (paso Tracker) ANTES de que el análisis lo preseleccione. Sirve para
    // avisar si el PR corresponde a otro work item (sin frenar la corrida).
    const sentWi = w.workItem.trim();
    setLoading(true); setError(null); setRes(null); setPublishMsg(null); setCoverage({}); setMismatch(null);
    try {
      const r = await fetch("/api/pr/brief", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl: prUrl.trim() }),
      });
      const j = (await r.json()) as BriefResult;
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo analizar el PR.");
      setRes(j);
      const target = j.detected.features[0]?.id ?? j.detected.hus[0]?.id;
      const candidateIds = [...j.detected.features, ...j.detected.hus].map((x) => x.id);
      const isMismatch = Boolean(sentWi && target && !candidateIds.includes(sentWi));
      // Solo pre-seleccionar el WI del PR si el usuario NO envió uno. Si envió uno, se RESPETA (no se
      // pisa), haya o no mismatch → su elección manda. Sin WI enviado, se sugiere el del PR (confirmable).
      if (!sentWi && target) w.setWorkItem(target);
      // Mismatch (NO bloquea): el WI enviado no es lo que el PR detecta. Se mantiene el WI enviado como
      // destino a EJECUTAR; se avisa que el BRIEF, si se publica, va a la HU del PR (donde se evaluó).
      if (isMismatch) {
        const kind = j.detected.features[0] ? "el Feature" : "la HU";
        const briefHu = j.detected.hus[0]?.id ?? target;
        setMismatch(
          `Enviaste el WI ${sentWi}, que no corresponde a este PR (detecté ${kind} ${target}). ` +
            `Mantengo ${sentWi} como WI a ejecutar. Ojo: el brief se publica en la HU del PR (${briefHu}), ` +
            `no en ${sentWi}. Para cambiar el WI a ejecutar, elegí con los chips de abajo.`,
        );
      }
      // Cobertura de guiones por HU detectada (¿tiene guion guardado para correr?).
      for (const hu of j.detected.hus) {
        fetch(`/api/flows?wid=${encodeURIComponent(hu.id)}`)
          .then((rf) => rf.json())
          .then((f) => setCoverage((prev) => ({ ...prev, [hu.id]: Array.isArray(f.steps) && f.steps.length > 0 })))
          .catch(() => {});
      }
    } catch (e: any) {
      setError(e?.message ?? "Error de red.");
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    const huId = res?.detected.hus.find((h) => h.id === w.workItem)?.id ?? res?.detected.hus[0]?.id;
    if (!huId) return;
    setPublishing(true); setPublishMsg(null);
    try {
      const r = await fetch("/api/pr/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl: prUrl.trim(), workItemId: huId }),
      });
      const j = await r.json();
      // Deja explícito el destino: si la HU del brief no es el WI seleccionado (p.ej. elegiste un
      // Feature, o hay mismatch con lo enviado), se aclara que es la HU donde se evaluó el PR.
      const note = huId !== w.workItem ? ` (HU del PR, no el WI ${w.workItem})` : "";
      setPublishMsg(j.ok ? `✓ Brief publicado en la HU ${huId}${note}.` : `No se pudo publicar: ${j.reason || "error"}`);
    } catch (e: any) {
      setPublishMsg(`No se pudo publicar: ${e?.message ?? "error"}`);
    } finally {
      setPublishing(false);
    }
  }

  function loadScaffold() {
    if (!res?.scaffold) return;
    // Carga el esqueleto en el constructor (sin el ir_a: la URL se define en el paso «URL»).
    w.setFlow(res.scaffold.flow.filter((s) => s.op !== "ir_a") as any);
    w.next(); // sigue al paso «URL»; el guion queda armado para el paso «Pasos»
  }

  const det = res?.detected;
  const isBackend = (title = "") => /\[\s*backend\s*\]/i.test(title) && !/\[\s*frontend\s*\]/i.test(title);
  const chips = det
    ? [...det.features.map((f) => ({ ...f, kind: "Feature" })), ...det.hus.map((h) => ({ ...h, kind: "HU" }))]
    : [];
  // Sufijo de estado del chip HU: backend (no E2E) / con guion / sin guion.
  const huSuffix = (id: string, title = "") => {
    if (isBackend(title)) return " · backend (no E2E)";
    if (coverage[id] === true) return " · guion ✓";
    if (coverage[id] === false) return " · sin guion ⚠";
    return "";
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h2 className="font-semibold">Analizar un PR (opcional)</h2>
        <p className="text-sm text-muted">
          Pegá la URL de un PR de GitHub: detecto la HU/Feature en Azure (por su <b>tipo real</b>, no
          por el título), armo el <b>brief</b> de qué validar y podés generar un esqueleto de guion.
          También podés <b>saltar</b> este paso.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="input font-mono flex-1 min-w-[280px]"
            placeholder="https://github.com/flitsas/flit/pull/110"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && prUrl.trim() && analyze()}
          />
          <button className="btn-primary" onClick={analyze} disabled={loading || !prUrl.trim()}>
            {loading ? <span className="flex items-center gap-2"><Spinner /> Leyendo…</span> : "Analizar PR"}
          </button>
        </div>
        {w.tracker !== "azure-devops" && (
          <p className="text-[11px] text-warn">
            Con tracker Local no puedo leer los AC ni confirmar el tipo en Azure (el brief sale por
            áreas). Elegí Azure en el paso Tracker para la detección autoritativa.
          </p>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>

      {res && (
        <>
          <div className="card space-y-2">
            <div className="text-sm"><span className="font-mono text-accent">PR #{res.pr.number}</span> — {res.pr.title}</div>
            <div className="text-[11px] text-muted">Autor: <code>{res.pr.author}</code> · Rama: <code>{res.pr.branch}</code></div>

            {mismatch && (
              <div className="text-xs rounded-lg px-3 py-2 border border-amber-600/60 bg-amber-900/20 text-amber-200">
                ⚠ {mismatch}
              </div>
            )}

            <div className="text-[11px] text-muted">Detectado en Azure (por tipo real). Elegí el work item a ejecutar:</div>
            <div className="flex items-center gap-2 flex-wrap">
              {chips.length ? (
                chips.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => w.setWorkItem(c.id)}
                    className={`text-xs px-2 py-1 rounded-lg border ${w.workItem === c.id ? "border-accent text-accent bg-accent/10" : "border-border text-muted hover:text-white"}`}
                    title={c.title}
                  >
                    {c.kind} {c.id}
                    {c.kind === "HU" ? huSuffix(c.id, c.title) : ""}
                  </button>
                ))
              ) : (
                <span className="text-[11px] text-warn">Sin HU/Feature en Azure (¿ajuste en caliente?). Podés fijar el WI a mano en el paso Tracker, o correr por URL.</span>
              )}
            </div>
            <p className="text-[11px] text-muted">
              Al correr un <b>Feature</b> se recorren <b>todas</b> sus HU y se ejecuta el guion GUARDADO de cada
              una: las <b>backend</b> y las que <b>no tienen guion</b> se saltan (no hay nada que correr en ellas).
              El brief dice qué validar; para ejecutar, armá un guion o usá <b>🧩 Generar andamiaje</b>.
            </p>
            {det!.notFound.length > 0 && <p className="text-[11px] text-muted">No son work items (descartados): {det!.notFound.join(", ")}</p>}
            {res.warnings.length > 0 && <ul className="text-[11px] text-warn list-disc list-inside">{res.warnings.map((wn, i) => <li key={i}>{wn}</li>)}</ul>}

            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border">
              <button className="btn-ghost" onClick={publish} disabled={publishing || res.tracker !== "azure-devops" || !det!.hus.length}>
                {publishing ? "Publicando…" : "💬 Publicar brief en la HU"}
              </button>
              {res.scaffold && (
                <button className="btn-ghost" onClick={loadScaffold} title="Carga un esqueleto de guion (a completar) y sigue al armado">
                  🧩 Generar andamiaje del guion
                </button>
              )}
              {publishMsg && <span className="text-[11px] text-muted">{publishMsg}</span>}
            </div>
          </div>

          <div className="card space-y-2">
            <div className="text-sm font-medium">Brief de validación (qué probar)</div>
            <iframe title="Brief de validación" srcDoc={res.html} className="w-full rounded-lg border border-border bg-white" style={{ height: "60vh" }} sandbox="" />
          </div>
        </>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost" onClick={w.back}>← Atrás</button>
        <button className="btn-primary" onClick={w.next}>{res ? "Continuar →" : "Saltar (sin PR) →"}</button>
      </div>
    </div>
  );
}
