"use client";

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import type { RegressionTarget, SelectorCatalog, SelectorCatalogPage } from "@/lib/types";

// Pestaña CATÁLOGO de un sistema: el INVENTARIO de selectores capturados, POR PÁGINA (cada ruta
// escaneada = una pantalla con sus elementos). Lo comparten todas las suites/pruebas (el selector vive
// una vez → se corrige en un lugar). Para no ser un muro, cada pantalla arranca PLEGADA y hay un
// BUSCADOR de elementos. Grabar un flujo multipantalla vive ahora en la pestaña «Recorridos» (antes se
// mezclaba acá). El escaneo por URL es INCREMENTAL: agrega/actualiza las páginas y conserva el resto.

// El nombre de la pantalla de login auto-catalogada (se refresca en cualquier escaneo → no se lista
// como ruta pre-cargada ni ofrece re-escaneo propio).
const LOGIN_PAGE = /^Acceso \(/i;

const norm = (s: string) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ¿El elemento coincide con el texto buscado? Mira alias, nombre/valor visible, tipo de anclaje y rol.
function matchEl(e: { alias: string; by: string; role?: string; name?: string; value?: string }, q: string): boolean {
  if (!q) return true;
  const hay = norm([e.alias, e.by, e.role, e.name, e.value].filter(Boolean).join(" "));
  return hay.includes(q);
}

// Rutas de las páginas ya catalogadas (excluye la pantalla de login auto-catalogada) → para el botón
// «Re-escanear todas» refrescamos lo conocido SIN pedirle al usuario que lo vuelva a escribir.
function existingRoutes(cat: SelectorCatalog | null): Array<{ route: string; name: string }> {
  return (cat?.pages ?? [])
    .filter((p) => !LOGIN_PAGE.test(p.name))
    .map((p) => ({ route: p.route, name: p.name }));
}

// Agrupa las páginas por su RAÍZ de breadcrumb (lo anterior al primer « › »). Así un asistente como
// «Matrícula Inicial › Consulta RUNT / › Resultado RUNT» se ve anidado bajo su título, en vez de como
// tarjetas sueltas. Conserva el orden de aparición. `sub` = el resto del breadcrumb (nombre a mostrar).
function groupByBreadcrumb(pages: SelectorCatalogPage[]): Array<{ root: string; items: Array<{ page: SelectorCatalogPage; sub: string }> }> {
  const order: string[] = [];
  const map = new Map<string, Array<{ page: SelectorCatalogPage; sub: string }>>();
  for (const p of pages) {
    const parts = p.name.split(" › ");
    const root = parts[0];
    const sub = parts.slice(1).join(" › ");
    if (!map.has(root)) { map.set(root, []); order.push(root); }
    map.get(root)!.push({ page: p, sub });
  }
  return order.map((root) => ({ root, items: map.get(root)! }));
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

const pageKey = (p: SelectorCatalogPage) => `${p.route}||${p.name}`;

export function RegressionCatalog({ target, onChanged, onEditRecorrido }: { target: RegressionTarget; onChanged: () => void; onEditRecorrido?: (name: string) => void }) {
  const initial = target.catalog?.pages?.length ? (target.catalog as SelectorCatalog) : null;
  const [routesText, setRoutesText] = useState(""); // VACÍO: solo para agregar páginas NUEVAS
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [scanning, setScanning] = useState<string | null>(null); // null | "all" | nombre de la página
  const [catalog, setCatalog] = useState<SelectorCatalog | null>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [urlPanel, setUrlPanel] = useState(false); // panel de escaneo por URL
  const [query, setQuery] = useState(""); // buscador de elementos
  const [openPages, setOpenPages] = useState<Record<string, boolean>>({}); // pantallas expandidas
  const [confirmDel, setConfirmDel] = useState<string | null>(null); // "__all__" | nombre de pantalla a borrar
  const [busyDel, setBusyDel] = useState(false);

  // Sincroniza el catálogo local cuando el padre recarga el target (p.ej. tras caminar un recorrido).
  useEffect(() => {
    setCatalog(target.catalog?.pages?.length ? (target.catalog as SelectorCatalog) : null);
  }, [target.catalog]);

  const q = norm(query.trim());
  const searching = q.length > 0;

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

  // Borra una pantalla (o todo el catálogo) cuando los selectores quedaron obsoletos (el front cambió).
  // Solo toca el catálogo (selectores); no borra suites, recorridos ni histórico. Después se re-escanea.
  async function removeCatalog(pageNameOrAll: string) {
    setBusyDel(true);
    setMsg(null);
    try {
      const qs = pageNameOrAll === "__all__"
        ? `id=${encodeURIComponent(target.id)}&all=1`
        : `id=${encodeURIComponent(target.id)}&page=${encodeURIComponent(pageNameOrAll)}`;
      const r = await fetch(`/api/regression/catalog?${qs}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo eliminar.");
      setCatalog(j.catalog?.pages?.length ? j.catalog : null);
      setMsg(pageNameOrAll === "__all__" ? "Catálogo vaciado. Volvé a escanear las pantallas vigentes." : "Pantalla eliminada del catálogo. Re-escaneala si sigue vigente.");
      onChanged();
    } catch (e: any) {
      setMsg(`No se pudo eliminar: ${e?.message ?? "error"}`);
    } finally {
      setBusyDel(false);
      setConfirmDel(null);
    }
  }

  const pages = catalog?.pages ?? [];
  const known = existingRoutes(catalog);
  // Total de coincidencias del buscador (para el contador). Barato: el catálogo es del orden de cientos.
  const matchCount = useMemo(
    () => (searching ? pages.reduce((n, p) => n + p.elements.filter((e) => matchEl(e, q)).length, 0) : 0),
    [pages, q, searching],
  );

  function toggle(p: SelectorCatalogPage) {
    const k = pageKey(p);
    setOpenPages((o) => ({ ...o, [k]: !o[k] }));
  }
  // Elementos a mostrar de una página (filtrados si hay búsqueda) + si la página se ve + si va expandida.
  function view(p: SelectorCatalogPage): { elements: typeof p.elements; visible: boolean; open: boolean } {
    if (!searching) return { elements: p.elements, visible: true, open: !!openPages[pageKey(p)] };
    const elements = p.elements.filter((e) => matchEl(e, q));
    return { elements, visible: elements.length > 0, open: true }; // buscando: solo lo que matchea, expandido
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        Inventario de <b>selectores capturados</b> de tu sistema, por <b>pantalla</b>. Lo comparten todas las pruebas.
        ¿Es un flujo de varias pantallas (un asistente)? Grabalo en la pestaña <b>Recorridos</b>.
      </p>

      {/* Buscador + escanear por URL. */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="input h-8 text-[12px] flex-1 min-w-[180px] max-w-[320px]"
          placeholder="🔎 Buscar un elemento (por nombre, alias o tipo)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && <span className="text-[11px] text-muted">{matchCount} coincidencia(s)</span>}
        <button className={`btn-ghost text-[12px] ${urlPanel ? "border-accent text-accent" : ""}`} onClick={() => setUrlPanel((v) => !v)}>
          + Escanear una página (URL)
        </button>
      </div>

      {/* Panel: escanear una página por URL (pantallas simples, con URL navegable). */}
      {urlPanel && (
        <div className="rounded-lg border border-border p-2 space-y-2">
          <div className="text-[12px] font-medium">Escanear páginas por URL</div>
          <p className="text-[11px] text-muted">Una ruta por línea, formato <code>/ruta | Nombre</code>. Vacío = solo la URL base. Ideal para pantallas simples que se abren con una dirección fija.</p>
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
      )}

      {/* Inventario del catálogo. */}
      {pages.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[12px] font-medium">Pantallas del catálogo ({pages.length})</div>
            <div className="flex items-center gap-2">
              {known.length > 0 && (
                <button className="btn-ghost text-[11px]" onClick={() => scan(known, "merge", "all")} disabled={!!scanning} title="Vuelve a escanear todas las páginas ya catalogadas (refresca los selectores)">
                  {scanning === "all" ? <span className="flex items-center gap-2"><Spinner /> Re-escaneando…</span> : "Re-escanear las páginas por URL"}
                </button>
              )}
              <button className="btn-ghost text-[11px] text-muted hover:text-red-300" onClick={() => setConfirmDel("__all__")} disabled={!!scanning || busyDel} title="Borra TODAS las pantallas y selectores del catálogo (para empezar de cero)">Vaciar catálogo</button>
            </div>
          </div>
          {/* Confirmación de borrado (una pantalla o todo). Solo afecta el catálogo de selectores. */}
          {confirmDel && (
            <div className="flex items-center gap-2 flex-wrap rounded-md border border-red-500/50 bg-red-500/10 px-3 py-2 text-[12px] text-red-100">
              <span>
                {confirmDel === "__all__"
                  ? "¿Vaciar TODO el catálogo (todas las pantallas y sus selectores)?"
                  : <>¿Eliminar la pantalla «<b>{confirmDel}</b>» y sus selectores?</>}{" "}
                Después la re-escaneás. No toca suites, recorridos ni histórico.
              </span>
              <button className="rounded bg-red-500/80 hover:bg-red-500 text-white px-2 py-0.5" onClick={() => removeCatalog(confirmDel)} disabled={busyDel}>{busyDel ? "Eliminando…" : "Sí, eliminar"}</button>
              <button className="btn-ghost" onClick={() => setConfirmDel(null)} disabled={busyDel}>Cancelar</button>
            </div>
          )}
          {msg && <p className="text-[11px] text-muted">{msg}</p>}
          {groupByBreadcrumb(pages).map((g) => {
            if (g.items.length === 1 && g.items[0].sub === "") {
              // Página simple (sin breadcrumb) → tarjeta suelta.
              const v = view(g.items[0].page);
              if (!v.visible) return null;
              return (
                <PageCard key={g.root} page={g.items[0].page} elements={v.elements} open={v.open} onToggle={() => toggle(g.items[0].page)}
                  busy={scanning === g.root} disabled={!!scanning} onRescan={() => scan([{ route: g.items[0].page.route, name: g.root }], "merge", g.root)}
                  onDelete={() => setConfirmDel(g.items[0].page.name)} />
              );
            }
            // Grupo de un recorrido/asistente → título de la raíz + pantallas anidadas.
            const visibleItems = g.items.filter(({ page }) => view(page).visible);
            if (visibleItems.length === 0) return null;
            return (
              <div key={g.root} className="rounded-lg border border-border/70 p-2 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-[12px] font-medium text-white/90">{g.root} <span className="text-[11px] text-muted">· recorrido · {g.items.length} pantalla(s)</span></div>
                  {onEditRecorrido && (
                    <button className="btn-ghost text-[11px]" onClick={() => onEditRecorrido(g.root)} title="Abrir este recorrido en la pestaña Recorridos (editar etapas / grabar / crear prueba)">Ver recorrido</button>
                  )}
                </div>
                <div className="pl-3 border-l border-border/50 space-y-2">
                  {visibleItems.map(({ page: p, sub }, i) => {
                    const v = view(p);
                    return <PageCard key={i} page={p} displayName={sub || g.root} elements={v.elements} open={v.open} onToggle={() => toggle(p)} canRescan={false} busy={false} disabled={!!scanning} onRescan={() => {}} onDelete={() => setConfirmDel(p.name)} />;
                  })}
                </div>
              </div>
            );
          })}
          {searching && matchCount === 0 && <p className="text-[11px] text-muted">Ningún elemento coincide con «{query}».</p>}
        </div>
      )}
      {pages.length === 0 && (
        <p className="text-[11px] text-muted rounded-lg border border-dashed border-border p-3">
          Todavía no capturaste selectores. Escaneá una pantalla simple con <b>«Escanear una página (URL)»</b>, o grabá
          un asistente de varias pantallas en la pestaña <b>Recorridos</b>.
        </p>
      )}
      {pages.length === 0 && msg && <p className="text-[11px] text-muted">{msg}</p>}
    </div>
  );
}

function PageCard({ page, displayName, elements, open, onToggle, canRescan = true, busy, disabled, onRescan, onDelete }: { page: SelectorCatalogPage; displayName?: string; elements: SelectorCatalogPage["elements"]; open: boolean; onToggle: () => void; canRescan?: boolean; busy: boolean; disabled: boolean; onRescan: () => void; onDelete: () => void }) {
  const isLogin = LOGIN_PAGE.test(page.name);
  const when = localWhen(page.scannedAt);
  const total = page.elements.length;
  const showing = elements.length;
  return (
    <div className="rounded-lg border border-border bg-panel2/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button className="flex items-center gap-2 text-left flex-1" onClick={onToggle}>
          <span className="text-muted w-4 shrink-0">{open ? "▾" : "▸"}</span>
          <span className="text-sm font-medium">
            {displayName ?? page.name} <span className="text-[11px] text-muted font-mono">{page.route}</span>{" "}
            <span className="text-[11px] text-muted">· {showing < total ? `${showing}/${total}` : total} selector(es)</span>
            {when && <span className="text-[11px] text-muted"> · escaneada {when}</span>}
          </span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {!isLogin && canRescan && (
            <button className="btn-ghost text-[11px]" onClick={onRescan} disabled={disabled} title="Volver a escanear solo esta página">
              {busy ? <span className="flex items-center gap-2"><Spinner /> Actualizando…</span> : "Actualizar esta página"}
            </button>
          )}
          <button className="btn-ghost text-[11px] text-muted hover:text-red-300" onClick={onDelete} disabled={disabled} title="Quitar esta pantalla (y sus selectores) del catálogo">Eliminar</button>
        </div>
      </div>
      {open && (
        total === 0 ? (
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
                {elements.map((e, j) => (
                  <tr key={j} className="border-t border-border/50">
                    <td className="py-1 pr-3 font-mono text-accent">{e.alias}</td>
                    <td className="py-1 pr-3">{e.by}</td>
                    <td className="py-1 font-mono">{e.by === "role" ? `${e.role} · ${e.name}` : e.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
