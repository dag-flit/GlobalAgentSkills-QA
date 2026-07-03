"use client";

import { useEffect, useState } from "react";
import type { AiConfig } from "@/lib/types";
import { Field, Spinner } from "@/components/ui";
import { useAction } from "@/components/ActionFeedback";

// Editor de la config de IA (asistente de guion). OFF por defecto. Guarda solo la porción `ai` vía
// /api/config/ai (no pisa tracker/databases). Ollama es LOCAL: los datos no salen de la máquina; el
// modelo lo elige/escribe el usuario (sin sesgo). Sin secretos.
export function AiSettings() {
  const action = useAction();
  const [ai, setAi] = useState<AiConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => setAi(c.ai ?? { enabled: false, endpoint: "http://localhost:11434", model: "" }))
      .catch(() => setAi(null));
  }, []);

  if (!ai) {
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> Cargando…
      </div>
    );
  }

  const patch = (p: Partial<AiConfig>) => {
    setAi({ ...ai, ...p });
    setSavedMsg(null);
  };

  async function save() {
    setSaving(true);
    setSavedMsg(null);
    try {
      await action.run(
        { loading: "Guardando configuración de IA…", success: "Configuración de IA guardada" },
        async () => {
          const r = await fetch("/api/config/ai", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(ai),
          });
          if (!r.ok) throw new Error("No se pudo guardar la configuración de IA");
          setSavedMsg("Guardado ✓");
        }
      );
    } catch {
      setSavedMsg("No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">Asistente de guion con IA (opcional)</h2>
        <p className="text-sm text-muted mt-1">
          <b>Apagado</b> (por defecto) el guion se arma con el generador <b>determinista</b>. <b>Encendido</b>,
          una HU se genera con un modelo <b>local de Ollama</b> —los datos no salen de tu máquina— usando los
          criterios de aceptación y la pantalla real. Instala Ollama, elige tu modelo y ponlo aquí.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ai.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Usar IA (Ollama) para generar el guion desde los AC
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Endpoint de Ollama" hint="local — p.ej. http://localhost:11434">
          <input className="input" value={ai.endpoint} placeholder="http://localhost:11434" onChange={(e) => patch({ endpoint: e.target.value })} />
        </Field>
        <Field label="Modelo" hint="el que tengas instalado — p.ej. llama3.1, qwen2.5, mistral">
          <input className="input" value={ai.model} placeholder="llama3.1" onChange={(e) => patch({ model: e.target.value })} />
        </Field>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <button className="btn-ghost" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar IA"}
        </button>
        {savedMsg && <span className="text-xs text-muted">{savedMsg}</span>}
      </div>
    </div>
  );
}
