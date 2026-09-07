"use client";

import { useState } from "react";
import { Select } from "@/components/Select";
import { RunPicker, type RunOption } from "./RunPicker";
import { ItemThread } from "./ItemThread";
import {
  type QaItem, type QaItemDraft, type QaStatus, type QaPriority, type QaType, type QaSeverity, type RunLink,
  STATUS_LABELS, PRIORITY_LABELS, TYPE_META, SEVERITY_LABELS,
} from "./types";

// Editor (alta/edición) de un pendiente de Seguimiento QA. Devuelve el cuerpo listo para PUT
// /api/qa-items. Campos ricos (tipo, severidad, etiquetas, fecha límite) además de estado/prioridad/
// responsable/HU de ADO/corrida vinculada. El `reporter` (quién lo creó) NO se edita: se conserva.

export type { QaItem, QaItemDraft };

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
  const [status, setStatus] = useState<QaStatus>(item.status);
  const [priority, setPriority] = useState<QaPriority>(item.priority);
  const [type, setType] = useState<QaType>(item.type);
  const [severity, setSeverity] = useState<QaSeverity>(item.severity);
  const [labelsText, setLabelsText] = useState((item.labels ?? []).join(", "));
  const [dueDate, setDueDate] = useState(item.due_date ?? "");
  const [assignee, setAssignee] = useState(item.assignee);
  const [adoWi, setAdoWi] = useState(item.ado_wi);
  const [linkRuns, setLinkRuns] = useState<RunLink[]>(item.link_runs ?? []);

  const linkedKeys = new Set(linkRuns.map((r) => `${r.kind}:${r.id}`));
  function pickRun(o: RunOption) {
    if (linkedKeys.has(`${o.kind}:${o.id}`)) return;
    setLinkRuns((prev) => [...prev, { kind: o.kind, id: o.id, title: o.title, sub: o.sub, href: o.href, when: o.when, status: o.status }]);
  }
  function removeRun(key: string) { setLinkRuns((prev) => prev.filter((r) => `${r.kind}:${r.id}` !== key)); }

  function submit() {
    if (!title.trim()) return;
    const labels = labelsText.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const first = linkRuns[0]; // se conserva el vínculo simple (legacy) = primera corrida, por compat
    onSave({
      id: item.id, title: title.trim(), notes, status, priority, type, severity,
      labels, dueDate: dueDate || null, reporter: item.reporter, assignee: assignee.trim(),
      adoWi: adoWi.trim(),
      linkRunKind: first?.kind ?? "", linkRunId: first?.id ?? "",
      linkRunMeta: first ? { title: first.title, sub: first.sub, href: first.href, when: first.when, status: first.status } : {},
      linkRuns, position: item.position,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-white">{item.title ? "Editar pendiente" : "Nuevo pendiente"}</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="label">Título</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" autoFocus />
          </label>
          <label className="block text-sm">
            <span className="label">Notas / descripción</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="input" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="label">Tipo</span>
              <Select value={type} onChange={(v) => setType(v as QaType)} className="w-full"
                options={(Object.keys(TYPE_META) as QaType[]).map((k) => ({ value: k, label: TYPE_META[k].label }))} />
            </label>
            <label className="block text-sm">
              <span className="label">Estado</span>
              <Select value={status} onChange={(v) => setStatus(v as QaStatus)} className="w-full"
                options={(Object.keys(STATUS_LABELS) as QaStatus[]).map((k) => ({ value: k, label: STATUS_LABELS[k] }))} />
            </label>
            <label className="block text-sm">
              <span className="label">Prioridad</span>
              <Select value={priority} onChange={(v) => setPriority(v as QaPriority)} className="w-full"
                options={(Object.keys(PRIORITY_LABELS) as QaPriority[]).map((k) => ({ value: k, label: PRIORITY_LABELS[k] }))} />
            </label>
            <label className="block text-sm">
              <span className="label">Severidad</span>
              <Select value={severity} onChange={(v) => setSeverity(v as QaSeverity)} className="w-full"
                options={(Object.keys(SEVERITY_LABELS) as QaSeverity[]).map((k) => ({ value: k, label: SEVERITY_LABELS[k] }))} />
            </label>
            <label className="block text-sm">
              <span className="label">Responsable</span>
              <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="email o nombre" className="input" />
            </label>
            <label className="block text-sm">
              <span className="label">Fecha límite</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="label">Etiquetas (separadas por coma)</span>
            <input value={labelsText} onChange={(e) => setLabelsText(e.target.value)} placeholder="regresión, login, urgente" className="input" />
          </label>
          <label className="block text-sm">
            <span className="label">HU/Feature de ADO</span>
            <input value={adoWi} onChange={(e) => setAdoWi(e.target.value)} placeholder="ej: 10618" className="input" />
          </label>
          <div className="text-sm">
            <span className="label">Corridas vinculadas {linkRuns.length > 0 && <span className="text-muted">({linkRuns.length})</span>}</span>
            <div className="mt-1 space-y-1.5">
              {linkRuns.map((r) => {
                const failed = r.status === "failed" || r.status === "error";
                return (
                  <div key={`${r.kind}:${r.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-panel2 px-2 py-1.5">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="rounded bg-border px-1 text-[10px] text-gray-200">{r.kind === "run" ? "kit" : "regresión"}</span>
                        {r.href
                          ? <a href={r.href} className="truncate text-xs font-medium text-accent hover:underline">{r.title}</a>
                          : <span className="truncate text-xs font-medium text-gray-100">{r.title}</span>}
                        <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${failed ? "bg-red-900 text-red-300" : "bg-green-900 text-green-300"}`}>{r.status || "—"}</span>
                      </span>
                      {r.sub && <span className="block truncate text-[11px] text-muted">{r.sub}</span>}
                    </span>
                    <button type="button" onClick={() => removeRun(`${r.kind}:${r.id}`)} className="shrink-0 text-xs text-red-300 hover:underline">Quitar</button>
                  </div>
                );
              })}
              <RunPicker onPick={pickRun} exclude={linkedKeys} />
            </div>
          </div>
        </div>
        {item.created_at && <ItemThread itemId={item.id} />}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost">Cancelar</button>
          <button onClick={submit} disabled={saving || !title.trim()} className="btn-primary">
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
