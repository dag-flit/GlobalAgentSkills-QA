"use client";

import { Field } from "@/components/ui";
import type { RunWizardCtl } from "./useRunWizard";
import { AcPanel } from "./AcPanel";
import { FlowImportExport } from "./FlowImportExport";
import { OPS, OP_BY_ID, LOCATORS, opsByGroup, stepFilled, provesAc, type FlowStep, type OpId } from "./steps-catalog";

// Paso «Pasos»: constructor visual del guion E2E (para no técnicos). Cada fila es un paso con
// un desplegable de operación y sus campos. Es OPCIONAL: sin pasos, la corrida es un smoke de la
// URL. Con pasos, se ejecuta el flujo (login → navegar → verificar) sobre la misma sesión.
export function StepsStep({ w }: { w: RunWizardCtl }) {
  const flow = w.flow;

  const update = (i: number, patch: Partial<FlowStep>) =>
    w.setFlow(flow.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const changeOp = (i: number, op: OpId) => w.setFlow(flow.map((s, idx) => (idx === i ? { op } : s)));
  const add = () => w.setFlow([...flow, { op: "escribir" }]);
  const remove = (i: number) => w.setFlow(flow.filter((_, idx) => idx !== i));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= flow.length) return;
    const next = flow.slice();
    [next[i], next[j]] = [next[j], next[i]];
    w.setFlow(next);
  };
  const setVar = (k: string, v: string) => w.setVars({ ...w.vars, [k]: v });
  const incomplete = flow.filter((s) => !stepFilled(s)).length; // pasos a medio llenar

  return (
    <div className="space-y-4">
      {/* Criterios de aceptación de la HU (solo lectura) — a la vista para saber qué verificar. */}
      <AcPanel w={w} />

      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold">Pasos del flujo (opcional)</h2>
          <p className="text-sm text-muted mt-1">
            Tras abrir la URL, ¿qué debe hacer? Arma el flujo (p.ej. login → navegar → verificar).
            Si lo dejas vacío, solo tomo el smoke + captura de la URL.
          </p>
        </div>

        {/* Valores reales del login SOLO para esta corrida (efímeros). En el guion viajan como
            referencia ${QA_USER}/${QA_PASS}; el valor nunca se guarda ni queda en el guion. */}
        <div className="rounded-lg border border-border bg-panel2/40 p-3 space-y-2">
          <div className="text-sm font-medium">Usuario y clave para esta corrida (opcional — no se guardan)</div>
          <p className="text-[11px] text-muted">
            Llenalo solo si el sistema pide login. Se usan en esta corrida y se descartan: nunca se
            guardan ni quedan escritos en el guion. En un paso “Escribir”, los botones 👤/🔑 insertan
            una <b>referencia</b> (<code>{"${QA_USER}"}</code>/<code>{"${QA_PASS}"}</code>), no el valor
            real → así podés guardar o compartir el guion sin filtrar la clave.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Field label="Usuario de prueba">
              <input className="input" value={w.vars.QA_USER ?? ""} onChange={(e) => setVar("QA_USER", e.target.value)} />
            </Field>
            <Field label="Clave de prueba">
              <input className="input" type="password" value={w.vars.QA_PASS ?? ""} onChange={(e) => setVar("QA_PASS", e.target.value)} />
            </Field>
          </div>
        </div>

        {/* Lista de pasos */}
        <div className="space-y-2">
          {flow.length === 0 && (
            <div className="text-sm text-muted rounded-lg border border-dashed border-border px-3 py-4 text-center">
              Sin pasos todavía. Agrega el primero para armar el flujo.
            </div>
          )}
          {flow.map((step, i) => {
            const def = OP_BY_ID[step.op] ?? OPS[0];
            const bad = !stepFilled(step);
            return (
              <div key={i} className={`rounded-lg border bg-panel2/30 p-3 space-y-2 ${bad ? "border-red-700" : "border-border"}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted w-5 text-right">{i + 1}.</span>
                  <select
                    className="input flex-1"
                    value={step.op}
                    onChange={(e) => changeOp(i, e.target.value as OpId)}
                  >
                    {opsByGroup().map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.ops.map((o) => (
                          <option key={o.id} value={o.id}>{o.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button className="btn-ghost px-2 py-1" title="Subir" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                  <button className="btn-ghost px-2 py-1" title="Bajar" onClick={() => move(i, 1)} disabled={i === flow.length - 1}>↓</button>
                  <button className="btn-ghost px-2 py-1 text-red-300" title="Quitar" onClick={() => remove(i)}>✕</button>
                </div>
                <p className="text-[11px] text-muted pl-7">{def.hint}</p>
                {bad && (
                  <p className="text-[11px] text-red-300 pl-7">
                    Completá «{def.fields[0]?.label}» o quitá este paso.
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-7">
                  {def.fields.map((f) => {
                    const por = step.por ?? def.defaultPor ?? "css";
                    if (f.kind === "locator") {
                      return (
                        <Field key={f.name} label={f.label}>
                          <div className="space-y-1">
                            <select
                              className="input"
                              value={por}
                              onChange={(e) => update(i, { por: e.target.value } as Partial<FlowStep>)}
                            >
                              {LOCATORS.map((l) => (
                                <option key={l.id} value={l.id}>{l.label}</option>
                              ))}
                            </select>
                            <input
                              className="input font-mono"
                              placeholder={por === "css" ? "#id, .clase, button[type=submit]…" : f.placeholder}
                              value={step[f.name] ?? ""}
                              onChange={(e) => update(i, { [f.name]: e.target.value } as Partial<FlowStep>)}
                            />
                          </div>
                        </Field>
                      );
                    }
                    return (
                      <Field key={f.name} label={f.label}>
                        <div className="flex items-center gap-1">
                          <input
                            className="input font-mono flex-1"
                            placeholder={f.placeholder}
                            value={step[f.name] ?? ""}
                            onChange={(e) => update(i, { [f.name]: e.target.value } as Partial<FlowStep>)}
                          />
                          {f.kind === "valor" && (
                            <>
                              <button className="btn-ghost px-2 py-1" title="Insertar la referencia al usuario (${QA_USER}) — no escribe el valor real" onClick={() => update(i, { [f.name]: "${QA_USER}" } as Partial<FlowStep>)}>👤</button>
                              <button className="btn-ghost px-2 py-1" title="Insertar la referencia a la clave (${QA_PASS}) — no escribe el valor real" onClick={() => update(i, { [f.name]: "${QA_PASS}" } as Partial<FlowStep>)}>🔑</button>
                            </>
                          )}
                        </div>
                      </Field>
                    );
                  })}
                </div>
                {/* Solo en verificaciones y si hay AC declarados de la HU: qué criterio prueba este
                    paso → alimenta la matriz de cobertura del reporte. Opcional. */}
                {provesAc(step.op) && w.acs.length > 0 && (
                  <div className="pl-7">
                    <Field label="¿Qué criterio de aceptación prueba? (opcional)">
                      <select
                        className="input"
                        value={step.ac ?? ""}
                        onChange={(e) => update(i, { ac: e.target.value } as Partial<FlowStep>)}
                      >
                        <option value="">(ninguno)</option>
                        {w.acs.map((a, k) => (
                          <option key={k} value={a.title}>{a.title}</option>
                        ))}
                      </select>
                    </Field>
                  </div>
                )}
                {/* Verificación pero sin AC disponibles: explicá por qué no hay desplegable. */}
                {provesAc(step.op) && w.acs.length === 0 && w.workItem.trim() && w.tracker === "azure-devops" && (
                  <p className="text-[11px] text-muted pl-7">
                    Para etiquetar el criterio que prueba este paso, mirá el panel «Criterios de aceptación»
                    de arriba: si la HU tiene AC, acá aparecerá un desplegable para elegirlo. Si no aparece
                    ninguno, la HU no tiene criterios declarados en Azure.
                  </p>
                )}
              </div>
            );
          })}
          <button className="btn-ghost w-full" onClick={add}>+ Agregar paso</button>
        </div>
      </div>

      {/* Pegar un guion (JSON) y cargarlo de una vez, o exportar el armado. */}
      <FlowImportExport w={w} />

      {/* Guardar/cargar el guion EN la HU destino (reuso + fan-out de Feature). */}
      <div className="card space-y-2">
        <div className="text-sm font-medium">Guardar el guion en la Historia de Usuario (Azure)</div>
        {w.workItem.trim() ? (
          <>
            <p className="text-[11px] text-muted">
              Deja el guion pegado a la HU <code>{w.workItem.trim()}</code> (en el sistema, no en tu PC):
              queda reutilizable y es lo que corre el <b>fan-out de Feature</b> por cada HU hija. Se
              guarda la URL + los pasos, <b>sin</b> usuario ni clave.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button className="btn-ghost" onClick={w.saveFlowToHu} disabled={incomplete > 0}>💾 Guardar guion en la HU</button>
              <button className="btn-ghost" onClick={w.loadFlowFromHu}>⤵ Cargar el guion de la HU</button>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-muted">
            Para guardar/cargar el guion en una HU, definí el <b>WI destino</b> en el paso Tracker (Azure).
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost" onClick={w.back}>← Atrás</button>
        <button className="btn-primary" onClick={w.next} disabled={incomplete > 0}>Continuar →</button>
        {incomplete > 0 && (
          <span className="text-xs text-red-300">
            {incomplete} paso(s) incompleto(s): completalos o quitalos para continuar.
          </span>
        )}
      </div>
    </div>
  );
}
