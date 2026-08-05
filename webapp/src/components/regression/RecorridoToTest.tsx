"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import type { RegressionTarget, RegressionRecorrido, RegressionSuite, RegressionTest } from "@/lib/types";
import { recorridoToSteps } from "@/lib/qa/recorridoToTest";

// Puente GRABACIÓN → PRUEBA: toma un recorrido (grabado o a mano) y crea una PRUEBA corrible con sus
// pasos ya puestos (clics/escrituras), preguntando A QUÉ SUITE agregarla — una existente o una NUEVA
// creada acá mismo. No agrega verificaciones: el usuario las suma después en la pestaña Pruebas. Al
// terminar, `onCreated` lleva al usuario a esa suite. Determinista (aplana el recorrido), sin IA.

function genId(name: string): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "x";
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

export function RecorridoToTest({
  target,
  recorrido,
  onCreated,
  onCancel,
}: {
  target: RegressionTarget;
  recorrido: RegressionRecorrido;
  onCreated: (suiteId: string, testId: string) => void;
  onCancel: () => void;
}) {
  const [suites, setSuites] = useState<RegressionSuite[]>([]);
  const [loading, setLoading] = useState(true);
  const [dest, setDest] = useState<string>("__new__"); // id de suite existente | "__new__"
  const [suiteName, setSuiteName] = useState(recorrido.name);
  const [testName, setTestName] = useState(recorrido.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const steps = recorridoToSteps(recorrido);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/regression/suites?targetId=${encodeURIComponent(target.id)}`);
        const j = await r.json();
        const list: RegressionSuite[] = j.suites ?? [];
        setSuites(list);
        // Si ya hay suites, por defecto apuntamos a la primera; si no, a «crear nueva».
        setDest(list.length ? list[0].id : "__new__");
      } catch {
        setSuites([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [target.id]);

  async function create() {
    if (busy) return;
    if (!testName.trim()) { setErr("Poné un nombre a la prueba."); return; }
    if (dest === "__new__" && !suiteName.trim()) { setErr("Poné un nombre a la nueva suite."); return; }
    setBusy(true);
    setErr(null);
    const test: RegressionTest = { id: genId(testName), name: testName.trim(), steps };
    // Suite destino: una copia de la existente con la prueba agregada, o una suite nueva.
    let suite: RegressionSuite;
    if (dest === "__new__") {
      suite = { id: genId(suiteName), targetId: target.id, name: suiteName.trim(), tests: [test] };
    } else {
      const base = suites.find((s) => s.id === dest);
      if (!base) { setErr("La suite elegida ya no existe. Recargá."); setBusy(false); return; }
      suite = { ...base, tests: [...base.tests, test] };
    }
    try {
      const r = await fetch("/api/regression/suites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suite),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar la suite.");
      onCreated(suite.id, test.id);
    } catch (e: any) {
      setErr(e?.message ?? "Error de red.");
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-accent/50 bg-accent/5 p-3 space-y-2">
      <div className="text-[12px] font-medium">Crear prueba desde «{recorrido.name}»</div>
      <p className="text-[11px] text-muted">
        Se crea una prueba con <b>{steps.length} paso(s)</b> (los clics y escrituras que grabaste). Después le agregás
        las <b>verificaciones</b> en la prueba. Elegí a qué suite va:
      </p>

      {loading ? (
        <span className="text-[11px] text-muted flex items-center gap-2"><Spinner /> Cargando suites…</span>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col gap-1.5">
            {suites.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-[12px]">
                <input type="radio" checked={dest === s.id} onChange={() => setDest(s.id)} />
                <span>Agregar a <b>{s.name}</b> <span className="text-muted">· {s.tests.length} prueba(s)</span></span>
              </label>
            ))}
            <label className="flex items-center gap-2 text-[12px]">
              <input type="radio" checked={dest === "__new__"} onChange={() => setDest("__new__")} />
              <span>Crear una suite nueva:</span>
              <input
                className="input h-7 text-[12px] max-w-[220px] disabled:opacity-40"
                placeholder="Nombre de la suite"
                value={suiteName}
                disabled={dest !== "__new__"}
                onChange={(e) => setSuiteName(e.target.value)}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-[11px] text-muted">
            Nombre de la prueba
            <input className="input h-7 text-[12px] max-w-[260px]" value={testName} onChange={(e) => setTestName(e.target.value)} />
          </label>

          {err && <p className="text-[11px] text-red-300">{err}</p>}
          <div className="flex items-center gap-2">
            <button className="btn-primary text-[12px]" onClick={create} disabled={busy || steps.length === 0}>
              {busy ? <span className="flex items-center gap-2"><Spinner /> Creando…</span> : "Crear prueba e ir a Pruebas"}
            </button>
            <button className="btn-ghost text-[12px]" onClick={onCancel} disabled={busy}>Cancelar</button>
          </div>
          {steps.length === 0 && <p className="text-[11px] text-warn">Este recorrido no tiene acciones grabadas para convertir en pasos.</p>}
        </div>
      )}
    </div>
  );
}
