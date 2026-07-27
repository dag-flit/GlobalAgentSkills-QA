"use client";

import { useCallback, useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import type { RegressionTarget, RegressionSuite, RegressionTest } from "@/lib/types";
import { aliasOptions } from "@/lib/qa/regressionSteps";
import { TestSteps } from "./TestSteps";
import { SuiteRunner } from "./SuiteRunner";

// Constructor de SUITES de regresión para un sistema, con jerarquía VISUAL clara:
//   Suite (acordeón) › Pruebas (filas) › Pasos (editor de la prueba elegida).
// Una suite abierta es un "borrador" editable; los cambios se marcan y se guardan con un botón (upsert).
// El login es automático para sistemas con login (lo antepone el runner, Fase 3): no es un paso.

function genId(name: string): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "x";
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}
const plural = (n: number, s: string) => `${n} ${s}${n === 1 ? "" : "s"}`;

export function SuiteBuilder({ target }: { target: RegressionTarget }) {
  const aliases = aliasOptions(target.catalog);
  const [suites, setSuites] = useState<RegressionSuite[]>([]);
  const [draft, setDraft] = useState<RegressionSuite | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [suiteName, setSuiteName] = useState("");
  const [testName, setTestName] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/regression/suites?targetId=${encodeURIComponent(target.id)}`);
    const j = await r.json();
    setSuites(j.suites ?? []);
  }, [target.id]);
  useEffect(() => {
    load();
  }, [load]);

  function guardUnsaved(): boolean {
    return !draft || !dirty || confirm("Hay cambios sin guardar en la suite abierta. ¿Descartarlos?");
  }
  function newSuite() {
    const name = suiteName.trim();
    if (!name || !guardUnsaved()) return;
    setDraft({ id: genId(name), targetId: target.id, name, tests: [] });
    setTestId(null);
    setMsg(null);
    setSuiteName("");
    setCreating(false);
    setDirty(true);
  }
  function openSuite(s: RegressionSuite) {
    if (!guardUnsaved()) return;
    setDraft(JSON.parse(JSON.stringify(s)));
    setTestId(s.tests[0]?.id ?? null);
    setMsg(null);
    setDirty(false);
  }
  function closeDraft() {
    if (!guardUnsaved()) return;
    setDraft(null);
    setTestId(null);
    setMsg(null);
    setDirty(false);
  }
  function addTest() {
    if (!draft) return;
    const name = testName.trim();
    if (!name) return;
    const test: RegressionTest = { id: genId(name), name, steps: [] };
    setDraft({ ...draft, tests: [...draft.tests, test] });
    setTestId(test.id);
    setTestName("");
    setDirty(true);
  }
  function updateTestSteps(id: string, steps: RegressionTest["steps"]) {
    if (!draft) return;
    setDraft({ ...draft, tests: draft.tests.map((t) => (t.id === id ? { ...t, steps } : t)) });
    setDirty(true);
  }
  function removeTest(id: string) {
    if (!draft) return;
    setDraft({ ...draft, tests: draft.tests.filter((t) => t.id !== id) });
    if (testId === id) setTestId(null);
    setDirty(true);
  }

  async function saveSuite() {
    if (!draft) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/regression/suites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar.");
      setMsg("✓ Guardada.");
      setDirty(false);
      await load();
    } catch (e: any) {
      setMsg(`No se pudo guardar: ${e?.message ?? "error"}`);
    } finally {
      setSaving(false);
    }
  }
  async function removeSuite(s: RegressionSuite) {
    if (!confirm(`¿Eliminar la suite «${s.name}» y todas sus pruebas?`)) return;
    await fetch(`/api/regression/suites?targetId=${encodeURIComponent(target.id)}&id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
    if (draft?.id === s.id) {
      setDraft(null);
      setDirty(false);
    }
    await load();
  }

  const isNewDraft = draft ? !suites.some((s) => s.id === draft.id) : false;

  // Detalle de la suite abierta (pruebas + pasos). Se reutiliza para una suite existente y para una nueva.
  function detail() {
    if (!draft) return null;
    const test = draft.tests.find((t) => t.id === testId) ?? null;
    return (
      <div className="border-t border-border p-3 space-y-3">
        {/* Nombre + guardar */}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[11px] text-muted flex items-center gap-1.5">
            Nombre de la suite
            <input className="input h-7 text-[12px] min-w-[180px]" value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDirty(true); }} />
          </label>
          <button className="btn-primary text-[12px]" onClick={saveSuite} disabled={saving || (!dirty && !isNewDraft)}>
            {saving ? <span className="flex items-center gap-2"><Spinner /> Guardando…</span> : dirty || isNewDraft ? "Guardar cambios" : "Guardado ✓"}
          </button>
          {(dirty || isNewDraft) && !saving && <span className="text-[11px] text-warn">● cambios sin guardar</span>}
          {msg && <span className="text-[11px] text-muted">{msg}</span>}
        </div>

        {/* Pruebas de la suite */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-muted uppercase tracking-wide">Pruebas de esta suite</div>
          {/* Nueva prueba (arriba: la acción de crear va encima de la lista) */}
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-2">
            <span className="text-[11px] text-muted shrink-0">Nueva prueba:</span>
            <input className="input h-7 text-[12px] flex-1 max-w-[260px]" placeholder="Ej: Logueo Correcto, Ver Reportes…" value={testName} onChange={(e) => setTestName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTest()} />
            <button className="btn-primary text-[12px]" onClick={addTest} disabled={!testName.trim()}>＋ Agregar prueba</button>
          </div>
          {draft.tests.length === 0 && <p className="text-[11px] text-muted">Sin pruebas todavía. Agregá la primera arriba.</p>}
          <div className="space-y-1">
            {draft.tests.map((t) => {
              const sel = testId === t.id;
              return (
                <div key={t.id} className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 ${sel ? "border-accent bg-accent/10" : "border-border bg-panel2/20"}`}>
                  <button className="flex items-center gap-2 flex-1 text-left" onClick={() => setTestId(sel ? null : t.id)} title={sel ? "Cerrar" : "Abrir para editar los pasos"}>
                    <span className="text-muted w-4 shrink-0">{sel ? "✏️" : "▸"}</span>
                    <span className="text-[12px] font-medium">{t.name}</span>
                    <span className="text-[11px] text-muted">· {plural(t.steps.length, "paso")}</span>
                  </button>
                  <button className="text-red-300 hover:text-red-200 px-1" title="Quitar prueba" onClick={() => removeTest(t.id)}>✕</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pasos de la prueba seleccionada */}
        {test ? (
          <div className="rounded-lg border border-accent/40 bg-panel2/20 p-3 space-y-2">
            <div className="text-[12px] font-medium">Pasos de «{test.name}»</div>
            <TestSteps steps={test.steps} aliases={aliases} onChange={(steps) => updateTestSteps(test.id, steps)} secrets={target.authMode === "login"} />
          </div>
        ) : (
          draft.tests.length > 0 && <p className="text-[11px] text-muted">👆 Elegí una prueba de la lista para armar o editar sus pasos.</p>
        )}

        {target.authMode === "login" && (
          <p className="text-[11px] text-muted">🔒 Este sistema tiene login: el inicio de sesión se hace <b>automático</b> al correr (salvo la prueba que escribe usuario/clave, que ES la del login). No lo agregues como paso.</p>
        )}

        {/* Correr la suite (usa la versión GUARDADA) */}
        {!isNewDraft && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="text-[12px] font-medium">Ejecutar</div>
            <SuiteRunner targetId={target.id} suiteId={draft.id} tests={draft.tests.map((t) => ({ id: t.id, name: t.name }))} disabled={dirty} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-3 border-t border-border">
      {/* Encabezado + crear suite */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-semibold flex items-center gap-1.5"><span>🗂️</span> Suites de regresión</div>
        {!creating && <button className="btn-primary text-[12px]" onClick={() => { setCreating(true); setSuiteName(""); }}>＋ Crear nueva suite</button>}
      </div>
      {creating && (
        <div className="flex items-center gap-2">
          <input autoFocus className="input h-8 text-[13px] flex-1 max-w-[280px]" placeholder="Nombre de la nueva suite (ej: Login, Reportes…)" value={suiteName} onChange={(e) => setSuiteName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") newSuite(); if (e.key === "Escape") { setCreating(false); setSuiteName(""); } }} />
          <button className="btn-primary text-[12px]" onClick={newSuite} disabled={!suiteName.trim()}>Crear</button>
          <button className="btn-ghost text-[12px]" onClick={() => { setCreating(false); setSuiteName(""); }}>Cancelar</button>
        </div>
      )}

      {/* Estado vacío */}
      {suites.length === 0 && !draft && !creating && (
        <button className="w-full rounded-lg border-2 border-dashed border-border hover:border-accent hover:text-accent text-muted text-[12px] py-4" onClick={() => { setCreating(true); setSuiteName(""); }}>
          ＋ Creá tu primera suite de regresión<br />
          <span className="text-[11px]">Una suite agrupa las pruebas que vas a re-correr tras cada release.</span>
        </button>
      )}

      {/* Lista de suites (acordeón) */}
      <div className="space-y-2">
        {suites.map((s) => {
          const open = draft?.id === s.id;
          return (
            <div key={s.id} className={`rounded-lg border overflow-hidden ${open ? "border-accent" : "border-border"}`}>
              <div className={`flex items-center gap-2 px-3 py-2 ${open ? "bg-accent/10" : "bg-panel2/30"}`}>
                <button className="flex items-center gap-2 flex-1 text-left" onClick={() => (open ? closeDraft() : openSuite(s))}>
                  <span className="text-muted w-4 shrink-0">{open ? "▾" : "▸"}</span>
                  <span>🗂️</span>
                  <span className="text-[13px] font-medium">{s.name}</span>
                  <span className="text-[11px] text-muted">· {plural(s.tests.length, "prueba")}</span>
                </button>
                <button className="text-red-300 hover:text-red-200 px-1" title="Eliminar suite" onClick={() => removeSuite(s)}>🗑</button>
              </div>
              {open && detail()}
            </div>
          );
        })}

        {/* Borrador nuevo (aún no guardado) */}
        {isNewDraft && (
          <div className="rounded-lg border border-accent overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 bg-accent/10">
              <span className="text-muted w-4 shrink-0">▾</span>
              <span>🗂️</span>
              <span className="text-[13px] font-medium">{draft!.name}</span>
              <span className="text-[11px] text-accent">· nueva (sin guardar)</span>
              <button className="ml-auto text-muted hover:text-white px-1 text-[12px]" title="Cerrar" onClick={closeDraft}>✕</button>
            </div>
            {detail()}
          </div>
        )}
      </div>
    </div>
  );
}
