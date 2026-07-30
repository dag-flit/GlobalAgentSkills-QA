"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui";
import type { RegressionTarget, SelectorCatalog, SelectorCatalogPage } from "@/lib/types";

// Pestaña CATÁLOGO de un sistema: el catálogo de selectores es POR SISTEMA y se organiza POR PÁGINA
// (cada ruta escaneada = una pantalla de la app con sus elementos). NO por suite: todas las suites/
// pruebas del sistema comparten estos selectores (el selector vive una vez → se corrige en un lugar).
// El escaneo es INCREMENTAL: por defecto agrega/actualiza las páginas escaneadas y conserva las demás.

// El nombre de la pantalla de login auto-catalogada (se refresca en cualquier escaneo → no se lista
// como ruta pre-cargada ni ofrece re-escaneo propio).
const LOGIN_PAGE = /^Acceso \(/i;

// Rutas de las páginas ya catalogadas (excluye la pantalla de login auto-catalogada) → para el botón
// «Re-escanear todas» refrescamos lo conocido SIN pedirle al usuario que lo vuelva a escribir.
function existingRoutes(cat: SelectorCatalog | null): Array<{ route: string; name: string }> {
  return (cat?.pages ?? [])
    .filter((p) => !LOGIN_PAGE.test(p.name))
    .map((p) => ({ route: p.route, name: p.name }));
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

function localWhen(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function RegressionCatalog({ target, onChanged }: { target: RegressionTarget; onChanged: () => void }) {
  const initial = target.catalog?.pages?.length ? (target.catalog as SelectorCatalog) : null;
  const [routesText, setRoutesText] = useState(""); // VACÍO: solo para agregar páginas NUEVAS
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [scanning, setScanning] = useState<string | null>(null); // null | "all" | nombre de la página
  const [catalog, setCatalog] = useState<SelectorCatalog | null>(initial);
  const [msg, setMsg] = useState<string | null>(null);

  async function scan(routes: Array<{ route: string; name?: string }>, useMode: "merge" | "replace", key: string) {
    setScanning(key);
    setMsg(null);
    try {
      const r = await fetch("/api/regression/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, routes: routes.length ? routes : undefined, mode: useMode }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo escanear.");
      setCatalog(j.catalog);
      setMsg(`Catálogo actualizado: ${j.count} selector(es) en ${j.catalog.pages.length} página(s).`);
      onChanged();
    } catch (e: any) {
      setMsg(`No se pudo escanear: ${e?.message ?? "error"}`);
    } finally {
      setScanning(null);
    }
  }

  const pages = catalog?.pages ?? [];
  const known = existingRoutes(catalog);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        El catálogo es de <b>todo el sistema</b>, organizado por <b>página</b> (cada ruta que escaneás es una pantalla
        de la app). Lo comparten todas las suites y pruebas.
      </p>

      {/* Agregar páginas NUEVAS (el cuadro va vacío; las que ya tenés aparecen abajo con su propio «Actualizar») */}
      <div className="rounded-lg border border-border p-2 space-y-2">
        <div className="text-[12px] font-medium">Agregar páginas nuevas al catálogo</div>
        <p className="text-[11px] text-muted">Una ruta por línea, formato <code>/ruta | Nombre</code>. Vacío = solo la URL base.</p>
        <textarea
          className="input font-mono w-full"
          rows={3}
          placeholder={"/tramites | Trámites\n/tramites/nuevo/matricula_inicial | Creación de Trámites (MI)"}
          value={routesText}
          onChange={(e) => setRoutesText(e.target.value)}
        />
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <input type="checkbox" checked={mode === "replace"} onChange={(e) => setMode(e.target.checked ? "replace" : "merge")} />
          <span>Reemplazar <b>todo</b> el catálogo con estas rutas (empezar de cero). Sin marcar: se agregan/actualizan y se conserva el resto.</span>
        </label>
        <button className="btn-primary" onClick={() => scan(parseRoutes(routesText), mode, "typed")} disabled={!!scanning || !routesText.trim()}>
          {scanning === "typed" ? <span className="flex items-center gap-2"><Spinner /> Escaneando…</span> : "Escanear y agregar"}
        </button>
      </div>

      {/* Páginas ya catalogadas + refresco */}
      {pages.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[12px] font-medium">Páginas del catálogo ({pages.length})</div>
            {known.length > 0 && (
              <button className="btn-ghost text-[11px]" onClick={() => scan(known, "merge", "all")} disabled={!!scanning} title="Vuelve a escanear todas las páginas ya catalogadas (refresca los selectores)">
                {scanning === "all" ? <span className="flex items-center gap-2"><Spinner /> Re-escaneando…</span> : "Re-escanear todas las páginas"}
              </button>
            )}
          </div>
          {msg && <p className="text-[11px] text-muted">{msg}</p>}
          {pages.map((p, i) => (
            <PageCard key={i} page={p} busy={scanning === p.name} disabled={!!scanning} onRescan={() => scan([{ route: p.route, name: p.name }], "merge", p.name)} />
          ))}
        </div>
      )}
      {pages.length === 0 && msg && <p className="text-[11px] text-muted">{msg}</p>}
    </div>
  );
}

function PageCard({ page, busy, disabled, onRescan }: { page: SelectorCatalogPage; busy: boolean; disabled: boolean; onRescan: () => void }) {
  const isLogin = LOGIN_PAGE.test(page.name);
  const when = localWhen(page.scannedAt);
  return (
    <div className="rounded-lg border border-border bg-panel2/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium">
          {page.name} <span className="text-[11px] text-muted font-mono">{page.route}</span>{" "}
          <span className="text-[11px] text-muted">· {page.elements.length} selector(es)</span>
          {when && <span className="text-[11px] text-muted"> · escaneada {when}</span>}
        </div>
        {!isLogin && (
          <button className="btn-ghost text-[11px]" onClick={onRescan} disabled={disabled} title="Volver a escanear solo esta página">
            {busy ? <span className="flex items-center gap-2"><Spinner /> Actualizando…</span> : "Actualizar esta página"}
          </button>
        )}
      </div>
      {page.elements.length === 0 ? (
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
              {page.elements.map((e, j) => (
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
  );
}
