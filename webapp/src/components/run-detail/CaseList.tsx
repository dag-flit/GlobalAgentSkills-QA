// CaseList — lista desglosada de casos (TC) de una capa de QA del código. Agrupa por suite/archivo,
// muestra los FALLOS primero (grupo y caso), separa el breadcrumb de la ruta del nombre del test y
// expande el mensaje de error. Cada fallo trae una explicación en lenguaje LLANO (qué pasó / qué
// hacer) para no técnicos; el texto crudo de la herramienta queda como "detalle técnico".

import { explainFailure, explainLabels } from "./failureExplain";
import { lintRuleHelp, friendlyFile, groupLintWarnings } from "./helpers";

interface Blame { author: string; email?: string | null; date?: string | null; file: string; line?: number | null }
// `plain`/`action`: explicación que emite el propio check (los declarativos de BD la traen). Si está,
// se muestra SIEMPRE — pase, falle u omita — igual que en el reporte md/html y en la HU.
interface Case { name: string; status: string; duration?: number | null; message?: string | null; blame?: Blame | null; plain?: string | null; action?: string | null; kind?: string | null }

// Deriva { group, trail, test } del nombre de un caso, según cómo lo nombra cada herramienta:
//  • unit (vitest/jest): "Suite › subsuite › test" → agrupa por la suite (primer segmento).
//  • static/security (eslint/semgrep/bandit): el nombre incluye "archivo.ext:línea" → agrupa por
//    el ARCHIVO, así los hallazgos quedan ordenados por dónde están.
function splitName(name: string): { group: string; trail: string[]; test: string } {
  const raw = (String(name || "").trim()) || "(caso)";
  if (raw.includes(" › ")) {
    const parts = raw.split(" › ").map((s) => s.trim()).filter(Boolean);
    if (parts.length <= 1) return { group: "(sin grupo)", trail: [], test: parts[0] || raw };
    return { group: parts[0], trail: parts.slice(1, -1), test: parts[parts.length - 1] };
  }
  // Agrupar por archivo si el nombre trae "ruta/archivo.ext:línea" (linter/escáner).
  const m = raw.match(/([\w./\\-]+\.[A-Za-z0-9]+):\d+/);
  if (m) return { group: m[1], trail: [], test: raw };
  return { group: "(sin grupo)", trail: [], test: raw };
}

const RANK: Record<string, number> = { fail: 0, pass: 1, skip: 2 };
const ICON: Record<string, string> = { pass: "✓", fail: "✕", skip: "•" };
const COLOR: Record<string, string> = { pass: "text-green-300", fail: "text-red-300", skip: "text-muted" };

export function CaseList({ cases, layer, tool }: { cases: Case[]; layer?: string; tool?: string }) {
  // Capa ESTÁTICA: las advertencias del linter se agrupan por REGLA (explicación UNA vez) con el nombre
  // AMIGABLE del componente/archivo + la ruta EXACTA (para que un agente pueda localizar y corregir).
  if (layer === "static" && cases.some((c) => c.status === "skip")) {
    const groups = groupLintWarnings(cases);
    const fails = cases.filter((c) => c.status === "fail").length;
    return (
      <div className="space-y-2 mt-2">
        {groups.map((g, i) => (
          <div key={i} className="rounded-md border border-amber-900/30 bg-amber-950/10 overflow-hidden">
            <div className="px-2 py-1 text-xs flex items-center gap-2 flex-wrap">
              <span className="text-amber-300">⚠</span>
              <span className="font-mono font-semibold text-amber-200 break-all">{g.rule}</span>
              <span className="ml-auto text-[10px] text-muted whitespace-nowrap">{g.occ.length} uso(s) · {g.files} archivo(s)</span>
            </div>
            {g.help && (
              <div className="px-2 pb-1 text-[11px] text-amber-100/90">
                <span className="font-semibold">📖 Qué significa: </span>{g.help}
              </div>
            )}
            <ul className="divide-y divide-border/40">
              {g.occ.map((o, j) => (
                <li key={j} className="px-2 py-1 text-[11px]">
                  <span className="text-gray-100">{o.friendly}{o.line ? ` · línea ${o.line}` : ""}</span>
                  {" — "}
                  <code className="text-muted break-all">{o.raw}</code>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {fails > 0 && <p className="text-[11px] text-muted">Además hay {fails} error(es) del linter (esos sí bloquean) — ver el detalle en el reporte.</p>}
      </div>
    );
  }
  // Agrupa por suite (primer segmento del nombre).
  const groups = new Map<string, Case[]>();
  for (const c of cases) {
    const { group } = splitName(c.name);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(c);
  }
  // Grupos con fallos primero; dentro de cada uno, el mismo orden (fallo → pass → skip).
  const ordered = [...groups.entries()].sort((a, b) => {
    const fa = a[1].some((c) => c.status === "fail") ? 0 : 1;
    const fb = b[1].some((c) => c.status === "fail") ? 0 : 1;
    return fa - fb || a[0].localeCompare(b[0]);
  });

  return (
    <div className="space-y-3 mt-2">
      {ordered.map(([group, items], gi) => {
        const p = items.filter((c) => c.status === "pass").length;
        const f = items.filter((c) => c.status === "fail").length;
        const s = items.length - p - f;
        const sorted = [...items].sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3));
        return (
          <div key={gi} className="rounded-md border border-border/60 overflow-hidden">
            <div className="flex items-center gap-2 px-2 py-1 bg-panel2/40 text-xs">
              <span className="font-semibold text-gray-200 break-all">{group}</span>
              <span className="ml-auto text-[10px] whitespace-nowrap">
                <span className="text-green-300">✓{p}</span>{" "}
                <span className={f ? "text-red-300 font-semibold" : "text-muted"}>✗{f}</span>{" "}
                <span className="text-muted">⏭{s}</span>
              </span>
            </div>
            <ul className="divide-y divide-border/40">
              {sorted.map((c, i) => {
                const { trail, test } = splitName(c.name);
                // En static, un caso "skip" es una ADVERTENCIA del linter (no un test saltado).
                const warn = layer === "static" && c.status === "skip";
                // Un skip marcado kind:"suggestion" (SCA media/baja, licencias) es una SUGERENCIA
                // detectada, no una prueba saltada → 💡 ámbar, para que no se lea como "omitida".
                const suggestion = c.status === "skip" && c.kind === "suggestion";
                // Regla de lint (eslint/ruff): separa ubicación + regla y traduce qué significa.
                const lr = layer === "static" ? lintRuleHelp(c.name) : null;
                const icon = warn ? "⚠" : suggestion ? "💡" : ICON[c.status] ?? "•";
                const iconColor = warn || suggestion ? "text-amber-300" : COLOR[c.status] ?? "text-muted";
                return (
                  <li key={i} className={`px-2 py-1.5 text-xs ${c.status === "fail" ? "bg-red-950/20" : warn || suggestion ? "bg-amber-950/10" : ""}`}>
                    <div className="flex items-start gap-2">
                      <span className={`${iconColor} mt-0.5`} title={warn ? "advertencia" : c.status}>{icon}</span>
                      <div className="min-w-0">
                        {trail.length > 0 && (
                          <div className="text-[10px] text-muted break-all">{trail.join(" › ")}</div>
                        )}
                        <div className="text-gray-100 break-words">
                          {lr ? (
                            <>
                              <span className="badge bg-amber-900/40 text-amber-200 text-[10px] mr-1 font-mono break-all">{lr.rule}</span>
                              <span className="text-muted break-all">{lr.location}</span>
                            </>
                          ) : (
                            test
                          )}
                          {typeof c.duration === "number" ? <span className="text-muted"> · {c.duration} ms</span> : null}
                        </div>
                        {/* Advertencia de linter DESCRIPTIVA: qué significa la regla + el mensaje del linter. */}
                        {warn && lr && (
                          <div className="mt-1 rounded border border-amber-900/30 bg-amber-950/10 px-2 py-1">
                            <div className="text-[11px] text-amber-100/90">
                              <span className="font-semibold">📖 Qué significa: </span>{lr.help}
                            </div>
                          </div>
                        )}
                        {/* Explicación: los rojos siempre; el resto solo si el check trae la suya
                            (`plain`) — misma regla que el reporte md/html y la HU. */}
                        {(c.status === "fail" || c.plain) && (() => {
                          const ex = explainFailure(c, { layer, tool });
                          const L = explainLabels(c.status);
                          // La atribución por git-blame solo aplica a fallos, y no a hallazgos de esquema
                          // (db/api) ni de seguridad (una dependencia vulnerable o un secreto no son una
                          // línea "de autor"). Coherente con la HU y el reporte md/html (NO_BLAME_LAYERS).
                          const showNoBlame = c.status === "fail" && !c.blame && layer !== "db" && layer !== "api" && layer !== "security";
                          // Sin explicación NI responsable la caja quedaría VACÍA y se vería como una
                          // raya de borde suelta: en ese caso no se dibuja.
                          const hasBox = Boolean(ex) || Boolean(c.blame) || showNoBlame;
                          const tone =
                            c.status === "fail" ? "border-amber-900/40 bg-amber-950/20"
                            : c.status === "pass" ? "border-emerald-900/40 bg-emerald-950/20"
                            : "border-border bg-panel2/40";
                          return (
                            <>
                              {hasBox && (
                              <div className={`mt-1 rounded border ${tone} px-2 py-1 space-y-0.5`}>
                                {ex && (
                                  <div className="text-[11px] text-gray-200">
                                    <span className="font-semibold">{L.plain}: </span>{ex.plain}
                                  </div>
                                )}
                                {ex?.action && (
                                  <div className="text-[11px] text-emerald-200/90">
                                    <span className="font-semibold">{L.action}: </span>{ex.action}
                                  </div>
                                )}
                                {c.blame ? (
                                  <div className="text-[11px] text-sky-200/80">
                                    <span className="font-semibold">👤 Último en modificar </span>
                                    {friendlyFile(c.blame.file)}{" "}
                                    <code className="break-all">{c.blame.line ? `${String(c.blame.file).replace(/\\/g, "/")}:${c.blame.line}` : String(c.blame.file).replace(/\\/g, "/")}</code>
                                    {": "}{c.blame.author}{c.blame.date ? ` (${c.blame.date})` : ""}
                                  </div>
                                ) : showNoBlame ? (
                                  <div className="text-[11px] text-muted">
                                    👤 Sin responsable: el error no señala un archivo/línea del repo, así que no hay a quién atribuirlo automáticamente.
                                  </div>
                                ) : null}
                              </div>
                              )}
                              {c.message && (
                                <details className="mt-1">
                                  <summary className="text-[10px] text-muted cursor-pointer">Detalle técnico</summary>
                                  <pre className={`mt-1 whitespace-pre-wrap break-words text-[10px] bg-black/30 rounded px-2 py-1 border max-h-40 overflow-auto ${c.status === "fail" ? "text-red-300/90 border-red-900/40" : "text-gray-400 border-border"}`}>
                                    {String(c.message).split(/\r?\n/).slice(0, 8).join("\n")}
                                  </pre>
                                </details>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
