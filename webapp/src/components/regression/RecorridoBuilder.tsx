"use client";

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { aliasOptions } from "@/lib/qa/regressionSteps";
import type { RegressionTarget, RegressionRecorrido } from "@/lib/types";
import { RecorridoStages } from "./RecorridoStages";
import { RecorridoRecorder } from "./RecorridoRecorder";
import { RecorridoToTest } from "./RecorridoToTest";

// Constructor de RECORRIDOS: el walk-through de un asistente multi-pantalla (Matrícula Inicial,
// Traspaso…). Definís la pantalla de entrada y las etapas (cada una con sus pasos de avance) y el
// sistema CAMINA el asistente cosechando los selectores de cada pantalla → resuelve las pantallas
// detrás de un flujo con URL dinámica (hash). Se itera: al escanear llega hasta donde puede; definís
// el siguiente tramo y volvés a escanear.

const empty = (): Omit<RegressionRecorrido, "targetId"> => ({ id: "", name: "", entryRoute: "", stages: [] });

// Traduce el resultado del walk a un mensaje orientado a la acción. El corte por «falta avance» NO es
// un error: es el checkpoint normal del flujo incremental (catalogamos hasta ahí; ahora se ven los
// selectores de esa pantalla y podés definir cómo seguir). Solo «advance_failed» es un problema real.
function walkOutcome(j: { reached?: number; cataloged?: number; skipped?: string[]; total?: number; count?: number; stalledAt?: string | null; stallReason?: string | null; message?: string | null }): string {
  const reached = j.reached ?? 0;
  const total = j.total ?? 0;
  const sel = `${j.count ?? 0} selector(es) en total`;
  // Etapas condicionales que no aplicaron esta corrida (su texto guardia no apareció) → no es error.
  const skip = (j.skipped ?? []).length ? ` (${j.skipped!.length} condicional(es) no aplicaron: ${j.skipped!.join(", ")})` : "";
  if (!j.stalledAt) return `✓ Recorrido completo: catalogué ${j.cataloged ?? total} pantalla(s) · ${sel}${skip}.`;
  if (j.stallReason === "no_advance") {
    return `✓ Vas ${reached}/${total}. Catalogué hasta «${j.stalledAt}» (${sel})${skip}. Ahora que ves sus selectores, definí en esa etapa cómo avanzar a la siguiente y volvé a «Escanear recorrido».`;
  }
  return `Llegué hasta «${j.stalledAt}» (${reached}/${total}). ${j.message ?? "No se pudo avanzar."}`;
}

// Anticipa hasta dónde llegará el escaneo con lo definido: se detiene en la primera etapa NO última
// que aún no tiene avance (ahí catalogará y parará, esperando que definas el siguiente tramo).
function reachHint(stages: Array<{ name: string; advance?: unknown[] }>): string {
  const total = stages.length;
  for (let i = 0; i < total - 1; i++) {
    if (((stages[i].advance as unknown[])?.length ?? 0) === 0) {
      const nm = stages[i].name?.trim() || `etapa ${i + 1}`;
      return `Con lo definido, el escaneo llegará hasta «${nm}» (${i + 1}/${total}) y se detendrá ahí para que definas cómo seguir.`;
    }
  }
  return `Con lo definido, el escaneo recorrerá las ${total} pantalla(s) de una vez.`;
}

export function RecorridoBuilder({ target, onChanged, focusName, onCreatedTest }: { target: RegressionTarget; onChanged: () => void; focusName?: string | null; onCreatedTest?: (suiteId: string, testId: string) => void }) {
  const [list, setList] = useState<RegressionRecorrido[]>([]);
  const [draft, setDraft] = useState<Omit<RegressionRecorrido, "targetId">>(empty());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [walking, setWalking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null); // recorrido a abrir tras grabar
  const [convert, setConvert] = useState<RegressionRecorrido | null>(null); // recorrido a convertir en prueba

  const aliasOpts = useMemo(() => aliasOptions(target.catalog), [target.catalog]);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/regression/recorridos?targetId=${encodeURIComponent(target.id)}`);
      const j = await r.json();
      setList(j.recorridos ?? []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id]);

  // Al abrir un recorrido puntual desde el catálogo («Editar / Escanear»), lo selecciona cuando la
  // lista esté cargada. Sin coincidencia (o focus null) no toca el borrador en curso.
  useEffect(() => {
    if (!focusName) return;
    const rec = list.find((r) => r.name === focusName);
    if (rec) setDraft({ id: rec.id, name: rec.name, entryRoute: rec.entryRoute, stages: rec.stages ?? [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusName, list]);

  // Tras GRABAR: abre el recorrido recién creado (por id) para afinar los nombres de las etapas.
  useEffect(() => {
    if (!focusId) return;
    const rec = list.find((r) => r.id === focusId);
    if (rec) { setDraft({ id: rec.id, name: rec.name, entryRoute: rec.entryRoute, stages: rec.stages ?? [] }); setFocusId(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, list]);

  async function onRecorded(recId: string) {
    await load();
    onChanged();
    setFocusId(recId);
  }

  function edit(rec: RegressionRecorrido) {
    setDraft({ id: rec.id, name: rec.name, entryRoute: rec.entryRoute, stages: rec.stages ?? [] });
    setMsg(null);
  }
  function nuevo() {
    setDraft({ ...empty(), id: crypto.randomUUID() });
    setMsg(null);
  }

  async function save(): Promise<boolean> {
    if (!draft.name.trim()) {
      setMsg("Poné un nombre al recorrido (ej. Matrícula Inicial).");
      return false;
    }
    setSaving(true);
    setMsg(null);
    try {
      const body = { targetId: target.id, id: draft.id || crypto.randomUUID(), name: draft.name, entryRoute: draft.entryRoute, stages: draft.stages };
      const r = await fetch("/api/regression/recorridos", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar.");
      setDraft((d) => ({ ...d, id: body.id }));
      await load();
      setMsg("✓ Recorrido guardado.");
      return true;
    } catch (e: any) {
      setMsg(e?.message ?? "Error de red.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function walk() {
    // Guardar primero: el walk lee el recorrido de la base (resuelve alias de los avances desde el catálogo).
    const okSaved = await save();
    if (!okSaved) return;
    setWalking(true);
    setMsg(null);
    try {
      const r = await fetch("/api/regression/recorridos/walk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: target.id, recorridoId: draft.id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo caminar el recorrido.");
      setMsg(walkOutcome(j));
      onChanged();
    } catch (e: any) {
      setMsg(`No se pudo caminar: ${e?.message ?? "error"}`);
    } finally {
      setWalking(false);
    }
  }

  // Duplicar un recorrido como plantilla para OTRO trámite (p.ej. Traspaso desde Matrícula Inicial):
  // clona sus etapas con un id y nombre nuevos, y lo abre para editar lo que difiera. Reúso determinista.
  async function duplicate(rec: RegressionRecorrido) {
    const id = crypto.randomUUID();
    const body = { targetId: target.id, id, name: `${rec.name} (copia)`, entryRoute: rec.entryRoute, stages: rec.stages ?? [] };
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/regression/recorridos", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo duplicar.");
      await load();
      setDraft({ id, name: body.name, entryRoute: body.entryRoute, stages: body.stages });
      setMsg("✓ Recorrido duplicado. Editá el nombre y lo que difiera para el otro trámite.");
    } catch (e: any) {
      setMsg(e?.message ?? "Error de red.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(rec: RegressionRecorrido) {
    if (!confirm(`¿Eliminar el recorrido «${rec.name}»?`)) return;
    // Segunda decisión: ¿quitar también sus pantallas del catálogo? Se conservan por defecto porque
    // pueden estar en uso por pruebas; Aceptar = quitarlas, Cancelar = conservarlas.
    const purge = confirm(`¿Quitar también del catálogo las pantallas capturadas por «${rec.name}»?\n\nAceptar = quitarlas (ojo: las pruebas que usen esos selectores quedarán sin ellos).\nCancelar = conservarlas.`);
    const q = `targetId=${encodeURIComponent(target.id)}&id=${encodeURIComponent(rec.id)}${purge ? "&purgeCatalog=1" : ""}`;
    const r = await fetch(`/api/regression/recorridos?${q}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (draft.id === rec.id) setDraft(empty());
    await load();
    if (purge) { onChanged(); setMsg(`Recorrido eliminado · ${j.purged ?? 0} pantalla(s) quitada(s) del catálogo.`); }
    else setMsg("Recorrido eliminado (sus pantallas quedan en el catálogo).");
  }

  const busy = saving || walking;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        La forma recomendada es <b>grabar</b>: abrís un navegador, usás la app y el sistema captura cada pantalla y
        graba el guion solo. Cuando termines podés afinar los nombres de las etapas abajo.
      </p>

      {/* Camino PRINCIPAL: grabar navegando (semi-automático). */}
      <RecorridoRecorder target={target} onRecorded={onRecorded} />

      {/* Puente: convertir el recorrido elegido en una prueba corrible (elige/crea suite). */}
      {convert && (
        <RecorridoToTest
          target={target}
          recorrido={convert}
          onCancel={() => setConvert(null)}
          onCreated={(suiteId, testId) => { setConvert(null); onCreatedTest?.(suiteId, testId); }}
        />
      )}

      {/* Recorridos guardados (grabados o a mano): editar / duplicar / eliminar. */}
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
        <span className="text-[11px] text-muted w-full">Recorridos guardados <span className="opacity-70">(editá para afinar los nombres de las etapas o armá uno a mano)</span>:</span>
        {loading ? (
          <span className="text-[11px] text-muted flex items-center gap-2"><Spinner /> Cargando…</span>
        ) : list.length === 0 ? (
          <span className="text-[11px] text-muted">Todavía ninguno.</span>
        ) : (
          list.map((rec) => (
            <span key={rec.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${draft.id === rec.id ? "border-accent text-accent" : "border-border text-muted"}`}>
              <button onClick={() => edit(rec)}>{rec.name} <span className="opacity-60">· {rec.stages?.length ?? 0} etapa(s)</span></button>
              <button className="text-accent hover:text-white font-medium" title="Crear una prueba corrible desde este recorrido" onClick={() => setConvert(rec)}>→ Prueba</button>
              <button className="hover:text-white" title="Duplicar (para otro trámite)" onClick={() => duplicate(rec)}>⧉</button>
              <button className="text-red-300" title="Eliminar" onClick={() => remove(rec)}>×</button>
            </span>
          ))
        )}
        <button className="btn-ghost text-[11px]" onClick={nuevo}>+ nuevo recorrido</button>
      </div>

      {/* Editor del recorrido en borrador */}
      {(draft.id || draft.name || draft.stages.length > 0) && (
        <div className="rounded-lg border border-border p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input className="input" placeholder="Nombre del recorrido (ej. Matrícula Inicial)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className="input font-mono" placeholder="Ruta de entrada (ej. /tramites/nuevo/matricula_inicial)" value={draft.entryRoute} onChange={(e) => setDraft({ ...draft, entryRoute: e.target.value })} />
          </div>

          <RecorridoStages stages={draft.stages} aliasOpts={aliasOpts} onChange={(stages) => setDraft({ ...draft, stages })} />

          {draft.stages.length > 0 && <p className="text-[11px] text-muted">{reachHint(draft.stages)}</p>}
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
            <button className="btn-ghost" onClick={save} disabled={busy}>
              {saving ? <span className="flex items-center gap-2"><Spinner /> Guardando…</span> : "Guardar"}
            </button>
            <button className="btn-primary" onClick={walk} disabled={busy || draft.stages.length === 0}>
              {walking ? <span className="flex items-center gap-2"><Spinner /> Recorriendo…</span> : "Escanear recorrido"}
            </button>
            <button className="btn-ghost text-accent" title="Crear una prueba corrible con estos pasos" onClick={() => setConvert({ ...draft, targetId: target.id } as RegressionRecorrido)} disabled={busy || draft.stages.length === 0}>→ Crear prueba</button>
            {msg && <span className="text-[11px] text-muted">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
