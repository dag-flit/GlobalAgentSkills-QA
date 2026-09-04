"use client";

import { useState } from "react";
import { RunPicker, type RunOption } from "./RunPicker";

// Editor (alta/edición) de un pendiente de Seguimiento QA. Devuelve el cuerpo listo para PUT
// /api/qa-items. El vínculo a una corrida del kit se agrega en un segundo incremento (acá se
// conservan sus campos si ya venían para no perderlos al editar).

export interface QaItem {
  id: string;
  title: string;
  notes: string;
  status: "todo" | "doing" | "blocked" | "review" | "done";
  priority: "alta" | "media" | "baja";
  assignee: string;
  ado_wi: string;
  link_run_kind: string;
  link_run_id: string;
  link_run_meta: Record<string, unknown>;
  position: number;
}

export interface QaItemDraft {
  id: string; title: string; notes: string; status: QaItem["status"]; priority: QaItem["priority"];
  assignee: string; adoWi: string; linkRunKind: string; linkRunId: string;
  linkRunMeta: Record<string, unknown>; position: number;
}

const STATUS_LABELS: Record<QaItem["status"], string> = {
  todo: "Pendiente", doing: "En curso", blocked: "Bloqueado", review: "En revisión", done: "Hecho",
};

export function ItemEditor({
  item, onSave, onCancel, saving,
}: {
  item: QaItem;
  onSave: (d: QaItemDraft) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);
  const [status, setStatus] = useState<QaItem["status"]>(item.status);
  const [priority, setPriority] = useState<QaItem["priority"]>(item.priority);
  const [assignee, setAssignee] = useState(item.assignee);
  const [adoWi, setAdoWi] = useState(item.ado_wi);
  const [linkKind, setLinkKind] = useState(item.link_run_kind);
  const [linkId, setLinkId] = useState(item.link_run_id);
  const [linkMeta, setLinkMeta] = useState<Record<string, unknown>>(item.link_run_meta ?? {});

  const cls = "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm";

  function pickRun(o: RunOption) {
    setLinkKind(o.kind); setLinkId(o.id);
    setLinkMeta({ title: o.title, sub: o.sub, href: o.href, when: o.when, status: o.status });
  }
  function clearRun() { setLinkKind(""); setLinkId(""); setLinkMeta({}); }

  function submit() {
    if (!title.trim()) return;
    onSave({
      id: item.id, title: title.trim(), notes, status, priority, assignee: assignee.trim(),
      adoWi: adoWi.trim(), linkRunKind: linkKind, linkRunId: linkId,
      linkRunMeta: linkMeta, position: item.position,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onCancel}>
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-neutral-800">{item.title ? "Editar pendiente" : "Nuevo pendiente"}</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-neutral-600">Título</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={cls} autoFocus />
          </label>
          <label className="block text-sm">
            <span className="text-neutral-600">Notas</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={cls} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-neutral-600">Estado</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as QaItem["status"])} className={cls}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-neutral-600">Prioridad</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value as QaItem["priority"])} className={cls}>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-neutral-600">Responsable</span>
              <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="email o nombre" className={cls} />
            </label>
            <label className="block text-sm">
              <span className="text-neutral-600">HU/Feature de ADO</span>
              <input value={adoWi} onChange={(e) => setAdoWi(e.target.value)} placeholder="ej: 10618" className={cls} />
            </label>
          </div>
          <div className="text-sm">
            <span className="text-neutral-600">Corrida vinculada</span>
            <div className="mt-1">
              {linkId ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5">
                  <span className="min-w-0 truncate text-xs text-neutral-700">
                    <span className="mr-1 rounded bg-neutral-200 px-1 text-[10px]">{linkKind === "run" ? "kit" : "regresión"}</span>
                    {String((linkMeta as { title?: string }).title ?? linkId)}
                  </span>
                  <button type="button" onClick={clearRun} className="shrink-0 text-xs text-red-600">Quitar</button>
                </div>
              ) : (
                <RunPicker onPick={pickRun} />
              )}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm">Cancelar</button>
          <button onClick={submit} disabled={saving || !title.trim()}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
