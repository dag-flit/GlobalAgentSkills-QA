// CaseList — lista desglosada de casos (TC) de una capa de QA del código. Agrupa por suite/archivo,
// muestra los FALLOS primero (grupo y caso), separa el breadcrumb de la ruta del nombre del test y
// expande el mensaje de error. Cada fallo trae una explicación en lenguaje LLANO (qué pasó / qué
// hacer) para no técnicos; el texto crudo de la herramienta queda como "detalle técnico".

import { explainFailure } from "./failureExplain";

interface Blame { author: string; email?: string | null; date?: string | null; file: string; line?: number | null }
interface Case { name: string; status: string; duration?: number | null; message?: string | null; blame?: Blame | null }

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
                return (
                  <li key={i} className={`px-2 py-1.5 text-xs ${c.status === "fail" ? "bg-red-950/20" : ""}`}>
                    <div className="flex items-start gap-2">
                      {/* En static, un caso "skip" es una ADVERTENCIA del linter (no un test saltado). */}
              {(() => {
                const warn = layer === "static" && c.status === "skip";
                const icon = warn ? "⚠" : ICON[c.status] ?? "•";
                const color = warn ? "text-amber-300" : COLOR[c.status] ?? "text-muted";
                return <span className={`${color} mt-0.5`} title={warn ? "advertencia" : c.status}>{icon}</span>;
              })()}
                      <div className="min-w-0">
                        {trail.length > 0 && (
                          <div className="text-[10px] text-muted break-all">{trail.join(" › ")}</div>
                        )}
                        <div className="text-gray-100 break-words">
                          {test}
                          {typeof c.duration === "number" ? <span className="text-muted"> · {c.duration} ms</span> : null}
                        </div>
                        {c.status === "fail" && (() => {
                          const ex = explainFailure(c, { layer, tool });
                          return (
                            <>
                              <div className="mt-1 rounded border border-amber-900/40 bg-amber-950/20 px-2 py-1 space-y-0.5">
                                {ex && (
                                  <div className="text-[11px] text-amber-100/90">
                                    <span className="font-semibold">🧩 Qué pasó: </span>{ex.plain}
                                  </div>
                                )}
                                {ex?.action && (
                                  <div className="text-[11px] text-emerald-200/90">
                                    <span className="font-semibold">👉 Qué hacer: </span>{ex.action}
                                  </div>
                                )}
                                {c.blame ? (
                                  <div className="text-[11px] text-sky-200/80">
                                    <span className="font-semibold">👤 Último en modificar </span>
                                    <code className="break-all">{c.blame.line ? `${c.blame.file}:${c.blame.line}` : c.blame.file}</code>
                                    {": "}{c.blame.author}{c.blame.date ? ` (${c.blame.date})` : ""}
                                  </div>
                                ) : (
                                  <div className="text-[11px] text-muted">
                                    👤 Sin responsable: el error no señala un archivo/línea del repo, así que no hay a quién atribuirlo automáticamente.
                                  </div>
                                )}
                              </div>
                              {c.message && (
                                <details className="mt-1">
                                  <summary className="text-[10px] text-muted cursor-pointer">Detalle técnico</summary>
                                  <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-red-300/90 bg-black/30 rounded px-2 py-1 border border-red-900/40 max-h-40 overflow-auto">
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
