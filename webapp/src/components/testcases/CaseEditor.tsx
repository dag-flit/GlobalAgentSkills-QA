"use client";

import { useState } from "react";
import { Select } from "@/components/Select";
import { type TestCase, type TestCaseDraft, type TestPriority, type TestStep, type TestSuite, PRIORITY_LABELS } from "./types";

// Editor (alta/edición) de un caso de prueba: datos + PASOS (acción / resultado esperado), en una tabla
// editable con agregar / quitar / mover. Devuelve el cuerpo listo para PUT /api/test-cases.
export function CaseEditor({
  item, suites, onSave, onCancel, saving,
}: {
  item: TestCase;
  suites: TestSuite[];
  onSave: (d: TestCaseDraft) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState(item.title);
  const [suiteId, setSuiteId] = useState<string>(item.suite_id ?? "");
  const [preconditions, setPreconditions] = useState(item.preconditions);
  const [priority, setPriority] = useState<TestPriority>(item.priority);
  const [tagsText, setTagsText] = useState((item.tags ?? []).join(", "));
  const [adoWi, setAdoWi] = useState(item.ado_wi);
  const [steps, setSteps] = useState<TestStep[]>(item.steps.length ? item.steps : [{ action: "", expected: "" }]);

  function setStep(i: number, patch: Partial<TestStep>) { setSteps((p) => p.map((s, k) => (k === i ? { ...s, ...patch } : s))); }
  function addStep() { setSteps((p) => [...p, { action: "", expected: "" }]); }
  function removeStep(i: number) { setSteps((p) => (p.length > 1 ? p.filter((_, k) => k !== i) : p)); }
  function moveStep(i: number, d: -1 | 1) {
    setSteps((p) => { const j = i + d; if (j < 0 || j >= p.length) return p; const a = [...p]; [a[i], a[j]] = [a[j], a[i]]; return a; });
  }

  function submit() {
    if (!title.trim()) return;
    const tags = tagsText.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const cleanSteps = steps.map((s) => ({ action: s.action.trim(), expected: s.expected.trim() })).filter((s) => s.action || s.expected);
    onSave({
      id: item.id, suiteId: suiteId || null, title: title.trim(), preconditions, priority,
      tags, adoWi: adoWi.trim(), steps: cleanSteps, position: item.position,
    });
  }

  const cell = "w-full rounded-lg border border-border bg-panel2 px-2 py-1 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-white">{item.title ? "Editar caso de prueba" : "Nuevo caso de prueba"}</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="label">Título</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" autoFocus />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="label">Suite</span>
              <Select value={suiteId} onChange={setSuiteId} className="w-full"
                options={[{ value: "", label: "— Sin suite —" }, ...suites.map((s) => ({ value: s.id, label: s.name }))]} />
            </label>
            <label className="block text-sm">
              <span className="label">Prioridad</span>
              <Select value={priority} onChange={(v) => setPriority(v as TestPriority)} className="w-full"
                options={(Object.keys(PRIORITY_LABELS) as TestPriority[]).map((k) => ({ value: k, label: PRIORITY_LABELS[k] }))} />
            </label>
            <label className="block text-sm">
              <span className="label">Etiquetas (coma)</span>
              <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="login, regresión" className="input" />
            </label>
            <label className="block text-sm">
              <span className="label">HU/Feature de ADO</span>
              <input value={adoWi} onChange={(e) => setAdoWi(e.target.value)} placeholder="ej: 10618" className="input" />
            </label>
          </div>
          <label className="block text-sm">
            <span className="label">Precondiciones</span>
            <textarea value={preconditions} onChange={(e) => setPreconditions(e.target.value)} rows={2} className="input" placeholder="Estado/datos necesarios antes de ejecutar" />
          </label>

          <div>
            <div className="flex items-center justify-between">
              <span className="label mb-0">Pasos ({steps.length})</span>
              <button type="button" onClick={addStep} className="rounded-lg border border-border px-2 py-0.5 text-xs text-muted hover:bg-panel2">Agregar paso</button>
            </div>
            <table className="mt-1 w-full border-collapse text-xs">
              <thead>
                <tr className="text-left text-muted">
                  <th className="w-6 px-1 py-1">#</th>
                  <th className="px-1 py-1">Acción</th>
                  <th className="px-1 py-1">Resultado esperado</th>
                  <th className="w-16 px-1 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-1 py-1 text-muted">{i + 1}</td>
                    <td className="px-1 py-1"><textarea value={s.action} onChange={(e) => setStep(i, { action: e.target.value })} rows={2} className={cell} placeholder="Qué hace el tester" /></td>
                    <td className="px-1 py-1"><textarea value={s.expected} onChange={(e) => setStep(i, { expected: e.target.value })} rows={2} className={cell} placeholder="Qué debería pasar" /></td>
                    <td className="px-1 py-1">
                      <div className="flex gap-0.5">
                        <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="rounded px-1 text-muted hover:bg-panel2 disabled:opacity-30">↑</button>
                        <button type="button" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1} className="rounded px-1 text-muted hover:bg-panel2 disabled:opacity-30">↓</button>
                        <button type="button" onClick={() => removeStep(i)} className="rounded px-1 text-red-300 hover:bg-panel2">✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost">Cancelar</button>
          <button onClick={submit} disabled={saving || !title.trim()} className="btn-primary">Guardar</button>
        </div>
      </div>
    </div>
  );
}
