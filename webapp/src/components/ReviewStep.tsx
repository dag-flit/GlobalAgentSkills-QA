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
  kind?: "gherkin";
}
interface HuPreview {
  huId: string;
  huTitle?: string;
  criteria: string[];
  tcs: TcPreview[];
}
interface TemplateParam {
  name: string;
  default?: string;
  required: boolean;
}
interface TemplateDef {
  id: string;
  params: TemplateParam[];
}
interface TemplateCase {
  template: string;
  params: Record<string, string>;
  huId: string;
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
  onContinue: (approvedKeys: string[], generate: boolean, templateCases: TemplateCase[]) => void;
  onBack: () => void;
}) {
  // Esta versión usa SOLO la Ruta B (BDD ejecutable). La generación con IA se removió de la UX.
  const action = useAction();
  const [planPublished, setPlanPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<HuPreview[]>([]);
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [openCode, setOpenCode] = useState<Record<string, boolean>>({});
  // Casos adicionales (plantillas) — TC extra bajo la HU elegida
  const [catalog, setCatalog] = useState<TemplateDef[]>([]);
  const [tcases, setTcases] = useState<TemplateCase[]>([]);
  const [selTpl, setSelTpl] = useState("");
  const [tplParams, setTplParams] = useState<Record<string, string>>({});
  const [tplHu, setTplHu] = useState<string>(huIds[0] || "");

  useEffect(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((res) => { if (res.ok) setCatalog(res.templates || []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch("/api/generate/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ huIds, unitTool, repoRoot: repoRoot || undefined }),
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
  }, [huIds, unitTool, repoRoot]);

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

  const curTplParams: TemplateParam[] = catalog.find((t) => t.id === selTpl)?.params || [];
  const canAdd = !!selTpl && !!tplHu && curTplParams.filter((p) => p.required).every((p) => (tplParams[p.name] || "").trim());
  function addCase() {
    if (!canAdd) return;
    setTcases((cs) => [...cs, { template: selTpl, params: { ...tplParams }, huId: tplHu }]);
    setSelTpl("");
    setTplParams({});
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
              templateCases: tcases.length ? tcases : undefined,
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
          A partir de los <b>criterios de cada HU</b> preparé una <b>especificación ejecutable</b>{" "}
          (Gherkin): el criterio <b>es</b> la prueba. Revisa el escenario en lenguaje claro y decide
          cuáles ejecutar. Determinista, sin alucinación — el AC se ejecuta tal cual.
        </p>
        <div className="text-xs rounded-lg px-3 py-2 border border-accent/40 bg-accent/10 text-accent">
          📋 <b>BDD ejecutable</b> (Cucumber). Trazable: cada Scenario = un AC. El kit trae el runtime
          si el proyecto no lo tiene.
        </div>
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
                          <span className="badge bg-accent/15 text-accent text-[10px]">📋 Gherkin · ejecutable</span>
                          {!tc.supported && (
                            <span className="badge bg-amber-900 text-amber-300 text-[10px]">no generable aún</span>
                          )}
                        </div>
                        <p className="text-[13px] text-gray-300 mt-1">{tc.summary}</p>
                        {!tc.supported && tc.reason && (
                          <p className="text-[11px] text-warn mt-1">⚠ {tc.reason}</p>
                        )}
                        {tc.code && (
                          <div className="mt-1">
                            <button
                              className="text-[11px] text-accent hover:underline"
                              onClick={() => setOpenCode((s) => ({ ...s, [ck]: !codeOpen }))}
                            >
                              {codeOpen ? "▾ ocultar especificación" : "▸ ver especificación (Gherkin)"}
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

      {/* Casos adicionales (plantillas) → TC extra bajo la HU elegida */}
      <div className="card space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Casos adicionales (plantillas)</h3>
          <p className="text-xs text-muted mt-1">
            Agrega pruebas que NO vienen de un criterio (smoke, salud de API, validación de
            formularios…). Se crean como TC extra bajo la HU que elijas.
          </p>
        </div>
        {catalog.length === 0 ? (
          <p className="text-xs text-muted">No hay plantillas disponibles.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              <label className="text-xs text-muted">
                Plantilla
                <select
                  className="input mt-1 block"
                  value={selTpl}
                  onChange={(e) => { setSelTpl(e.target.value); setTplParams({}); }}
                >
                  <option value="">— elige —</option>
                  {catalog.map((t) => (
                    <option key={t.id} value={t.id}>{t.id}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted">
                HU dueña
                <select className="input mt-1 block" value={tplHu} onChange={(e) => setTplHu(e.target.value)}>
                  {huIds.map((h) => (
                    <option key={h} value={h}>HU #{h}</option>
                  ))}
                </select>
              </label>
            </div>
            {selTpl && curTplParams.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {curTplParams.map((p) => (
                  <label key={p.name} className="text-xs text-muted">
                    {p.name}
                    {p.required ? <span className="text-warn"> *</span> : <span className="opacity-70"> (opcional)</span>}
                    <input
                      className="input mt-1"
                      placeholder={p.default ? `default: ${p.default}` : ""}
                      value={tplParams[p.name] || ""}
                      onChange={(e) => setTplParams((s) => ({ ...s, [p.name]: e.target.value }))}
                    />
                  </label>
                ))}
                <p className="text-[11px] text-muted sm:col-span-2">
                  Los campos con <span className="text-warn">*</span> son obligatorios; los demás usan su
                  default. En un <b>monorepo</b>, pon una <b>URL completa</b> en los endpoints/paths para
                  apuntar a un servicio específico (p.ej. <code>https://core-api.miapp.com/health</code>).
                </p>
              </div>
            )}
            {selTpl && (
              <button className="btn-ghost w-fit" onClick={addCase} disabled={!canAdd}>+ Agregar caso</button>
            )}
          </div>
        )}
        {tcases.length > 0 && (
          <ul className="space-y-1">
            {tcases.map((c, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-md border border-border bg-panel2/30 px-3 py-1.5 text-xs"
              >
                <span>
                  <b>{c.template}</b> → HU #{c.huId}
                  {Object.keys(c.params).length
                    ? ` · ${Object.entries(c.params).map(([k, v]) => `${k}=${v}`).join(", ")}`
                    : ""}
                </span>
                <button
                  className="text-muted hover:text-red-300"
                  onClick={() => setTcases((cs) => cs.filter((_, j) => j !== i))}
                >
                  ✗
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost" onClick={onBack}>
          ← Atrás
        </button>
        {featureId && (
          <button className="btn-ghost" onClick={publishPlan}>
            {planPublished ? "✓ Plan publicado — republicar" : "📋 Publicar plan en el tracker"}
          </button>
        )}
        <button className="btn-primary" onClick={() => onContinue(approvedKeys, approvedKeys.length > 0, tcases)}>
          {approvedKeys.length + tcases.length > 0
            ? `Ejecutar con ${approvedKeys.length + tcases.length} prueba(s) →`
            : "Continuar sin generar →"}
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
