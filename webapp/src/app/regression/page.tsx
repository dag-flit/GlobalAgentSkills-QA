"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { SECRET_MASK, type RegressionTarget, type SelectorCatalog } from "@/lib/types";
import { SuiteBuilder } from "@/components/regression/SuiteBuilder";

// Página «Test de Regresión» (Fase 1): registrás los SISTEMAS a probar (con login → credenciales
// cifradas, o sin login) y tocás «Escanear sistema» para que el escáner lea el catálogo de
// selectores del sistema vivo (determinista, sin IA). El catálogo alimentará el constructor de
// suites (fases siguientes). La clave nunca vuelve al navegador (se envía enmascarada).

type Draft = { id: string; name: string; baseUrl: string; authMode: "none" | "login"; username: string; password: string };
const EMPTY: Draft = { id: "", name: "", baseUrl: "", authMode: "none", username: "", password: "" };

function slugId(name: string): string {
  return (
    name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "sys"
  );
}

export default function RegressionPage() {
  const [targets, setTargets] = useState<RegressionTarget[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [scanId, setScanId] = useState<string | null>(null);
  const [routesText, setRoutesText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [catalog, setCatalog] = useState<SelectorCatalog | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

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

  function editTarget(t: RegressionTarget) {
    setEditing(true);
    setDraft({ id: t.id, name: t.name, baseUrl: t.baseUrl, authMode: t.authMode, username: t.username, password: t.password || "" });
    setError(null);
  }
  function resetForm() {
    setEditing(false);
    setDraft(EMPTY);
    setError(null);
  }

  async function save() {
    if (!draft.name.trim() || !draft.baseUrl.trim()) {
      setError("Poné al menos un nombre y la URL base.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = editing && draft.id ? draft.id : slugId(draft.name);
      const body = { ...draft, id };
      const r = await fetch("/api/regression/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar.");
      resetForm();
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Error de red.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(`¿Eliminar el sistema «${id}» y su catálogo?`)) return;
    await fetch(`/api/regression/targets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (scanId === id) {
      setScanId(null);
      setCatalog(null);
    }
    await load();
  }

  function openScan(t: RegressionTarget) {
    setScanId(t.id);
    // Un sistema sin escanear tiene catalog = {} (default de la BD) → sin `pages`. Tratarlo como null
    // para no romper la vista; solo mostramos catálogo si tiene páginas.
    const cat = t.catalog?.pages?.length ? (t.catalog as SelectorCatalog) : null;
    setCatalog(cat);
    setRoutesText("");
    setScanMsg(cat ? "Mostrando el último catálogo guardado. Volvé a escanear para actualizarlo." : null);
  }

  function parseRoutes(text: string): Array<{ route: string; name?: string }> {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [route, name] = l.split("|").map((s) => s.trim());
        return name ? { route, name } : { route };
      });
  }

  async function scan(id: string) {
    setScanning(true);
    setScanMsg(null);
    setError(null);
    try {
      const routes = parseRoutes(routesText);
      const r = await fetch("/api/regression/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, routes: routes.length ? routes : undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo escanear.");
      setCatalog(j.catalog);
      setScanMsg(`✓ Escaneo listo: ${j.count} selector(es) en ${j.catalog.pages.length} página(s).`);
      await load();
    } catch (e: any) {
      setScanMsg(`No se pudo escanear: ${e?.message ?? "error"}`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Test de Regresión</h1>
        <p className="text-sm text-muted mt-1">
          Registrá los <b>sistemas</b> a probar y tocá <b>Escanear sistema</b> para leer su{" "}
          <b>catálogo de selectores</b> del sistema vivo (determinista, sin IA). Ese catálogo
          alimentará el armado de las pruebas de regresión.
        </p>
      </div>

      {/* Alta/edición de un sistema */}
      <div className="card space-y-3">
        <div className="text-sm font-medium">{editing ? `Editar sistema «${draft.id}»` : "Nuevo sistema"}</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className="input" placeholder="Nombre (ej. FLIT DEV)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <input className="input font-mono" placeholder="https://dev.flitsas.online" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} />
        </div>
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={draft.authMode === "none"} onChange={() => setDraft({ ...draft, authMode: "none" })} />
            Sin login (sistema público)
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={draft.authMode === "login"} onChange={() => setDraft({ ...draft, authMode: "login" })} />
            Con login
          </label>
        </div>
        {draft.authMode === "login" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input className="input" placeholder="Usuario" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
            <input
              className="input"
              type="password"
              placeholder="Clave"
              value={draft.password}
              onFocus={() => draft.password === SECRET_MASK && setDraft({ ...draft, password: "" })}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
            />
          </div>
        )}
        {draft.authMode === "login" && (
          <p className="text-[11px] text-muted">
            La clave se guarda <b>cifrada</b> (AES-256-GCM) y nunca vuelve al navegador. Al editar, se
            muestra enmascarada; dejala así para conservarla.
          </p>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex items-center gap-2">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="flex items-center gap-2"><Spinner /> Guardando…</span> : editing ? "Guardar cambios" : "Agregar sistema"}
          </button>
          {editing && <button className="btn-ghost" onClick={resetForm}>Cancelar</button>}
        </div>
      </div>

      {/* Sistemas registrados */}
      <div className="space-y-2">
        {targets.length === 0 && <p className="text-sm text-muted">Todavía no registraste ningún sistema.</p>}
        {targets.map((t) => (
          <div key={t.id} className="card space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm">
                <span className="font-medium text-white">{t.name}</span>{" "}
                <span className="text-[11px] text-muted">
                  · <code>{t.baseUrl}</code> · {t.authMode === "login" ? "con login 🔒" : "público"}
                  {t.catalog?.pages?.length ? ` · catálogo: ${t.catalog.pages.reduce((n, p) => n + p.elements.length, 0)} selector(es)` : " · sin catálogo"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn-primary" onClick={() => openScan(t)}>Escanear sistema</button>
                <button className="btn-ghost" onClick={() => editTarget(t)}>Editar</button>
                <button className="btn-ghost text-red-300" onClick={() => remove(t.id)}>Eliminar</button>
              </div>
            </div>

            {scanId === t.id && (
              <div className="space-y-2 pt-2 border-t border-border">
                <p className="text-[11px] text-muted">
                  Rutas a catalogar (opcional, una por línea; formato <code>/ruta | Nombre</code>). Vacío
                  = solo la URL base.
                </p>
                <textarea
                  className="input font-mono w-full"
                  rows={3}
                  placeholder={"/\n/?m=reportes | Reportes\n/admin/companies | Empresas"}
                  value={routesText}
                  onChange={(e) => setRoutesText(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button className="btn-primary" onClick={() => scan(t.id)} disabled={scanning}>
                    {scanning ? <span className="flex items-center gap-2"><Spinner /> Escaneando…</span> : "▶ Escanear ahora"}
                  </button>
                  {scanMsg && <span className="text-[11px] text-muted">{scanMsg}</span>}
                </div>
                {catalog && <CatalogView catalog={catalog} />}
                <SuiteBuilder target={t} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CatalogView({ catalog }: { catalog: SelectorCatalog }) {
  const pages = catalog?.pages ?? [];
  if (pages.length === 0) return null;
  return (
    <div className="space-y-3">
      {pages.map((p, i) => (
        <div key={i} className="rounded-lg border border-border bg-panel2/40 p-3 space-y-2">
          <div className="text-sm font-medium">
            {p.name} <span className="text-[11px] text-muted font-mono">{p.route}</span>{" "}
            <span className="text-[11px] text-muted">· {p.elements.length} selector(es)</span>
          </div>
          {p.elements.length === 0 ? (
            <p className="text-[11px] text-muted">No se detectaron elementos anclables en esta página.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-[12px] w-full">
                <thead>
                  <tr className="text-muted text-left">
                    <th className="py-1 pr-3">Alias</th>
                    <th className="py-1 pr-3">Cómo lo encuentra</th>
                    <th className="py-1">Referencia</th>
                  </tr>
                </thead>
                <tbody>
                  {p.elements.map((e, j) => (
                    <tr key={j} className="border-t border-border/50">
                      <td className="py-1 pr-3 font-mono text-accent">{e.alias}</td>
                      <td className="py-1 pr-3">{e.by}</td>
                      <td className="py-1 font-mono">{e.by === "role" ? `${e.role} · ${e.name}` : e.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
