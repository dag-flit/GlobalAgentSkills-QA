"use client";

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { ItemEditor } from "@/components/seguimiento/ItemEditor";
import { BoardView } from "@/components/seguimiento/BoardView";
import { TableView } from "@/components/seguimiento/TableView";
import { Filters, EMPTY_FILTER, type FilterState } from "@/components/seguimiento/Filters";
import { Metrics } from "@/components/seguimiento/Metrics";
import { AdoImport } from "@/components/seguimiento/AdoImport";
import { Select } from "@/components/Select";
import { type QaItem, type QaItemDraft, type QaStatus, blankItem, itemToDraft } from "@/components/seguimiento/types";
import { toCsv, toHtml } from "@/lib/qa/seguimientoReport";

const PAGE_SIZES = [25, 50, 100, 200];

// Descarga un archivo generado en el cliente (Blob + <a download>). Sirve para CSV/HTML del reporte.
function download(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Página «Seguimiento QA»: tracker de pendientes por PROYECTO (RLS). Tablero (5 columnas) o vista tabla,
// con campos ricos (tipo/severidad/etiquetas/fecha límite), filtros y búsqueda. Híbrido: cada pendiente
// puede referenciar una HU de ADO (navegable) y una corrida del kit/regresión.

export default function SeguimientoPage() {
  const [items, setItems] = useState<QaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<QaItem | null>(null);
  const [ado, setAdo] = useState<{ orgUrl: string; project: string } | null>(null);
  const [myEmail, setMyEmail] = useState("");
  const [projectName, setProjectName] = useState("proyecto");
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [view, setView] = useState<"board" | "table">("board");
  const [showMetrics, setShowMetrics] = useState(false);
  const [showAdoImport, setShowAdoImport] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);

  useEffect(() => {
    try {
      const v = localStorage.getItem("qof-seguimiento-view"); if (v === "table" || v === "board") setView(v);
      const ps = Number(localStorage.getItem("qof-seguimiento-pagesize")); if (PAGE_SIZES.includes(ps)) setPageSize(ps);
    } catch { /* noop */ }
  }, []);
  function changeView(v: "board" | "table") {
    setView(v);
    try { localStorage.setItem("qof-seguimiento-view", v); } catch { /* noop */ }
  }
  function changePageSize(n: number) {
    setPageSize(n); setPage(0);
    try { localStorage.setItem("qof-seguimiento-pagesize", String(n)); } catch { /* noop */ }
  }
  // Volver a la página 1 cuando cambian los filtros (evita quedar en una página vacía).
  useEffect(() => { setPage(0); }, [filter]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [itRes, cfg, me] = await Promise.all([
        fetch("/api/qa-items"),
        fetch("/api/config").then((r) => r.json()).catch(() => null),
        fetch("/api/auth/me").then((r) => r.json()).catch(() => null),
      ]);
      // Un 500 suele venir con cuerpo vacío → r.json() lanzaría "Unexpected end of JSON input".
      // Se lee como texto y se da un mensaje claro (causa típica: falta aplicar una migración de BD).
      if (!itRes.ok) {
        await itRes.text().catch(() => "");
        throw new Error(
          itRes.status === 500
            ? "El servidor falló al cargar los pendientes (500). Causa habitual: falta aplicar la última migración de base de datos (db/migrate.mjs)."
            : `No se pudieron cargar los pendientes (HTTP ${itRes.status}).`,
        );
      }
      const it = await itRes.json().catch(() => ({ ok: false, error: "Respuesta inválida del servidor." }));
      if (!it.ok) throw new Error(it.error || "No se pudieron cargar los pendientes.");
      setItems(it.items ?? []);
      const az = cfg?.tracker?.azure;
      setAdo(az?.orgUrl && az?.project ? { orgUrl: az.orgUrl, project: az.project } : null);
      setMyEmail(me?.user?.email ?? "");
      const active = (me?.tenants ?? []).find((t: { id: string; name: string }) => t.id === me?.tenantId);
      if (active?.name) setProjectName(active.name);
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const assignees = useMemo(
    () => Array.from(new Set(items.map((i) => i.assignee).filter(Boolean))).sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const q = filter.q.trim().toLowerCase();
    return items.filter((i) => {
      if (filter.type !== "all" && i.type !== filter.type) return false;
      if (filter.status !== "all" && i.status !== filter.status) return false;
      if (filter.priority !== "all" && i.priority !== filter.priority) return false;
      if (filter.assignee && i.assignee !== filter.assignee) return false;
      if (q) {
        const hay = `${i.title} ${i.notes} ${(i.labels ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter]);

  function adoUrl(wi: string): string | null {
    if (!ado || !wi) return null;
    return `${ado.orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(ado.project)}/_workitems/edit/${encodeURIComponent(wi)}`;
  }

  async function save(d: QaItemDraft) {
    setSaving(true); setError(null);
    try {
      const r = await fetch("/api/qa-items", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar.");
      setEditing(null); await load();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setSaving(false); }
  }

  async function move(i: QaItem, status: QaStatus) {
    await save({ ...itemToDraft(i), status });
  }

  async function remove(id: string) {
    setSaving(true); setError(null);
    try {
      const r = await fetch("/api/qa-items", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo eliminar.");
      await load();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setSaving(false); }
  }

  const stamp = () => new Date().toLocaleString("es-CO");
  function exportCsv() { download("seguimiento-qa.csv", "text/csv;charset=utf-8", toCsv(filtered)); }
  function exportHtml() { download("seguimiento-qa.html", "text/html;charset=utf-8", toHtml(filtered, projectName, stamp())); }

  async function resync() {
    setResyncing(true); setError(null);
    try {
      const r = await fetch("/api/qa-items/ado-resync", { method: "POST" });
      const j = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo actualizar desde ADO.");
      await load();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setResyncing(false); }
  }
  const hasAdoItems = useMemo(() => items.some((i) => i.source === "ado"), [items]);

  async function clearAdo() {
    const n = items.filter((i) => i.source === "ado").length;
    if (!confirm(`¿Quitar los ${n} pendiente(s) importados de ADO? (los pendientes locales no se tocan)`)) return;
    setClearing(true); setError(null);
    try {
      const r = await fetch("/api/qa-items/ado-clear", { method: "POST" });
      const j = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo quitar la importación.");
      await load();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setClearing(false); }
  }

  // Paginación sobre el conjunto filtrado (aplica a tablero y tabla).
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, pageCount - 1);
  const paged = useMemo(() => filtered.slice(curPage * pageSize, curPage * pageSize + pageSize), [filtered, curPage, pageSize]);

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Seguimiento QA</h1>
          <p className="mt-1 text-sm text-muted">
            Tus pendientes de QA de este proyecto. Tablero o tabla, con tipo, severidad, etiquetas y fecha límite.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowMetrics((v) => !v)} className="btn-ghost text-xs">
            {showMetrics ? "Ocultar métricas" : "Métricas"}
          </button>
          <button onClick={exportCsv} className="btn-ghost text-xs">Exportar CSV</button>
          <button onClick={exportHtml} className="btn-ghost text-xs">Exportar HTML</button>
          {hasAdoItems && (
            <button onClick={resync} disabled={resyncing} className="btn-ghost text-xs">
              {resyncing ? "Actualizando…" : "Actualizar desde ADO"}
            </button>
          )}
          {hasAdoItems && (
            <button onClick={clearAdo} disabled={clearing} className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-red-300 hover:bg-panel2 disabled:opacity-50">
              {clearing ? "Quitando…" : "Quitar importados"}
            </button>
          )}
          <button onClick={() => setShowAdoImport(true)} className="btn-ghost text-xs">Importar de ADO</button>
          <button onClick={() => setEditing(blankItem(myEmail))} className="btn-primary">Nuevo pendiente</button>
        </div>
      </header>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {loading ? (
        <div className="pt-10"><Spinner /></div>
      ) : (
        <>
          {showMetrics && <Metrics items={items} />}
          <Filters value={filter} onChange={setFilter} view={view} onView={changeView} assignees={assignees} />

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <span>{filtered.length} de {items.length} pendiente(s)</span>
            <span className="flex items-center gap-1">
              Por página
              <Select value={String(pageSize)} onChange={(v) => changePageSize(Number(v))} className="text-xs py-1"
                options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))} />
            </span>
            {pageCount > 1 && (
              <span className="ml-auto flex items-center gap-2">
                <button onClick={() => setPage(Math.max(0, curPage - 1))} disabled={curPage === 0}
                  className="rounded-lg border border-border px-2 py-1 hover:bg-panel2 disabled:opacity-40">Anterior</button>
                <span>Página {curPage + 1} de {pageCount}</span>
                <button onClick={() => setPage(Math.min(pageCount - 1, curPage + 1))} disabled={curPage >= pageCount - 1}
                  className="rounded-lg border border-border px-2 py-1 hover:bg-panel2 disabled:opacity-40">Siguiente</button>
              </span>
            )}
          </div>

          {view === "board" ? (
            <BoardView items={paged} adoUrl={adoUrl} onEdit={setEditing} onMove={move} onRemove={remove} saving={saving} />
          ) : (
            <TableView items={paged} adoUrl={adoUrl} onEdit={setEditing} />
          )}
        </>
      )}

      {editing && <ItemEditor item={editing} onSave={save} onCancel={() => setEditing(null)} saving={saving} />}
      {showAdoImport && <AdoImport onClose={() => setShowAdoImport(false)} onDone={load} />}
    </div>
  );
}
