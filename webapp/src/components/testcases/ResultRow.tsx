"use client";

import { useState } from "react";
import { type TestResult, type ResultStatus, RESULT_META, deriveCaseStatus } from "./runTypes";

const CHOICES: { s: ResultStatus; label: string }[] = [
  { s: "pass", label: "Pasó" }, { s: "fail", label: "Falló" }, { s: "blocked", label: "Bloqueado" }, { s: "skipped", label: "Omitir" },
];

function StatusButtons({ value, onSet }: { value: ResultStatus; onSet: (s: ResultStatus) => void }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {CHOICES.map(({ s, label }) => (
        <button key={s} type="button" onClick={() => onSet(s)}
          className={`rounded px-1.5 py-0.5 text-[10px] ${value === s ? RESULT_META[s].cls : "bg-panel2 text-muted hover:text-white"}`}>{label}</button>
      ))}
    </span>
  );
}

// Fila de ejecución de UN caso dentro de una corrida: estado por paso (o del caso si no tiene pasos),
// resultado real y notas. Guarda con «Guardar». El estado del caso se DERIVA de los pasos si los hay.
export function ResultRow({ result, adoUrl, onSaved }: { result: TestResult; adoUrl: (wi: string) => string | null; onSaved: () => void }) {
  const steps = result.steps ?? [];
  const [stepResults, setStepResults] = useState<ResultStatus[]>(
    steps.length ? steps.map((_, i) => result.step_results?.[i] ?? "untested") : [],
  );
  const [manual, setManual] = useState<ResultStatus>(result.status);
  const [actual, setActual] = useState(result.actual_result);
  const [notes, setNotes] = useState(result.notes);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const caseStatus: ResultStatus = steps.length ? deriveCaseStatus(stepResults) : manual;
  const url = adoUrl(result.ado_wi);

  function setStep(i: number, s: ResultStatus) { setStepResults((p) => p.map((x, k) => (k === i ? s : x))); setDirty(true); }

  async function save() {
    setSaving(true);
    try {
      const r = await fetch("/api/test-results", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: result.id, status: caseStatus, stepResults, actualResult: actual, notes }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      if (r.ok && j.ok) { setDirty(false); onSaved(); }
    } finally { setSaving(false); }
  }

  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="font-medium text-gray-100">{result.case_title}</span>
          {result.ado_wi && (url
            ? <a href={url} target="_blank" rel="noreferrer" className="ml-2 text-xs text-accent hover:underline">HU #{result.ado_wi}</a>
            : <span className="ml-2 text-xs text-muted">HU #{result.ado_wi}</span>)}
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${RESULT_META[caseStatus].cls}`}>{RESULT_META[caseStatus].label}</span>
          {steps.length === 0 && <StatusButtons value={manual} onSet={(s) => { setManual(s); setDirty(true); }} />}
          <button onClick={save} disabled={saving || !dirty} className="btn-primary py-1 text-xs">{saving ? "…" : "Guardar"}</button>
        </div>
      </div>

      {steps.length > 0 && (
        <table className="mt-2 w-full border-collapse text-xs">
          <tbody>
            {steps.map((st, i) => (
              <tr key={i} className="align-top border-t border-border">
                <td className="w-5 py-1 pr-1 text-muted">{i + 1}</td>
                <td className="py-1 pr-2 text-gray-200">{st.action}<div className="text-[11px] text-muted">➜ {st.expected}</div></td>
                <td className="w-52 py-1"><StatusButtons value={stepResults[i]} onSet={(s) => setStep(i, s)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block text-xs">
          <span className="text-muted">Resultado real</span>
          <textarea value={actual} onChange={(e) => { setActual(e.target.value); setDirty(true); }} rows={2}
            className="mt-0.5 w-full rounded-lg border border-border bg-panel2 px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-accent" placeholder="Qué pasó realmente (si falló)" />
        </label>
        <label className="block text-xs">
          <span className="text-muted">Notas</span>
          <textarea value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} rows={2}
            className="mt-0.5 w-full rounded-lg border border-border bg-panel2 px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-accent" placeholder="Evidencia (enlace), ambiente, observaciones" />
        </label>
      </div>
    </div>
  );
}
