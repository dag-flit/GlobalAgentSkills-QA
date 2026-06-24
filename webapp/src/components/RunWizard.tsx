"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Spinner } from "@/components/ui";
import { useAction } from "@/components/ActionFeedback";
import { TrackerStep } from "@/components/TrackerStep";
import { FeatureStep, type WorkItemLite } from "@/components/FeatureStep";
import { ReviewStep } from "@/components/ReviewStep";
import type { TrackerName } from "@/lib/types";

/* ---------- detección ---------- */

type LayerInfo = {
  enabled: boolean;
  tool: string | null;
  reason?: string | null;
  cwd?: string;
  targets?: { tool: string; cwd: string }[];
};
type Detection = {
  stack: { backend: string; frontend: string; db: string };
  architecture: string;
  layers: Record<string, LayerInfo>;
  enabled: string[];
  skipped: { layer: string; reason: string }[];
};

const LAYER_META: Record<string, { label: string; desc: string }> = {
  static: { label: "Análisis estático", desc: "Linter y tipos (eslint, tsc, ruff, mypy)" },
  unit: { label: "Pruebas unitarias", desc: "vitest, jest, pytest, dotnet test" },
  api: { label: "Contrato de API", desc: "OpenAPI o colección Postman" },
  e2e: { label: "Pruebas E2E", desc: "Playwright o Cypress" },
  db: { label: "Base de datos", desc: "Migraciones, pgtap, prisma" },
  security: { label: "Seguridad", desc: "semgrep o bandit" },
};
const LAYER_ORDER = ["static", "unit", "api", "e2e", "db", "security"];

/* ---------- modos ---------- */

type Mode = "code" | "explore";

const MODES: { id: Mode; icon: string; label: string; desc: string }[] = [
  {
    id: "code",
    icon: "🧪",
    label: "QA del código",
    desc: "Corre las capas del proyecto: estático, unit, API, base de datos, seguridad y E2E. Trazabilidad opcional a un Feature/HUs y URL base para E2E.",
  },
  {
    id: "explore",
    icon: "🔎",
    label: "Explorar una URL",
    desc: "Smoke + capturas de una app viva en una URL, sin necesitar el código.",
  },
];

// Pasos dinámicos: en modo código, el paso Feature aparece solo con tracker remoto y el paso
// URL (base para E2E) solo si la capa e2e quedó activa en la detección.
function buildSteps(mode: Mode, tracker: TrackerName, e2eOn: boolean): { key: string; label: string }[] {
  if (mode === "explore") {
    return [
      { key: "tracker", label: "Tracker" },
      { key: "url", label: "URL" },
      { key: "run", label: "Ejecutar" },
    ];
  }
  return [
    { key: "source", label: "Código" },
    { key: "detect", label: "Detección" },
    { key: "tracker", label: "Tracker" },
    ...(tracker !== "local"
      ? [{ key: "feature", label: "Feature/HUs" }, { key: "review", label: "Revisión" }]
      : []),
    ...(e2eOn ? [{ key: "url", label: "URL (E2E)" }] : []),
    { key: "run", label: "Ejecutar" },
  ];
}

function Stepper({ steps, idx }: { steps: { key: string; label: string }[]; idx: number }) {
  return (
    <ol className="flex items-center gap-2 flex-wrap">
      {steps.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${
                active ? "bg-accent/15 text-accent font-medium" : done ? "text-accent2" : "text-muted"
              }`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                  active ? "bg-accent text-white" : done ? "bg-accent2/20 text-accent2" : "bg-panel2 text-muted"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              {s.label}
            </div>
            {i < steps.length - 1 && <span className="text-border">—</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- componente principal ---------- */

export function RunWizard() {
  const router = useRouter();
  const action = useAction();
  const [mode, setMode] = useState<Mode | null>(null);
  const [idx, setIdx] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // tracker
  const [tracker, setTracker] = useState<TrackerName>("local");
  // feature/HUs
  const [featureId, setFeatureId] = useState("");
  const [hus, setHus] = useState<WorkItemLite[]>([]);
  // revisión: pruebas aprobadas para generar (claves "<huId>:<TC-AC#>")
  const [approvedTcKeys, setApprovedTcKeys] = useState<string[]>([]);
  const [generate, setGenerate] = useState(false);
  // origen del código
  const [sourceKind, setSourceKind] = useState<"git" | "local">("local");
  const [gitUrl, setGitUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [localPath, setLocalPath] = useState("");
  // detección
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [layerOn, setLayerOn] = useState<Record<string, boolean>>({});
  // url
  const [appUrl, setAppUrl] = useState("");

  const steps = mode ? buildSteps(mode, tracker, !!layerOn.e2e) : [];
  const safeIdx = Math.min(idx, Math.max(0, steps.length - 1));
  const key = steps[safeIdx]?.key;

  function back() {
    if (idx > 0) setIdx(idx - 1);
    else {
      setMode(null);
      setIdx(0);
    }
  }
  const next = () => setIdx((i) => i + 1);

  function chooseMode(m: Mode) {
    setMode(m);
    setIdx(0);
  }

  async function runDetect(): Promise<boolean> {
    setDetecting(true);
    setDetectError(null);
    try {
      await action.run(
        {
          loading: sourceKind === "git" ? "Clonando y detectando el proyecto…" : "Detectando capas del proyecto…",
          success: (m) => String(m),
        },
        async () => {
          const body =
            sourceKind === "git" ? { kind: "git", gitUrl, branch } : { kind: "local", localPath };
          let res: any;
          try {
            const r = await fetch("/api/detect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            res = await r.json();
          } catch (e: any) {
            const message = e?.message ?? "Error de red";
            setDetectError(message);
            throw new Error(message);
          }
          if (!res.ok) {
            const message = res.error || "No se pudo detectar el proyecto.";
            setDetectError(message);
            throw new Error(message);
          }
          const det: Detection = res.detection;
          setRepoRoot(res.repoRoot);
          setDetection(det);
          const on: Record<string, boolean> = {};
          for (const l of LAYER_ORDER) on[l] = det.enabled.includes(l);
          setLayerOn(on);
          return `Detección lista · ${det.enabled.length} capa(s) disponible(s)`;
        }
      );
      return true;
    } catch {
      return false;
    } finally {
      setDetecting(false);
    }
  }

  const canDetect = sourceKind === "git" ? gitUrl.trim().length > 0 : localPath.trim().length > 0;

  async function launch() {
    if (!mode) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      await action.run(
        { loading: "Iniciando el ciclo QA…", success: "Ciclo QA iniciado — abriendo la corrida" },
        async () => {
          const body = {
            mode,
            repoRoot: mode === "code" ? repoRoot || undefined : undefined,
            layers: mode === "code" ? LAYER_ORDER.filter((l) => layerOn[l]) : [],
            appUrl: appUrl.trim() ? appUrl.trim() : undefined,
            featureId: mode === "code" && featureId.trim() ? featureId.trim() : undefined,
            huIds: mode === "code" && hus.length ? hus.map((h) => h.id) : undefined,
            generate: mode === "code" && generate ? true : undefined,
            approvedTcKeys: mode === "code" && generate && approvedTcKeys.length ? approvedTcKeys : undefined,
          };
          let res: any;
          try {
            const r = await fetch("/api/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            res = await r.json();
            if (!r.ok || !res.id) throw new Error(res.error || "No se pudo iniciar la corrida.");
          } catch (e: any) {
            const message = e?.message ?? "Error de red";
            setLaunchError(message);
            throw new Error(message);
          }
          return res.id as string;
        }
      ).then((id) => router.push(`/runs/${id}`));
    } catch {
      /* el error ya se mostró en la modal y en launchError */
    } finally {
      setLaunching(false);
    }
  }

  /* ---------- mode picker ---------- */
  if (!mode) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Asistente de ejecución</h1>
          <p className="text-sm text-muted mt-1">
            ¿Qué quieres probar? Elige el modo y te pediré solo lo necesario para ese flujo.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => chooseMode(m.id)}
              className="text-left card hover:border-accent transition-colors"
            >
              <div className="text-2xl">{m.icon}</div>
              <div className="font-semibold mt-2">{m.label}</div>
              <p className="text-sm text-muted mt-1">{m.desc}</p>
              <div className="text-accent text-sm mt-3">Elegir →</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const modeMeta = MODES.find((m) => m.id === mode)!;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Asistente de ejecución</h1>
          <p className="text-sm text-muted mt-1">
            Modo: <span className="text-accent">{modeMeta.icon} {modeMeta.label}</span>
          </p>
        </div>
        <button
          className="btn-ghost text-xs px-2 py-1"
          onClick={() => {
            setMode(null);
            setIdx(0);
          }}
        >
          ← Cambiar modo
        </button>
      </div>

      <Stepper steps={steps} idx={safeIdx} />

      {/* tracker */}
      {key === "tracker" && (
        <TrackerStep
          onBack={back}
          onContinue={(t) => {
            setTracker(t);
            next();
          }}
        />
      )}

      {/* feature → HUs */}
      {key === "feature" && (
        <FeatureStep
          tracker={tracker}
          onBack={back}
          onContinue={(f, selected) => {
            setFeatureId(f);
            setHus(selected);
            next();
          }}
        />
      )}

      {/* revisión de pruebas generadas (lenguaje claro) */}
      {key === "review" && (
        <ReviewStep
          huIds={hus.map((h) => h.id)}
          featureId={featureId}
          repoRoot={repoRoot}
          unitTool={
            detection?.layers?.unit?.tool ||
            detection?.layers?.unit?.targets?.[0]?.tool ||
            null
          }
          onBack={back}
          onContinue={(keys, gen) => {
            setApprovedTcKeys(keys);
            setGenerate(gen);
            next();
          }}
        />
      )}

      {/* origen del código */}
      {key === "source" && (
        <div className="space-y-4">
          <div className="card space-y-4 max-w-2xl">
            <div>
              <h2 className="font-semibold">¿Dónde está el código a probar?</h2>
              <p className="text-sm text-muted mt-1">
                Pega una URL de Git (se clona) o usa una carpeta de este equipo.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className={sourceKind === "local" ? "btn-primary" : "btn-ghost"}
                onClick={() => setSourceKind("local")}
              >
                📁 Ruta local
              </button>
              <button
                className={sourceKind === "git" ? "btn-primary" : "btn-ghost"}
                onClick={() => setSourceKind("git")}
              >
                🌐 URL de Git
              </button>
            </div>
            {sourceKind === "local" ? (
              <Field label="Ruta de la carpeta del proyecto" hint="Carpeta en este equipo">
                <input
                  className="input font-mono"
                  placeholder="C:\\ruta\\al\\proyecto"
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                />
              </Field>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <Field label="URL del repositorio Git" hint="Se clona en una carpeta interna">
                    <input
                      className="input font-mono"
                      placeholder="https://github.com/org/proyecto"
                      value={gitUrl}
                      onChange={(e) => setGitUrl(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Rama (opcional)">
                  <input className="input" placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
                </Field>
              </div>
            )}
            {detectError && (
              <div className="text-sm rounded-lg px-3 py-2 border border-red-700 bg-red-900/30 text-red-300">
                {detectError}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={back}>
              ← Atrás
            </button>
            <button
              className="btn-primary"
              disabled={!canDetect || detecting}
              onClick={async () => {
                if (await runDetect()) next();
              }}
            >
              {detecting ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Detectando…
                </span>
              ) : (
                "Detectar capas →"
              )}
            </button>
          </div>
        </div>
      )}

      {/* detección */}
      {key === "detect" && detection && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h2 className="font-semibold">Esto detecté en tu proyecto</h2>
            <p className="text-[11px] text-muted font-mono break-all">{repoRoot}</p>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="badge bg-panel2 text-gray-200">backend: {detection.stack.backend}</span>
              <span className="badge bg-panel2 text-gray-200">frontend: {detection.stack.frontend}</span>
              <span className="badge bg-panel2 text-gray-200">db: {detection.stack.db}</span>
              <span className="badge bg-accent/15 text-accent">arquitectura: {detection.architecture}</span>
            </div>
          </div>
          <div className="card space-y-3">
            <div>
              <h2 className="font-semibold">Capas a ejecutar</h2>
              <p className="text-sm text-muted mt-1">
                Marqué las capas con herramienta disponible. Ajusta lo que quieras correr.
              </p>
            </div>
            <div className="space-y-2">
              {LAYER_ORDER.map((l) => {
                const info = detection.layers[l];
                const meta = LAYER_META[l];
                const available = info?.enabled || (info?.targets?.length ?? 0) > 0;
                const tool = info?.tool || info?.targets?.[0]?.tool;
                return (
                  <label
                    key={l}
                    className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${
                      layerOn[l] ? "border-accent/40 bg-accent/5" : "border-border bg-panel2/30"
                    } ${!available ? "opacity-60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!!layerOn[l]}
                      onChange={(e) => setLayerOn((s) => ({ ...s, [l]: e.target.checked }))}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{meta.label}</span>
                        {available ? (
                          <span className="badge bg-accent2/15 text-accent2 text-[10px]">
                            {tool}
                            {info?.cwd ? ` · ${info.cwd}` : ""}
                          </span>
                        ) : (
                          <span className="badge bg-panel2 text-muted text-[10px]">no disponible</span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted">{meta.desc}</p>
                      {!available && info?.reason && <p className="text-[11px] text-warn mt-0.5">⚠ {info.reason}</p>}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={back}>
              ← Atrás
            </button>
            <button className="btn-primary" onClick={next} disabled={!Object.values(layerOn).some(Boolean)}>
              Continuar →
            </button>
          </div>
        </div>
      )}

      {/* url */}
      {key === "url" && (
        <div className="space-y-4">
          <div className="card space-y-4 max-w-2xl">
            <div>
              <h2 className="font-semibold">URL de la app</h2>
              <p className="text-sm text-muted mt-1">
                {mode === "code"
                  ? "Opcional: los E2E del repo se ejecutarán apuntando a esta URL (baseURL de la app corriendo). Puedes dejarla vacía si los tests ya traen su baseURL."
                  : "Exploraré esta URL viva (smoke + capturas), sin necesitar el código."}
              </p>
            </div>
            <Field label="URL" hint="ej. https://qa.miapp.com">
              <input
                className="input font-mono"
                placeholder="https://qa.miapp.com"
                value={appUrl}
                onChange={(e) => setAppUrl(e.target.value)}
              />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={back}>
              ← Atrás
            </button>
            <button className="btn-primary" onClick={next} disabled={mode === "explore" && !appUrl.trim()}>
              Continuar →
            </button>
          </div>
        </div>
      )}

      {/* run (placeholder hasta la sub-fase de ejecución) */}
      {key === "run" && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h2 className="font-semibold">Resumen — listo para ejecutar</h2>
            <ul className="text-sm space-y-1">
              <li>
                <span className="text-muted">Modo:</span> {modeMeta.label}
              </li>
              <li>
                <span className="text-muted">Tracker:</span> <span className="text-accent">{tracker}</span>
              </li>
              {mode === "code" && (featureId || hus.length > 0) && (
                <li>
                  <span className="text-muted">Feature:</span> #{featureId || "—"} ·{" "}
                  {hus.length} HU(s) seleccionadas
                </li>
              )}
              {mode === "code" && (
                <li>
                  <span className="text-muted">Código:</span>{" "}
                  <span className="font-mono">{repoRoot || "—"}</span>
                </li>
              )}
              {mode === "code" && detection && (
                <li>
                  <span className="text-muted">Capas:</span>{" "}
                  {LAYER_ORDER.filter((l) => layerOn[l]).join(", ") || "—"}
                </li>
              )}
              {appUrl && (
                <li>
                  <span className="text-muted">URL{mode === "code" ? " base (E2E)" : ""}:</span>{" "}
                  <span className="font-mono">{appUrl}</span>
                </li>
              )}
            </ul>
            {mode === "explore" && (
              <div className="text-sm rounded-lg px-3 py-2 border border-border bg-panel2/40 text-muted">
                Abriré un navegador (Playwright) para explorar la URL: revisa el estado HTTP, errores
                de consola y guarda una captura por página.
              </div>
            )}
            {launchError && (
              <div className="text-sm rounded-lg px-3 py-2 border border-red-700 bg-red-900/30 text-red-300">
                {launchError}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={back}>
              ← Atrás
            </button>
            <button className="btn-primary" onClick={launch} disabled={launching}>
              {launching ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Iniciando…
                </span>
              ) : (
                "▶ Ejecutar ciclo QA"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
