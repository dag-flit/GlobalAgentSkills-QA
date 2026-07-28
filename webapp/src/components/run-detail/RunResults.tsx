import { LAYER_INFO, STATUS_TXT, layerNarrative, artifactUrl, friendlyFile } from "./helpers";
import { CaseList } from "./CaseList";
import { explainLayerFailure } from "./failureExplain";

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
  // Distingue CAPAS (objetivos) de PRUEBAS (casos): antes se veía "5 fallos" (capas) y "7 hallazgos"
  // (pruebas) sin aclarar que miden cosas distintas. Las advertencias del linter van como sugerencias.
  const allCases = results.flatMap((r: any) => (Array.isArray(r.cases) ? r.cases : []));
  const caseP = allCases.filter((c: any) => c.status === "pass").length;
  const caseF = allCases.filter((c: any) => c.status === "fail").length;
  // Sugerencias = advertencias del linter (static skip) + hallazgos NO bloqueantes detectados
  // (kind:"suggestion" — SCA media/baja, licencias). Se cuentan juntas para que coincida con el
  // reporte md/html/HU y para que las vulns medias no se lean como pruebas saltadas.
  const lintWarn = results
    .filter((r) => r.layer === "static")
    .flatMap((r: any) => (Array.isArray(r.cases) ? r.cases : []))
    .filter((c: any) => c.status === "skip").length;
  const secSugg = allCases.filter((c: any) => c.status === "skip" && c.kind === "suggestion").length;
  const warn = lintWarn + secSugg;
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-semibold text-sm">Resultados</h2>
        <span className="text-xs text-muted">
          Capas: <span className="text-green-300">✅ {counts.pass}</span> · <span className="text-red-300">❌ {counts.fail}</span> · ⏭ {counts.skip}
        </span>
        <span className="text-xs text-muted">
          Pruebas: <span className="text-green-300">✅ {caseP}</span> · <span className="text-red-300">❌ {caseF}</span>
        </span>
        {warn > 0 && <span className="text-xs text-amber-300">💡 {warn} sugerencia(s)</span>}
      </div>
      <p className="text-[11px] text-muted -mt-1">
        Una <b>capa</b> es un objetivo (p. ej. un proyecto de test); una <b>prueba</b> es un caso dentro de la capa.
      </p>
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
                {/* Objetivo puntual (proyecto de test .NET, sonda de BD…): cada tarjeta = un comando. */}
                {r.metrics?.label && (
                  <span className="badge bg-accent/15 text-accent text-[10px] font-medium">🎯 {r.metrics.label}</span>
                )}
                <span className={`badge ${st.cls} text-[10px]`}>{st.label}</span>
                {r.metrics?.tool && (
                  <span className="badge bg-panel2 text-muted text-[10px]">
                    {r.metrics.tool}
                    {!r.metrics?.label && r.metrics?.cwd ? ` · ${r.metrics.cwd}` : ""}
                  </span>
                )}
              </div>

              {(() => {
                const n = layerNarrative(r);
                return (
                  <>
                    {n.what && (
                      <p className="text-[11px] text-muted">
                        <span className="font-medium text-gray-300">Qué hace:</span> {n.what}
                      </p>
                    )}
                    <p className="text-sm">
                      <span className="text-[11px] text-muted">Resultado: </span>
                      {n.result}
                    </p>
                  </>
                );
              })()}

              {r.metrics?.command && (
                <div className="text-[11px]">
                  <span className="font-medium text-gray-300">Comando: </span>
                  <code className="break-all text-gray-200">{r.metrics.command}</code>
                </div>
              )}

              <div className="text-[11px] text-muted flex gap-3 flex-wrap">
                {typeof r.metrics?.exitCode === "number" && <span>código de salida: {r.metrics.exitCode}</span>}
                {typeof r.metrics?.ms === "number" && <span>duración: {(r.metrics.ms / 1000).toFixed(1)} s</span>}
                {cases.length > 0 && (
                  <span>
                    casos: {cases.length} · <span className="text-green-300">✓{p}</span>{" "}
                    <span className="text-red-300">✗{f}</span>{" "}
                    <span className={r.layer === "static" ? "text-amber-300" : "text-muted"}>
                      {r.layer === "static" ? "⚠" : "⏭"}{s}
                    </span>
                    {s > 0 ? (
                      <span className="text-muted"> ({r.layer === "static" ? "advertencias, no bloquean" : "saltados/pendientes"})</span>
                    ) : null}
                  </span>
                )}
              </div>

              {r.status === "skip" && r.narrative && (
                <p className="text-[11px] text-warn">Motivo: {r.narrative}</p>
              )}

              {/* Capa con FALLO sin desglose por caso (p.ej. dotnet-test/tsc): misma claridad
                  🧩/👉 que los casos, a nivel de capa. Si hay casos fallidos, cada uno ya lo trae. */}
              {r.status === "fail" && f === 0 && (() => {
                const ex = explainLayerFailure(r);
                if (!ex) return null;
                return (
                  <div className="rounded border border-amber-900/40 bg-amber-950/20 px-2 py-1 space-y-0.5">
                    <div className="text-[11px] text-amber-100/90">
                      <span className="font-semibold">🧩 Qué pasó: </span>{ex.plain}
                    </div>
                    {ex.action && (
                      <div className="text-[11px] text-emerald-200/90">
                        <span className="font-semibold">👉 Qué hacer: </span>{ex.action}
                      </div>
                    )}
                    {r.blame ? (
                      <div className="text-[11px] text-sky-200/80">
                        <span className="font-semibold">👤 Último en modificar </span>
                        {friendlyFile(r.blame.file)}{" "}
                        <code className="break-all">{r.blame.line ? `${String(r.blame.file).replace(/\\/g, "/")}:${r.blame.line}` : String(r.blame.file).replace(/\\/g, "/")}</code>
                        {": "}{r.blame.author}{r.blame.date ? ` (${r.blame.date})` : ""}
                      </div>
                    ) : (
                      <div className="text-[11px] text-muted">
                        👤 Sin responsable: la herramienta no dejó un archivo/línea en el error, así que no hay a quién atribuirlo automáticamente.
                      </div>
                    )}
                    {r.narrative && (
                      <details className="mt-0.5">
                        <summary className="text-[10px] text-muted cursor-pointer">Detalle técnico</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-red-300/90 bg-black/30 rounded px-2 py-1 border border-red-900/40 max-h-40 overflow-auto">
                          {String(r.narrative)}
                        </pre>
                      </details>
                    )}
                  </div>
                );
              })()}

              {cases.length > 0 && (
                <details className="mt-1" open={f > 0 || (s > 0 && (r.layer === "static" || r.layer === "security"))}>
                  <summary className="text-xs text-accent cursor-pointer">
                    Ver {cases.length} caso(s){f > 0 ? ` · ${f} en rojo primero` : r.layer === "static" && s > 0 ? ` · ${s} advertencia(s)` : ""}
                  </summary>
                  <p className="text-[10px] text-muted mt-1">
                    Agrupados por suite, con los fallos primero. Nombres y mensajes tal cual los emite
                    la herramienta (pueden venir en inglés).
                  </p>
                  <CaseList cases={cases} layer={r.layer} tool={r.metrics?.tool} />
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
