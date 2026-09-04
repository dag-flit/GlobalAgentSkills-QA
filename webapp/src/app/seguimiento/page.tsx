"use client";

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { ItemEditor, type QaItem, type QaItemDraft } from "@/components/seguimiento/ItemEditor";

// Página «Seguimiento QA»: tablero de pendientes por tenant (RLS). 5 columnas (Pendiente / En curso /
// Bloqueado / En revisión / Hecho). Híbrido: cada pendiente puede referenciar una HU de ADO (enlace
// navegable si el tenant tiene Azure configurado). El vínculo a corridas del kit llega en un 2º paso.

const COLUMNS: { key: QaItem["status"]; label: string; accent: string }[] = [
  { key: "todo", label: "Pendiente", accent: "border-t-neutral-400" },
  { key: "doing", label: "En curso", accent: "border-t-blue-400" },
  { key: "blocked", label: "Bloqueado", accent: "border-t-red-400" },
  { key: "review", label: "En revisión", accent: "border-t-amber-400" },
  { key: "done", label: "Hecho", accent: "border-t-green-400" },
];
const PRIO: Record<QaItem["priority"], string> = {
  alta: "bg-red-100 text-red-700", media: "bg-neutral-100 text-neutral-600", baja: "bg-neutral-100 text-neutral-400",
};

function blankItem(): QaItem {
  const id = (crypto as any).randomUUID ? crypto.randomUUID() : `q-${Date.now()}`;
  return { id, title: "", notes: "", status: "todo", priority: "media", assignee: "",
    ado_wi: "", link_run_kind: "", link_run_id: "", link_run_meta: {}, position: 0 };
}

export default function SeguimientoPage() {
  const [items, setItems] = useState<QaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<QaItem | null>(null);
  const [ado, setAdo] = useState<{ orgUrl: string; project: string } | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [it, cfg] = await Promise.all([
        fetch("/api/qa-items").then((r) => r.json()),
        fetch("/api/config").then((r) => r.json()).catch(() => null),
      ]);
      if (!it.ok) throw new Error(it.error || "No se pudieron cargar los pendientes.");
      setItems(it.items ?? []);
      const az = cfg?.tracker?.azure;
      setAdo(az?.orgUrl && az?.project ? { orgUrl: az.orgUrl, project: az.project } : null);
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const byStatus = useMemo(() => {
    const m: Record<string, QaItem[]> = { todo: [], doing: [], blocked: [], review: [], done: [] };
    for (const i of items) (m[i.status] ?? m.todo).push(i);
    return m;
  }, [items]);

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

  async function move(i: QaItem, status: QaItem["status"]) {
    await save({ id: i.id, title: i.title, notes: i.notes, status, priority: i.priority,
      assignee: i.assignee, adoWi: i.ado_wi, linkRunKind: i.link_run_kind, linkRunId: i.link_run_id,
      linkRunMeta: i.link_run_meta ?? {}, position: i.position });
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

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Seguimiento QA</h1>
          <p className="mt-1 text-sm text-neutral-500">Tus pendientes de QA, por estado. Vinculá una HU de ADO cuando aplique.</p>
        </div>
        <button onClick={() => setEditing(blankItem())}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white">+ Nuevo pendiente</button>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="pt-10"><Spinner /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
          {COLUMNS.map((col) => (
            <div key={col.key} className={`rounded-lg border border-t-4 ${col.accent} border-neutral-200 bg-neutral-50/50 p-2`}>
              <div className="flex items-center justify-between px-1 pb-2">
                <h2 className="text-sm font-semibold text-neutral-700">{col.label}</h2>
                <span className="text-xs text-neutral-400">{byStatus[col.key]?.length ?? 0}</span>
              </div>
              <div className="space-y-2">
                {(byStatus[col.key] ?? []).map((i) => {
                  const url = adoUrl(i.ado_wi);
                  return (
                    <div key={i.id} className="rounded-md border border-neutral-200 bg-white p-3 text-sm shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-neutral-800">{i.title}</p>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${PRIO[i.priority]}`}>{i.priority}</span>
                      </div>
                      {i.notes && <p className="mt-1 line-clamp-3 text-xs text-neutral-500">{i.notes}</p>}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                        {i.assignee && <span>👤 {i.assignee}</span>}
                        {i.ado_wi && (url
                          ? <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">HU #{i.ado_wi}</a>
                          : <span>HU #{i.ado_wi}</span>)}
                        {i.link_run_id && (() => {
                          const m = (i.link_run_meta ?? {}) as { title?: string; href?: string | null };
                          const label = `🏃 ${m.title ?? "corrida"}`;
                          return m.href
                            ? <a href={m.href} className="text-blue-600 hover:underline">{label}</a>
                            : <span title="corrida de regresión (sin página propia)">{label}</span>;
                        })()}
                      </div>
                      <div className="mt-2 flex items-center gap-1 border-t border-neutral-100 pt-2">
                        <select value={i.status} onChange={(e) => move(i, e.target.value as QaItem["status"])}
                          disabled={saving} className="rounded border border-neutral-200 px-1 py-0.5 text-xs">
                          {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                        <button onClick={() => setEditing(i)} className="ml-auto rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:bg-neutral-100">Editar</button>
                        <button onClick={() => remove(i.id)} disabled={saving} className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50">Borrar</button>
                      </div>
                    </div>
                  );
                })}
                {(byStatus[col.key] ?? []).length === 0 && <p className="px-1 py-2 text-xs text-neutral-300">—</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <ItemEditor item={editing} onSave={save} onCancel={() => setEditing(null)} saving={saving} />}
    </div>
  );
}
