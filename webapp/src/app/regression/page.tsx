"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import type { RegressionTarget } from "@/lib/types";
import { SystemCard } from "@/components/regression/SystemCard";

// Página «Test de Regresión»: registrás los SISTEMAS a probar (público o con login → credenciales
// cifradas). Cada sistema es una tarjeta expandible con tres secciones — Pruebas / Catálogo / Ajustes
// (ver SystemCard). Escanear el catálogo y editar las pruebas son trabajos SEPARADOS: el catálogo
// persiste, así que editar una prueba ya no obliga a re-escanear el sistema vivo.

type Draft = { name: string; baseUrl: string; authMode: "none" | "login"; username: string; password: string };
const EMPTY: Draft = { name: "", baseUrl: "", authMode: "none", username: "", password: "" };

function slugId(name: string): string {
  return (
    name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "sys"
  );
}

export default function RegressionPage() {
  const [targets, setTargets] = useState<RegressionTarget[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch("/api/regression/targets");
      const j = await r.json();
      setTargets(j.targets ?? []);
    } catch {
      setError("No se pudieron cargar los sistemas.");
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!draft.name.trim() || !draft.baseUrl.trim()) {
      setError("Poné al menos un nombre y la URL base.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/regression/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, id: slugId(draft.name) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar.");
      setDraft(EMPTY);
      setCreating(false);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Error de red.");
    } finally {
      setSaving(false);
    }
  }

  // El borrado REAL (la confirmación fuerte —tipear el nombre— vive en SystemCard, porque la cascada
  // es irreversible: sistema + suites + recorridos + histórico + catálogo).
  async function remove(id: string) {
    await fetch(`/api/regression/targets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Test de Regresión</h1>
          <p className="text-sm text-muted mt-1">
            Registrá los <b>sistemas</b> a probar. Cada uno se abre en <b>Pruebas · Catálogo · Ajustes</b>: escaneás
            el catálogo de selectores una vez y después armás/editás/corrés las pruebas sin re-escanear.
          </p>
        </div>
        {!creating && <button className="btn-primary" onClick={() => { setCreating(true); setError(null); }}>Nuevo sistema</button>}
      </div>

      {/* Alta de un sistema (solo al crear; la edición vive en la pestaña Ajustes de cada tarjeta) */}
      {creating && (
        <div className="card space-y-3">
          <div className="text-sm font-medium">Nuevo sistema</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input className="input" placeholder="Nombre (ej. FLIT DEV)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className="input font-mono" placeholder="https://dev.flitsas.online" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={draft.authMode === "none"} onChange={() => setDraft({ ...draft, authMode: "none" })} /> Sin login (sistema público)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={draft.authMode === "login"} onChange={() => setDraft({ ...draft, authMode: "login" })} /> Con login
            </label>
          </div>
          {draft.authMode === "login" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input className="input" placeholder="Usuario" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
              <input className="input" type="password" placeholder="Clave" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
            </div>
          )}
          {draft.authMode === "login" && (
            <p className="text-[11px] text-muted">La clave se guarda <b>cifrada</b> (AES-256-GCM) y nunca vuelve al navegador.</p>
          )}
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex items-center gap-2">
            <button className="btn-primary" onClick={create} disabled={saving}>
              {saving ? <span className="flex items-center gap-2"><Spinner /> Guardando…</span> : "Agregar sistema"}
            </button>
            <button className="btn-ghost" onClick={() => { setCreating(false); setDraft(EMPTY); setError(null); }}>Cancelar</button>
          </div>
        </div>
      )}
      {!creating && error && <p className="text-sm text-red-300">{error}</p>}

      {/* Sistemas registrados */}
      <div className="space-y-2">
        {targets.length === 0 && !creating && <p className="text-sm text-muted">Todavía no registraste ningún sistema.</p>}
        {targets.map((t) => (
          <SystemCard key={t.id} target={t} onChanged={load} onRemoved={remove} />
        ))}
      </div>
    </div>
  );
}
