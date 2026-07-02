import { LAYER_INFO, STATUS_TXT, statusSentence, artifactUrl } from "./helpers";

/** Tarjeta de resultados: estado, casos, reporte y capturas de la exploración. */
export function RunResults({
  results,
  report,
  shots,
}: {
  results: any[];
  report: any;
  shots: string[];
}) {
  if (results.length === 0) return null;
  const counts = {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length,
  };
  return (
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
                    casos: {cases.length} · <span className="text-green-300">✓{p}</span>{" "}
                    <span className="text-red-300">✗{f}</span> <span className="text-muted">⏭{s}</span>
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
          <a className="btn-ghost px-2 py-1" href={artifactUrl(report.htmlPath)} target="_blank" rel="noreferrer">
            📄 Ver reporte (HTML)
          </a>
          {report.mdPath && (
            <a className="text-muted hover:text-white underline" href={artifactUrl(report.mdPath)} target="_blank" rel="noreferrer">
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
              <a key={i} href={artifactUrl(s)} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={artifactUrl(s)} alt={`captura ${i + 1}`} className="rounded-lg border border-border w-full h-auto" />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
