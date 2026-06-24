"use client";

import { useEffect, useState } from "react";
import type { AppConfig, AiConfig, AiProvider } from "@/lib/types";
import { Field, Spinner } from "@/components/ui";
import { useAction } from "@/components/ActionFeedback";

const PROVIDERS: {
  id: AiProvider;
  label: string;
  desc: string;
  keyUrl?: string;
  defaultModel: string;
}[] = [
  { id: "none", label: "Ninguno (esqueletos)", desc: "Sin IA: las pruebas salen como esqueleto «pendiente».", defaultModel: "" },
  {
    id: "google",
    label: "Google Gemini (AI Studio)",
    desc: "Tiene capa GRATIS. Saca la key en AI Studio (sin tarjeta).",
    keyUrl: "https://aistudio.google.com/app/apikey",
    defaultModel: "gemini-2.0-flash",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    desc: "Mayor capacidad. Requiere cuenta con saldo.",
    keyUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-opus-4-8",
  },
];

export function AiSettings() {
  const action = useAction();
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: AppConfig) => setCfg(c))
      .catch(() => setCfg(null));
  }, []);

  if (!cfg) {
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> Cargando configuración de IA…
      </div>
    );
  }

  const ai: AiConfig = cfg.ai ?? { provider: "none", apiKey: "", model: "" };
  const meta = PROVIDERS.find((p) => p.id === ai.provider) ?? PROVIDERS[0];

  function patch(p: Partial<AiConfig>) {
    setCfg((c) => ({ ...c!, ai: { ...(c!.ai ?? { provider: "none", apiKey: "", model: "" }), ...p } }));
  }

  async function save() {
    setSaving(true);
    await action
      .run({ loading: "Guardando configuración de IA…", success: "Configuración de IA guardada" }, async () => {
        const r = await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cfg),
        });
        if (!r.ok) throw new Error("No se pudo guardar la configuración");
        setCfg(await r.json());
      })
      .catch(() => {});
    setSaving(false);
  }

  async function test() {
    await action
      .run({ loading: "Probando la conexión con la IA…", success: (m) => String(m) }, async () => {
        const r = await fetch("/api/ai/test", { method: "POST" });
        const res = await r.json();
        if (!res.ok) throw new Error(res.error || "Falló la prueba de IA");
        return `IA conectada ✓ · ${res.provider}${res.model ? ` · ${res.model}` : ""}`;
      })
      .catch(() => {});
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">Generación de pruebas con IA</h2>
        <p className="text-sm text-muted mt-1">
          La IA escribe el <b>código real</b> de los tests a partir de los criterios de cada HU. Es
          opcional: sin proveedor, el kit usa <b>esqueletos</b> deterministas. Configúralo una sola
          vez aquí; cada corrida «QA del código» lo usará en el paso de Revisión.
        </p>
      </div>

      {/* selector de proveedor */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {PROVIDERS.map((p) => {
          const active = ai.provider === p.id;
          return (
            <button
              key={p.id}
              onClick={() => patch({ provider: p.id, model: ai.model || p.defaultModel })}
              className={`text-left rounded-lg border p-3 transition-colors ${
                active ? "border-accent bg-accent/10" : "border-border bg-panel2/30 hover:bg-panel2"
              }`}
            >
              <div className={`text-sm font-medium ${active ? "text-accent" : "text-gray-200"}`}>{p.label}</div>
              <div className="text-[11px] text-muted leading-tight mt-0.5">{p.desc}</div>
            </button>
          );
        })}
      </div>

      {ai.provider !== "none" && (
        <div className="space-y-3">
          {meta.keyUrl && (
            <p className="text-xs text-muted">
              ¿No tienes key?{" "}
              <a className="text-accent underline" href={meta.keyUrl} target="_blank" rel="noreferrer">
                Sácala aquí
              </a>
              . También puedes dejar el campo vacío y exponerla como variable de entorno (
              <code>{ai.provider === "google" ? "GOOGLE_AI_API_KEY" : "ANTHROPIC_API_KEY"}</code>).
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="API key" hint="Se guarda local y se enmascara">
              <input
                className="input"
                type="password"
                placeholder="(o usa variable de entorno)"
                value={ai.apiKey}
                onChange={(e) => patch({ apiKey: e.target.value })}
              />
            </Field>
            <Field label="Modelo" hint={`default: ${meta.defaultModel || "—"}`}>
              <input
                className="input font-mono"
                placeholder={meta.defaultModel}
                value={ai.model}
                onChange={(e) => patch({ model: e.target.value })}
              />
            </Field>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {ai.provider !== "none" && (
          <button className="btn-ghost" onClick={test}>
            🔌 Probar IA
          </button>
        )}
      </div>
    </div>
  );
}
