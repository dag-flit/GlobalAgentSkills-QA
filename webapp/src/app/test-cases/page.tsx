"use client";

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { SuiteSidebar } from "@/components/testcases/SuiteSidebar";
import { CaseEditor } from "@/components/testcases/CaseEditor";
import {
  type TestSuite, type TestCase, type TestCaseDraft, PRIORITY_LABELS, PRIO_STYLE,
  blankCase, blankSuiteId,
} from "@/components/testcases/types";

// Página «Casos de Prueba» (Fase 1): casos con pasos (acción/esperado) organizados en suites, por
// proyecto (RLS). Base para las ejecuciones (Fase 2) y el import de Azure Test Plans (Fase 3).
export default function TestCasesPage() {
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [cases, setCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState("all"); // "all" | "none" | suiteId
  const [editing, setEditing] = useState<TestCase | null>(null);
  const [ado, setAdo] = useState<{ orgUrl: string; project: string } | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [su, ca, cfg] = await Promise.all([
        fetch("/api/test-suites").then((r) => r.json()),
        fetch("/api/test-cases").then((r) => r.json()),
        fetch("/api/config").then((r) => r.json()).catch(() => null),
      ]);
      if (!su.ok) throw new Error(su.error || "No se pudieron cargar las suites.");
      if (!ca.ok) throw new Error(ca.error || "No se pudieron cargar los casos.");
      setSuites(su.suites ?? []);
      setCases(ca.cases ?? []);
      const az = cfg?.tracker?.azure;
      setAdo(az?.orgUrl && az?.project ? { orgUrl: az.orgUrl, project: az.project } : null);
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const bySuite: Record<string, number> = {};
    let none = 0;
    for (const c of cases) { if (c.suite_id) bySuite[c.suite_id] = (bySuite[c.suite_id] ?? 0) + 1; else none++; }
    return { total: cases.length, none, bySuite };
  }, [cases]);

  const shown = useMemo(() => {
    if (selected === "all") return cases;
    if (selected === "none") return cases.filter((c) => !c.suite_id);
    return cases.filter((c) => c.suite_id === selected);
  }, [cases, selected]);

  function adoUrl(wi: string): string | null {
    if (!ado || !wi) return null;
    return `${ado.orgUrl.replace(/\/+$/, "")}/${encodeURIComponent(ado.project)}/_workitems/edit/${encodeURIComponent(wi)}`;
  }

  async function api(path: string, method: string, body: unknown) {
    const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({ ok: false, error: "Respuesta inválida." }));
    if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo completar la acción.");
    return j;
  }
  async function run(fn: () => Promise<void>) {
    setSaving(true); setError(null);
    try { await fn(); await load(); } catch (e: any) { setError(e?.message ?? "Error de red."); } finally { setSaving(false); }
  }

  const createSuite = (name: string) => run(() => api("/api/test-suites", "PUT", { id: blankSuiteId(), name, description: "", position: suites.length }));
  const renameSuite = (id: string, name: string) => run(async () => { const s = suites.find((x) => x.id === id); await api("/api/test-suites", "PUT", { id, name, description: s?.description ?? "", position: s?.position ?? 0 }); });
  const deleteSuite = (id: string) => run(async () => { await api("/api/test-suites", "DELETE", { id }); if (selected === id) setSelected("all"); });
  const saveCase = (d: TestCaseDraft) => run(async () => { await api("/api/test-cases", "PUT", d); setEditing(null); });
  const removeCase = (id: string) => { if (confirm("¿Eliminar este caso de prueba?")) run(() => api("/api/test-cases", "DELETE", { id })); };

  function newCase() {
    const suiteId = selected === "all" || selected === "none" ? null : selected;
    setEditing(blankCase(suiteId));
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Casos de Prueba</h1>
          <p className="mt-1 text-sm text-muted">Casos con pasos (acción / resultado esperado), organizados en suites. Vinculá la HU de ADO que cubren.</p>
        </div>
        <button onClick={newCase} className="btn-primary">Nuevo caso</button>
      </header>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {loading ? (
        <div className="pt-10"><Spinner /></div>
      ) : (
        <div className="flex flex-wrap gap-4">
          <SuiteSidebar suites={suites} selected={selected} counts={counts} onSelect={setSelected}
            onCreate={createSuite} onRename={renameSuite} onDelete={deleteSuite} />
          <div className="min-w-0 flex-1">
            {shown.length === 0 ? (
              <p className="text-sm text-muted">No hay casos {selected === "all" ? "todavía" : "en esta suite"}. Creá uno con «Nuevo caso».</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-panel2">
                    <tr className="text-left text-muted">
                      <th className="px-2 py-2">Título</th>
                      <th className="px-2 py-2">Prioridad</th>
                      <th className="px-2 py-2">Pasos</th>
                      <th className="px-2 py-2">HU ADO</th>
                      <th className="px-2 py-2">Etiquetas</th>
                      <th className="px-2 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => {
                      const url = adoUrl(c.ado_wi);
                      return (
                        <tr key={c.id} className="border-t border-border hover:bg-panel2">
                          <td className="max-w-xs truncate px-2 py-2 text-gray-100 cursor-pointer" onClick={() => setEditing(c)} title={c.title}>{c.title}</td>
                          <td className="px-2 py-2 whitespace-nowrap"><span className={`rounded-full px-1.5 py-0.5 text-[10px] ${PRIO_STYLE[c.priority]}`}>{PRIORITY_LABELS[c.priority]}</span></td>
                          <td className="px-2 py-2 text-gray-300">{(c.steps ?? []).length}</td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {c.ado_wi ? (url ? <a href={url} target="_blank" rel="noreferrer" className="text-accent hover:underline">#{c.ado_wi}</a> : <span className="text-gray-300">#{c.ado_wi}</span>) : <span className="text-muted">—</span>}
                          </td>
                          <td className="px-2 py-2"><span className="flex flex-wrap gap-1">{(c.tags ?? []).length ? c.tags.map((t) => <span key={t} className="rounded bg-border px-1.5 py-0.5 text-[10px] text-gray-300">{t}</span>) : <span className="text-muted">—</span>}</span></td>
                          <td className="px-2 py-2 whitespace-nowrap text-xs">
                            <button onClick={() => setEditing(c)} className="rounded-lg px-1.5 py-0.5 text-muted hover:bg-panel">Editar</button>
                            <button onClick={() => removeCase(c.id)} disabled={saving} className="rounded-lg px-1.5 py-0.5 text-red-300 hover:bg-panel">Borrar</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {editing && <CaseEditor item={editing} suites={suites} onSave={saveCase} onCancel={() => setEditing(null)} saving={saving} />}
    </div>
  );
}
