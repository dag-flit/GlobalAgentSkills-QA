"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";

// Página «Analizar PR» (QA guiado por PR): pegás la URL de un PR de GitHub y el sistema lee el PR,
// vincula la(s) HU de Azure, arma el BRIEF de validación (qué probar, más allá del happy path del
// dev) y te deja: (1) publicarlo como comentario en la HU y (2) correr los guiones guardados del
// Feature/HU (fan-out). Determinista, sin IA.

interface PrMeta {
  number: number; title: string; branch: string; author: string; state: string;
  merged: boolean; candidates: number[]; featureHint: number | null; url: string;
}
interface DetectedWi { id: string; title: string; type?: string }
interface Detected { features: DetectedWi[]; hus: DetectedWi[]; other: DetectedWi[]; notFound: number[] }
interface BriefResult { ok: boolean; pr: PrMeta; detected: Detected; html: string; markdown: string; tracker: string; warnings: string[]; error?: string }

export default function PrPage() {
  const router = useRouter();
  const [prUrl, setPrUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<BriefResult | null>(null);

  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [vars, setVars] = useState<{ QA_USER: string; QA_PASS: string }>({ QA_USER: "", QA_PASS: "" });
  const [running, setRunning] = useState(false);

  async function generate() {
    setLoading(true); setError(null); setRes(null); setPublishMsg(null);
    try {
      const r = await fetch("/api/pr/brief", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl: prUrl.trim() }),
      });
      const j = (await r.json()) as BriefResult;
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo generar el brief.");
      setRes(j);
    } catch (e: any) {
      setError(e?.message ?? "Error de red.");
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    const huId = res?.detected.hus[0]?.id;
    if (!huId) return;
    setPublishing(true); setPublishMsg(null);
    try {
      const r = await fetch("/api/pr/publish", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prUrl: prUrl.trim(), workItemId: huId }),
      });
      const j = await r.json();
      setPublishMsg(j.ok ? `✓ Brief publicado en la HU ${huId}.` : `No se pudo publicar: ${j.reason || "error"}`);
    } catch (e: any) {
      setPublishMsg(`No se pudo publicar: ${e?.message ?? "error"}`);
    } finally {
      setPublishing(false);
    }
  }

  async function runGuiones() {
    const target = res?.detected.features[0]?.id ?? res?.detected.hus[0]?.id;
    if (!target) return;
    setRunning(true);
    try {
      const varsClean: Record<string, string> = {};
      if (vars.QA_USER.trim()) varsClean.QA_USER = vars.QA_USER.trim();
      if (vars.QA_PASS.trim()) varsClean.QA_PASS = vars.QA_PASS.trim();
      const r = await fetch("/api/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "explore", workItemId: String(target), vars: Object.keys(varsClean).length ? varsClean : undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.id) throw new Error(j.error || "No se pudo iniciar la corrida.");
      router.push(`/runs/${j.id}`);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo iniciar la corrida.");
      setRunning(false);
    }
  }

  const pr = res?.pr;
  const det = res?.detected;
  const primaryHu = det?.hus[0];
  const feature = det?.features[0];
  const runTarget = feature?.id ?? primaryHu?.id;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Analizar PR</h1>
        <p className="text-sm text-muted mt-1">
          Pegá la URL de un PR de GitHub. Leo el PR, vinculo la HU en Azure y armo el <b>brief de
          validación</b>: qué probar más allá del <i>happy path</i> del dev (negativa, límites, RBAC,
          error, regresión). Determinista, sin IA.
        </p>
      </div>

      <div className="card space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            className="input font-mono flex-1 min-w-[280px]"
            placeholder="https://github.com/flitsas/flit/pull/110"
            value={prUrl}
            onChange={(e) => setPrUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && prUrl.trim() && generate()}
          />
          <button className="btn-primary" onClick={generate} disabled={loading || !prUrl.trim()}>
            {loading ? <span className="flex items-center gap-2"><Spinner /> Leyendo…</span> : "Generar brief"}
          </button>
        </div>
        <p className="text-[11px] text-muted">
          El token de GitHub (opcional, para repos privados o más cuota) se configura en el servidor
          (<code>GITHUB_TOKEN</code>) y nunca viaja al navegador.
        </p>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>

      {pr && (
        <>
          <div className="card space-y-2">
            <div className="text-sm">
              <span className="font-mono text-accent">PR #{pr.number}</span> — {pr.title}
            </div>
            <div className="text-[11px] text-muted">
              Autor: <code>{pr.author}</code> · Rama: <code>{pr.branch}</code> · Estado: {pr.state}{pr.merged ? " (merged)" : ""}
            </div>
            <div className="text-[11px] text-muted">
              Detectado en Azure (por tipo real, no por el título):{" "}
              Feature: {det!.features.length ? det!.features.map((f) => `${f.id}`).join(", ") : "—"} ·{" "}
              HU: {det!.hus.length ? det!.hus.map((h) => `${h.id}${h.id === primaryHu?.id ? " ⭐" : ""}`).join(", ") : "—"}
              {det!.notFound.length > 0 && <> · <span className="text-warn">no es work item: {det!.notFound.join(", ")}</span></>}
            </div>
            {res!.warnings.length > 0 && (
              <ul className="text-[11px] text-warn list-disc list-inside">
                {res!.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}

            <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border">
              <button
                className="btn-ghost"
                onClick={publish}
                disabled={publishing || res!.tracker !== "azure-devops" || !primaryHu}
                title={res!.tracker !== "azure-devops" ? "Requiere tracker Azure" : `Comenta el brief en la HU ${primaryHu?.id ?? ""}`}
              >
                {publishing ? "Publicando…" : `💬 Publicar brief en la HU ${primaryHu?.id ?? "?"}`}
              </button>
              {publishMsg && <span className="text-[11px] text-muted">{publishMsg}</span>}
            </div>
          </div>

          {/* Correr los guiones guardados del Feature/HU (fan-out) */}
          <div className="card space-y-2">
            <div className="text-sm font-medium">Correr los guiones guardados {feature ? `del Feature ${feature.id}` : `de la HU ${primaryHu?.id ?? "?"}`}</div>
            <p className="text-[11px] text-muted">
              Ejecuta el guion GUARDADO de cada HU (fan-out). Las HU sin guion se saltan con aviso. El
              usuario/clave son opcionales (solo si el guion hace login), efímeros y no se guardan.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input className="input" placeholder="Usuario de prueba (opcional)" value={vars.QA_USER} onChange={(e) => setVars({ ...vars, QA_USER: e.target.value })} />
              <input className="input" type="password" placeholder="Clave de prueba (opcional)" value={vars.QA_PASS} onChange={(e) => setVars({ ...vars, QA_PASS: e.target.value })} />
            </div>
            <button className="btn-ghost w-fit" onClick={runGuiones} disabled={running || res!.tracker !== "azure-devops" || !runTarget}>
              {running ? "Iniciando…" : "▶ Correr guiones guardados"}
            </button>
          </div>

          {/* Brief renderizado (HTML auto-contenido, aislado en un iframe) */}
          <div className="card space-y-2">
            <div className="text-sm font-medium">Brief de validación</div>
            <iframe title="Brief de validación" srcDoc={res!.html} className="w-full rounded-lg border border-border bg-white" style={{ height: "70vh" }} sandbox="" />
          </div>
        </>
      )}
    </div>
  );
}
