"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RunEvent, RunRecord, LogLevel } from "@/lib/types";
import { StatusBadge, Spinner, fmtTime } from "@/components/ui";
import { useAction } from "@/components/ActionFeedback";

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: "text-blue-300",
  stdout: "text-gray-300",
  stderr: "text-amber-300",
  agent: "text-green-300",
  tool: "text-violet-300",
  result: "text-cyan-300",
  error: "text-red-300",
  system: "text-muted",
};

// Descripción en lenguaje claro de cada capa (para que técnicos y no técnicos entiendan igual).
const LAYER_INFO: Record<string, { label: string; desc: string }> = {
  static: { label: "Análisis estático", desc: "Revisa tipos y errores del código sin ejecutar la app (tsc, eslint, ruff, mypy)." },
  unit: { label: "Pruebas unitarias", desc: "Ejecuta los tests del proyecto (vitest, jest, pytest, dotnet test)." },
  api: { label: "Contrato de API", desc: "Valida la especificación OpenAPI o una colección Postman." },
  e2e: { label: "Pruebas E2E", desc: "Corre los flujos de punta a punta en un navegador (Playwright/Cypress)." },
  db: { label: "Base de datos", desc: "Ejecuta migraciones o tests de datos (pgtap, prisma)." },
  security: { label: "Seguridad", desc: "Escanea el código en busca de vulnerabilidades (semgrep, bandit)." },
  explore: { label: "Exploración de URL", desc: "Abre la app en un navegador: revisa estado HTTP, errores de consola y guarda una captura." },
};

const STATUS_TXT: Record<string, { label: string; cls: string }> = {
  pass: { label: "PASÓ", cls: "bg-green-900 text-green-300" },
  fail: { label: "FALLÓ", cls: "bg-red-900 text-red-300" },
  skip: { label: "OMITIDA", cls: "bg-panel2 text-muted" },
};

// Frase clara según el resultado y sus casos.
function statusSentence(r: any): string {
  const cases = Array.isArray(r.cases) ? r.cases : [];
  const p = cases.filter((c: any) => c.status === "pass").length;
  const f = cases.filter((c: any) => c.status === "fail").length;
  if (r.status === "pass") {
    return cases.length ? `Sin problemas — ${p} verificación(es) pasaron.` : "Ejecutado sin errores (la herramienta no reportó problemas).";
  }
  if (r.status === "fail") {
    return f ? `Se encontraron ${f} problema(s) — revisa el detalle.` : "Falló — revisa el detalle / el reporte.";
  }
  return "Capa omitida (no aplicaba o faltó la herramienta).";
}

export function RunDetail({ id }: { id: string }) {
  const action = useAction();
  const [record, setRecord] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [live, setLive] = useState(true);
  const [autoscroll, setAutoscroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  // metadata inicial
  useEffect(() => {
    fetch(`/api/runs/${id}`)
      .then((r) => r.json())
      .then((d) => d.record && setRecord(d.record))
      .catch(() => {});
  }, [id]);

  // stream de eventos en vivo (reproduce los previos + transmite los nuevos)
  useEffect(() => {
    const es = new EventSource(`/api/runs/${id}/stream`);
    es.addEventListener("log", (e) => {
      try {
        const ev = JSON.parse((e as MessageEvent).data) as RunEvent;
        setEvents((prev) => [...prev, ev]);
      } catch {
        /* noop */
      }
    });
    es.addEventListener("done", () => {
      setLive(false);
      es.close();
      // refrescar el registro para traer summary/resultados finales
      fetch(`/api/runs/${id}`)
        .then((r) => r.json())
        .then((d) => d.record && setRecord(d.record))
        .catch(() => {});
    });
    es.onerror = () => {
      setLive(false);
      es.close();
    };
    return () => es.close();
  }, [id]);

  useEffect(() => {
    if (autoscroll && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events, autoscroll]);

  async function stop() {
    await action
      .run({ loading: "Deteniendo la corrida…", success: "Corrida detenida" }, async () => {
        const r = await fetch(`/api/runs/${id}/stop`, { method: "POST" });
        if (!r.ok) throw new Error("No se pudo detener la corrida");
      })
      .catch(() => {});
  }

  const summary = record?.summary;
  const results: any[] = summary?.results || [];
  const counts = {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length,
  };
  const report = summary?.report?.local || summary?.report;
  const huEvidence: any[] = summary?.huEvidence || [];
  const testPlan: any = summary?.testPlan || null;
  const artifact = (p: string) => `/api/artifacts?path=${encodeURIComponent(p)}`;
  const shots: string[] = results.flatMap((r) => (Array.isArray(r.files) ? r.files : [])).filter((f) => /\.(png|jpe?g)$/i.test(f));

  // Cobertura de HUs: ¿cada HU seleccionada tiene al menos una prueba etiquetada [HU-###]?
  const huOf = (name: string): string | null => {
    const m = String(name || "").match(/\bHU[-\s]?(\d+)\b/i);
    return m ? m[1] : null;
  };
  const selectedHus = (record?.huIds || []).map(String);
  const showCoverage = record?.mode === "code" && selectedHus.length > 0 && record?.status !== "running";
  const coverageCount: Record<string, number> = {};
  let totalCases = 0;
  for (const r of results) {
    for (const c of Array.isArray(r.cases) ? r.cases : []) {
      totalCases += 1;
      const h = huOf(c.name);
      if (h) coverageCount[h] = (coverageCount[h] || 0) + 1;
    }
  }
  const coveredSet = new Set(Object.keys(coverageCount));
  const gaps = selectedHus.filter((id) => !coveredSet.has(id));
  const extra = [...coveredSet].filter((h) => !selectedHus.includes(h));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/runs" className="text-sm text-muted hover:text-white">
          ← Historial
        </Link>
        <h1 className="text-xl font-bold text-white">{record?.title || id}</h1>
        {record && <StatusBadge status={record.status} />}
        {live && (
          <span className="flex items-center gap-2 text-xs text-muted">
            <Spinner /> en vivo
          </span>
        )}
        {record?.status === "running" && (
          <button className="btn-danger ml-auto text-xs px-2 py-1" onClick={stop}>
            Detener
          </button>
        )}
      </div>

      {/* metadata */}
      {record && (
        <div className="card grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="label">Modo</div>
            {record.mode}
          </div>
          <div>
            <div className="label">Tracker</div>
            {record.tracker}
          </div>
          <div>
            <div className="label">Inicio</div>
            {fmtTime(record.startedAt)}
          </div>
          <div>
            <div className="label">Fin</div>
            {fmtTime(record.finishedAt)}
          </div>
          {record.featureId && (
            <div>
              <div className="label">Feature</div>#{record.featureId}
            </div>
          )}
          {record.appUrl && (
            <div className="col-span-2">
              <div className="label">URL</div>
              <span className="font-mono text-xs break-all">{record.appUrl}</span>
            </div>
          )}
          {record.repoRoot && (
            <div className="col-span-2 md:col-span-4">
              <div className="label">Código</div>
              <span className="font-mono text-xs break-all">{record.repoRoot}</span>
            </div>
          )}
        </div>
      )}

      {/* consola en vivo */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold text-sm">Registro de ejecución</h2>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={autoscroll} onChange={(e) => setAutoscroll(e.target.checked)} />
            Auto-scroll
          </label>
        </div>
        <div
          ref={logRef}
          className="h-[360px] overflow-y-auto rounded-lg bg-bg border border-border p-3 font-mono text-xs space-y-0.5"
        >
          {events.length === 0 && <div className="text-muted">Esperando eventos…</div>}
          {events.map((ev, i) => (
            <div key={i} className={LEVEL_COLOR[ev.level] || "text-gray-300"}>
              {ev.msg}
            </div>
          ))}
        </div>
      </div>

      {/* resultados */}
      {results.length > 0 && (
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-sm">Resultados</h2>
            <span className="text-xs text-muted">
              ✅ {counts.pass} · ❌ {counts.fail} · ⏭ {counts.skip}
            </span>
          </div>
          <div className="space-y-2">
            {results.map((r, i) => {
              const info = LAYER_INFO[r.layer] || { label: r.layer, desc: "" };
              const st = STATUS_TXT[r.status] || STATUS_TXT.skip;
              const cases = Array.isArray(r.cases) ? r.cases : [];
              const p = cases.filter((c: any) => c.status === "pass").length;
              const f = cases.filter((c: any) => c.status === "fail").length;
              const s = cases.length - p - f; // resto = saltados/pendientes (no ocultar)
              return (
                <div key={i} className="rounded-lg border border-border bg-panel2/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{info.label}</span>
                    <span className={`badge ${st.cls} text-[10px]`}>{st.label}</span>
                    {r.metrics?.tool && (
                      <span className="badge bg-panel2 text-muted text-[10px]">
                        {r.metrics.tool}
                        {r.metrics?.cwd ? ` · ${r.metrics.cwd}` : ""}
                      </span>
                    )}
                  </div>

                  {info.desc && <p className="text-[11px] text-muted">{info.desc}</p>}
                  <p className="text-sm">{statusSentence(r)}</p>

                  {r.metrics?.command && (
                    <div className="text-[11px]">
                      <span className="text-muted">Qué se ejecutó: </span>
                      <code className="break-all text-gray-200">{r.metrics.command}</code>
                    </div>
                  )}

                  <div className="text-[11px] text-muted flex gap-3 flex-wrap">
                    {typeof r.metrics?.exitCode === "number" && <span>código de salida: {r.metrics.exitCode}</span>}
                    {typeof r.metrics?.ms === "number" && <span>duración: {(r.metrics.ms / 1000).toFixed(1)} s</span>}
                    {cases.length > 0 && (
                      <span>
                        casos: {cases.length} ·{" "}
                        <span className="text-green-300">✓{p}</span>{" "}
                        <span className="text-red-300">✗{f}</span>{" "}
                        <span className="text-muted">⏭{s}</span>
                        {s > 0 ? <span className="text-muted"> (saltados/pendientes)</span> : null}
                      </span>
                    )}
                  </div>

                  {r.status === "skip" && r.narrative && (
                    <p className="text-[11px] text-warn">Motivo: {r.narrative}</p>
                  )}

                  {cases.length > 0 && (
                    <details className="mt-1">
                      <summary className="text-xs text-accent cursor-pointer">
                        Ver {cases.length} caso(s) ejecutado(s)
                      </summary>
                      <p className="text-[10px] text-muted mt-1">
                        Nombres y mensajes tal cual los emite la herramienta (pueden venir en inglés).
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {cases.map((c: any, j: number) => (
                          <li key={j} className="text-xs">
                            <span className={c.status === "pass" ? "text-green-300" : c.status === "fail" ? "text-red-300" : "text-muted"}>
                              {c.status === "pass" ? "✓" : c.status === "fail" ? "✕" : "•"}
                            </span>{" "}
                            {c.name}
                            {typeof c.duration === "number" ? <span className="text-muted"> ({c.duration} ms)</span> : null}
                            {c.message ? <span className="text-muted"> — {String(c.message).split(/\r?\n/)[0]}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>

          {report?.htmlPath && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <a className="btn-ghost px-2 py-1" href={artifact(report.htmlPath)} target="_blank" rel="noreferrer">
                📄 Ver reporte (HTML)
              </a>
              {report.mdPath && (
                <a className="text-muted hover:text-white underline" href={artifact(report.mdPath)} target="_blank" rel="noreferrer">
                  ver .md
                </a>
              )}
            </div>
          )}

          {shots.length > 0 && (
            <div className="space-y-2">
              <div className="label">Capturas</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {shots.map((s, i) => (
                  <a key={i} href={artifact(s)} target="_blank" rel="noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={artifact(s)}
                      alt={`captura ${i + 1}`}
                      className="rounded-lg border border-border w-full h-auto"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(summary?.novelties) && summary.novelties.length > 0 && (
            <div className="text-sm">
              <div className="label">Novedades</div>
              <ul className="space-y-0.5">
                {summary.novelties.map((n: any, i: number) => (
                  <li key={i} className="text-xs">
                    HU #{n.work_item_id}: Bug {n.bugId || "(error)"} · {n.fails} fallo(s)
                    {n.reactivation?.state ? ` · reactivada (${n.reactivation.state})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {testPlan && (testPlan.planId || testPlan.error) && (
        <div className="card space-y-1">
          <h2 className="font-semibold text-sm">Plan de Pruebas del Feature</h2>
          {testPlan.planId ? (
            <p className="text-sm text-green-300">
              ✓ Task del plan <span className="font-mono">#{testPlan.planId}</span>{" "}
              <span className="text-muted text-xs">
                {testPlan.created ? "creada" : "actualizada"} bajo el Feature (objetivo + HUs/TC + alcance global).
              </span>
            </p>
          ) : (
            <p className="text-sm text-warn">⚠ No se pudo registrar el plan: {testPlan.error}</p>
          )}
        </div>
      )}

      {huEvidence.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Evidencia por HU</h2>
          <p className="text-xs text-muted">
            Además del resumen en el Feature, cada HU seleccionada recibió su comentario de
            ejecución y su <b>TC</b> (Task creado/actualizado desde sus criterios de aceptación).
          </p>
          <ul className="space-y-1 text-sm">
            {huEvidence.map((h) => {
              const okAll = h.ok !== false && h.commentOk !== false && !h.error;
              return (
                <li key={h.work_item_id} className="flex flex-wrap items-center gap-2">
                  <span className={okAll ? "text-green-300" : "text-warn"}>{okAll ? "✓" : "⚠"}</span>
                  <span className="font-mono">HU #{h.work_item_id}</span>
                  <span className="text-muted text-xs">
                    {Array.isArray(h.tcs) && h.tcs.length ? (
                      <>{h.tcs.filter((t: any) => t.tcId).length}/{h.tcs.length} TC por criterio</>
                    ) : h.tcId ? (
                      <>TC #{h.tcId} {h.tcCreated ? "creado" : "reusado"}</>
                    ) : (
                      <>sin TC{h.tcError ? ` (${h.tcError})` : ""}</>
                    )}
                    {h.commentOk === false ? " · comentario falló" : h.commentId ? " · comentario publicado" : ""}
                    {h.error ? ` · ${h.error}` : ""}
                    {h.skipped ? ` · ${h.skipped}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showCoverage && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Cobertura de HUs seleccionadas</h2>
          {totalCases === 0 ? (
            <p className="text-xs text-muted">
              No se detectaron casos individuales (la herramienta no expone reporte JSON), así que
              no se puede evaluar la cobertura por etiqueta <code>[HU-###]</code>.
            </p>
          ) : (
            <>
              <ul className="space-y-1 text-sm">
                {selectedHus.map((id) => {
                  const n = coverageCount[id] || 0;
                  return (
                    <li key={id} className="flex items-center gap-2">
                      <span className={n > 0 ? "text-green-300" : "text-warn"}>{n > 0 ? "✓" : "⚠"}</span>
                      <span className="font-mono">#{id}</span>
                      <span className="text-muted text-xs">
                        {n > 0 ? `${n} prueba(s) etiquetada(s)` : `sin pruebas etiquetadas [HU-${id}]`}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {gaps.length > 0 && (
                <p className="text-xs text-warn">
                  ⚠ {gaps.length} HU(s) sin <b>pruebas asociadas a un criterio</b>. Cada HU igual
                  recibió su comentario de ejecución y su TC (ver «Evidencia por HU»); esto solo
                  indica que aún ninguna prueba está etiquetada <code>[HU-###]</code> para validar
                  sus criterios individualmente.
                </p>
              )}
              {extra.length > 0 && (
                <p className="text-xs text-muted">
                  Pruebas que etiquetan HUs no seleccionadas: {extra.map((h) => "#" + h).join(", ")}.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {record?.error && (
        <div className="card text-sm text-red-300">Error: {record.error}</div>
      )}
    </div>
  );
}
