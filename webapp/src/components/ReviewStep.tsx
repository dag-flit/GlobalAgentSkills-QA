"use client";

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { useAction } from "@/components/ActionFeedback";

interface TcPreview {
  key: string;
  acIndex: number;
  criterion: string;
  title: string;
  summary: string;
  code: string | null;
  supported: boolean;
  reason: string | null;
  framework: string | null;
  source?: "ai" | "skeleton";
  aiError?: string;
}
interface AiInfo {
  enabled: boolean;
  provider?: string;
  model?: string;
}
interface HuPreview {
  huId: string;
  huTitle?: string;
  criteria: string[];
  tcs: TcPreview[];
}

/** Clave compuesta (HU, criterio): la clave TC-AC<n> se repite entre HUs. */
const compositeKey = (huId: string, tcKey: string) => `${huId}:${tcKey}`;

export function ReviewStep({
  huIds,
  featureId,
  repoRoot,
  unitTool,
  onBack,
  onContinue,
}: {
  huIds: string[];
  featureId?: string;
  repoRoot?: string | null;
  unitTool?: string | null;
  /** approvedKeys = ["<huId>:<TC-AC#>", …]; generate = approvedKeys.length > 0 */
  onContinue: (approvedKeys: string[], generate: boolean) => void;
  onBack: () => void;
}) {
  const action = useAction();
  const [planPublished, setPlanPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<HuPreview[]>([]);
  const [aiInfo, setAiInfo] = useState<AiInfo | null>(null);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [openCode, setOpenCode] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch("/api/generate/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ huIds, unitTool }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          setError(res.error || "No se pudieron generar las previsualizaciones.");
          return;
        }
        const pv: HuPreview[] = res.previews || [];
        setPreviews(pv);
        setAiInfo(res.ai || { enabled: false });
        // por defecto se aprueban los TC soportados (los no soportados no se pueden ejecutar)
        const def: Record<string, boolean> = {};
        for (const hu of pv) for (const tc of hu.tcs) if (tc.supported) def[compositeKey(hu.huId, tc.key)] = true;
        setApproved(def);
      })
      .catch((e) => alive && setError(e?.message ?? "Error de red"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [huIds, unitTool]);

  const { totalSupported, totalApproved } = useMemo(() => {
    let sup = 0;
    let app = 0;
    for (const hu of previews)
      for (const tc of hu.tcs)
        if (tc.supported) {
          sup++;
          if (approved[compositeKey(hu.huId, tc.key)]) app++;
        }
    return { totalSupported: sup, totalApproved: app };
  }, [previews, approved]);

  const approvedKeys = useMemo(
    () => Object.entries(approved).filter(([, v]) => v).map(([k]) => k),
    [approved]
  );

  function setAll(value: boolean) {
    const next: Record<string, boolean> = {};
    for (const hu of previews) for (const tc of hu.tcs) if (tc.supported) next[compositeKey(hu.huId, tc.key)] = value;
    setApproved(next);
  }

  // Publica el Plan + TC en el tracker SIN ejecutar (paso de planificación, antes de la corrida).
  async function publishPlan() {
    await action
      .run(
        { loading: "Publicando el plan en el tracker…", success: (m) => String(m) },
        async () => {
          const r = await fetch("/api/plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "code",
              repoRoot: repoRoot || undefined,
              featureId,
              huIds,
              generate: approvedKeys.length > 0,
              approvedTcKeys: approvedKeys.length ? approvedKeys : undefined,
            }),
          });
          const res = await r.json();
          if (!r.ok || !res.ok) throw new Error(res.error || "No se pudo publicar el plan.");
          setPlanPublished(true);
          const tp = res.summary?.testPlan;
          const planId = tp?.planId ? ` (Task #${tp.planId})` : "";
          return `Plan publicado en el Feature${planId}. Ya puedes verlo en el tracker antes de ejecutar.`;
        }
      )
      .catch(() => {});
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> Entendiendo los criterios y generando las pruebas para revisión…
      </div>
    );
  }

  const noCriteria = previews.length > 0 && previews.every((h) => h.criteria.length === 0);

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <h2 className="font-semibold">Revisión de pruebas generadas</h2>
        <p className="text-sm text-muted">
          A partir de los <b>criterios de cada HU</b> preparé una prueba por criterio. Revisa en
          lenguaje claro <b>qué valida cada una</b> y decide cuáles ejecutar. Solo lo que apruebes
          se genera como código (etiquetado por HU), se ejecuta y crea su TC en el tracker.
        </p>
        {aiInfo &&
          (aiInfo.enabled ? (
            <div className="text-xs rounded-lg px-3 py-2 border border-accent/40 bg-accent/10 text-accent">
              ✨ Tests escritos por IA ({aiInfo.provider}
              {aiInfo.model ? ` · ${aiInfo.model}` : ""}). Son <b>borradores reales</b> que se
              ejecutan; revísalos antes de aprobar.
            </div>
          ) : (
            <div className="text-xs rounded-lg px-3 py-2 border border-border bg-panel2/40 text-muted">
              Modo <b>esqueleto</b> (sin IA): las pruebas salen como «pendiente». Configura un
              proveedor de IA en <b>Ajustes → Generación con IA</b> para que escriba el código real.
            </div>
          ))}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted">
            {totalApproved} de {totalSupported} prueba(s) aprobada(s)
          </span>
          <button className="underline text-muted hover:text-white" onClick={() => setAll(true)}>
            Aprobar todas
          </button>
          <button className="underline text-muted hover:text-white" onClick={() => setAll(false)}>
            Ninguna
          </button>
        </div>
      </div>

      {error && (
        <div className="card text-sm text-red-300 border border-red-700 bg-red-900/30">{error}</div>
      )}

      {noCriteria && (
        <div className="card text-sm text-amber-200 border border-warn/50 bg-amber-900/20">
          Las HUs seleccionadas no declaran criterios de aceptación en el tracker, así que no hay
          pruebas que generar. Puedes continuar: se ejecutará la corrida general y se dejará el plan
          en el Feature.
        </div>
      )}

      {previews.map((hu) => (
        <div key={hu.huId} className="card space-y-3">
          <h3 className="text-sm font-semibold">
            <span className="font-mono text-muted">HU #{hu.huId}</span> {hu.huTitle || ""}
          </h3>
          {hu.tcs.length === 0 ? (
            <p className="text-xs text-muted">Sin criterios de aceptación declarados.</p>
          ) : (
            <ul className="space-y-2">
              {hu.tcs.map((tc) => {
                const ck = compositeKey(hu.huId, tc.key);
                const codeOpen = !!openCode[ck];
                return (
                  <li key={ck} className="rounded-lg border border-border bg-panel2/30 p-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1"
                        disabled={!tc.supported}
                        checked={!!approved[ck]}
                        onChange={(e) => setApproved((s) => ({ ...s, [ck]: e.target.checked }))}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm">{tc.title}</span>
                          {tc.source === "ai" ? (
                            <span className="badge bg-accent/15 text-accent text-[10px]">✨ IA</span>
                          ) : (
                            <span className="badge bg-panel2 text-muted text-[10px]">esqueleto · pendiente</span>
                          )}
                          {!tc.supported && (
                            <span className="badge bg-amber-900 text-amber-300 text-[10px]">no generable aún</span>
                          )}
                        </div>
                        <p className="text-[13px] text-gray-300 mt-1">{tc.summary}</p>
                        {!tc.supported && tc.reason && (
                          <p className="text-[11px] text-warn mt-1">⚠ {tc.reason}</p>
                        )}
                        {tc.aiError && (
                          <p className="text-[11px] text-warn mt-1">⚠ La IA falló, se usó el esqueleto: {tc.aiError}</p>
                        )}
                        {tc.code && (
                          <div className="mt-1">
                            <button
                              className="text-[11px] text-accent hover:underline"
                              onClick={() => setOpenCode((s) => ({ ...s, [ck]: !codeOpen }))}
                            >
                              {codeOpen ? "▾ ocultar código" : "▸ ver código"}
                            </button>
                            {codeOpen && (
                              <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-black/40 p-2 text-[11px] text-gray-300 font-mono whitespace-pre">
                                {tc.code}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost" onClick={onBack}>
          ← Atrás
        </button>
        {featureId && (
          <button className="btn-ghost" onClick={publishPlan}>
            {planPublished ? "✓ Plan publicado — republicar" : "📋 Publicar plan en el tracker"}
          </button>
        )}
        <button className="btn-primary" onClick={() => onContinue(approvedKeys, approvedKeys.length > 0)}>
          {approvedKeys.length > 0 ? `Ejecutar con ${approvedKeys.length} prueba(s) →` : "Continuar sin generar →"}
        </button>
        {featureId && !planPublished && (
          <span className="text-xs text-muted">
            Opcional: publica el plan ahora para verlo en el Feature antes de ejecutar.
          </span>
        )}
      </div>
    </div>
  );
}
