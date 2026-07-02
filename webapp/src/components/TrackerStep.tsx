"use client";

import { useEffect, useState } from "react";
import type { AppConfig, TrackerConfig, TrackerName } from "@/lib/types";
import { Field, Spinner } from "@/components/ui";
import { useAction } from "@/components/ActionFeedback";

const TRACKERS: { id: TrackerName; label: string; desc: string; icon: string }[] = [
  { id: "local", label: "Local", desc: "Solo reporte en el repo. Sin conexión.", icon: "💾" },
  { id: "azure-devops", label: "Azure DevOps", desc: "Comenta en la HU + adjuntos.", icon: "🔷" },
];

type TestState = { status: "idle" | "testing" | "ok" | "err"; detail?: string };

export function TrackerStep({
  onBack,
  onContinue,
}: {
  onBack?: () => void;
  onContinue?: (t: TrackerName) => void;
}) {
  const action = useAction();
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: AppConfig) => setCfg(c))
      .catch(() => setCfg(null));
  }, []);

  if (!cfg) {
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> Cargando configuración…
      </div>
    );
  }

  const t = cfg.tracker;

  function patchTracker(patch: Partial<TrackerConfig>) {
    setCfg((c) => ({ ...c!, tracker: { ...c!.tracker, ...patch } }));
    setTest({ status: "idle" });
    setSavedMsg(null);
  }
  function patchAzure(p: Partial<TrackerConfig["azure"]>) {
    patchTracker({ azure: { ...t.azure, ...p } });
  }

  async function save(): Promise<boolean> {
    setSaving(true);
    setSavedMsg(null);
    try {
      await action.run(
        { loading: "Guardando credenciales del tracker…", success: "Credenciales guardadas correctamente" },
        async () => {
          const r = await fetch("/api/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cfg),
          });
          if (!r.ok) throw new Error("No se pudo guardar la configuración");
          const updated: AppConfig = await r.json();
          setCfg(updated);
          setSavedMsg("Guardado ✓");
        }
      );
      return true;
    } catch {
      setSavedMsg("No se pudo guardar");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function continueStep() {
    // Persistir antes de avanzar: los pasos siguientes (Feature→HUs, ejecución) usan la
    // configuración guardada del tracker. Solo avanza si guardó bien.
    if (await save()) onContinue?.(t.selected);
  }

  async function runTest() {
    setTest({ status: "testing" });
    await action
      .run(
        { loading: "Probando conexión al tracker…", success: (m) => String(m) },
        async () => {
          let res: any;
          try {
            const r = await fetch("/api/tracker/test", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tracker: t }),
            });
            res = await r.json();
          } catch (e: any) {
            const message = e?.message ?? "Error de red";
            setTest({ status: "err", detail: message });
            throw new Error(message);
          }
          setTest({ status: res.ok ? "ok" : "err", detail: res.detail || res.mode });
          if (!res.ok) throw new Error(res.detail || res.mode || "No se pudo conectar al tracker");
          return `Conexión exitosa${res.detail ? ` · ${res.detail}` : ""}`;
        }
      )
      .catch(() => {});
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold">¿Dónde se reportan los resultados?</h2>
          <p className="text-sm text-muted mt-1">
            Elige el destino. <b>Local</b> solo deja el reporte en el repo (sin conexión). Los demás
            comentan en la historia/issue y requieren credenciales.
          </p>
        </div>

        {/* selector */}
        <div className="grid grid-cols-2 gap-2">
          {TRACKERS.map((opt) => {
            const active = t.selected === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => patchTracker({ selected: opt.id })}
                className={`text-left rounded-lg border p-3 transition-colors ${
                  active ? "border-accent bg-accent/10" : "border-border bg-panel2/30 hover:bg-panel2"
                }`}
              >
                <div className="text-lg">{opt.icon}</div>
                <div className={`text-sm font-medium ${active ? "text-accent" : "text-gray-200"}`}>
                  {opt.label}
                </div>
                <div className="text-[11px] text-muted leading-tight mt-0.5">{opt.desc}</div>
              </button>
            );
          })}
        </div>

        {/* credenciales condicionales */}
        {t.selected === "local" && (
          <div className="text-sm rounded-lg px-3 py-2 border border-border bg-panel2/40 text-muted">
            Local no necesita configuración. El reporte (md + html) queda en{" "}
            <code>qa-evidence/</code> dentro del proyecto.
          </div>
        )}

        {t.selected === "azure-devops" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Organization URL" hint="https://dev.azure.com/&lt;org&gt;">
              <input className="input" value={t.azure.orgUrl} onChange={(e) => patchAzure({ orgUrl: e.target.value })} />
            </Field>
            <Field label="Proyecto">
              <input className="input" value={t.azure.project} onChange={(e) => patchAzure({ project: e.target.value })} />
            </Field>
            <Field label="Personal Access Token (PAT)" hint="Se guarda local y se enmascara">
              <input className="input" type="password" value={t.azure.pat} onChange={(e) => patchAzure({ pat: e.target.value })} />
            </Field>
            <Field label="Tu email (supervisión)">
              <input className="input" value={t.azure.userEmail} onChange={(e) => patchAzure({ userEmail: e.target.value })} />
            </Field>
          </div>
        )}

        {/* resultado de prueba */}
        {test.status !== "idle" && (
          <div
            className={`text-sm rounded-lg px-3 py-2 border ${
              test.status === "ok"
                ? "border-green-700 bg-green-900/30 text-green-300"
                : test.status === "err"
                ? "border-red-700 bg-red-900/30 text-red-300"
                : "border-border bg-panel2 text-muted"
            }`}
          >
            {test.status === "testing" ? (
              <span className="flex items-center gap-2">
                <Spinner /> Probando conexión…
              </span>
            ) : (
              <>
                {test.status === "ok" ? "✓ " : "✕ "}
                {test.detail}
              </>
            )}
          </div>
        )}

        {/* acciones */}
        {t.selected !== "local" && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
            <button className="btn-ghost" onClick={runTest} disabled={test.status === "testing"}>
              🔌 Probar conexión
            </button>
            <button className="btn-ghost" onClick={save} disabled={saving}>
              {saving ? "Guardando…" : "Guardar credenciales"}
            </button>
            {savedMsg && <span className="text-xs text-muted">{savedMsg}</span>}
          </div>
        )}
      </div>

      {onContinue && (
        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={onBack}>
            ← Atrás
          </button>
          <button className="btn-primary" onClick={continueStep} disabled={saving}>
            {saving ? "Guardando…" : "Continuar →"}
          </button>
        </div>
      )}
    </div>
  );
}
