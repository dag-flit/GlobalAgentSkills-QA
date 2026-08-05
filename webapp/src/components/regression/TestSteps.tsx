"use client";

import { useState } from "react";
import type { RegressionStep } from "@/lib/types";
import { STEP_TYPES, stepType, type AliasOption, type StepField } from "@/lib/qa/regressionSteps";
import { AliasPicker } from "./AliasPicker";
import { FileField } from "./FileField";

// Etiqueta amigable del campo de texto de un paso, según su tipo.
function fieldLabel(f?: StepField): string {
  return f === "ruta" ? "Ruta" : f === "texto" ? "Texto" : f === "nombre" ? "Nombre" : f === "segundos" ? "Segundos" : f === "numero" ? "Cantidad" : "Valor";
}

// Editor de PASOS de una prueba de regresión. Muestra los pasos actuales y una fila para agregar
// uno nuevo: operación (desplegable), elemento por ALIAS (selector buscable poblado por el catálogo)
// y un valor libre (si aplica). Sin selectores crudos: el alias los resuelve el runner.
// Credenciales: en vez de tipear usuario/clave (quedarían en texto plano en la interfaz Y en la
// base), se insertan TOKENS `${QA_USER}`/`${QA_PASS}` que el runner resuelve desde las credenciales
// CIFRADAS del sistema. El valor real nunca se ve ni se guarda en la prueba.

// Muestra el valor de un paso de forma amigable: los tokens de credencial se enmascaran.
function friendlyValue(v?: string): string {
  if (!v) return "";
  if (v === "${QA_USER}") return "usuario guardado";
  if (v === "${QA_PASS}") return "clave guardada";
  return `"${v}"`;
}

// Texto de un campo del paso (según su tipo): enmascara tokens de credencial, "N s" para segundos.
function fieldText(field: StepField | undefined, v?: string): string {
  if (!v) return "";
  if (field === "segundos") return `${v} s`;
  if (field === "valor") return friendlyValue(v);
  if (field === "ruta") return `📎 ${v.replace(/^\$\{QA_FILES\}\//, "")}`; // muestra el nombre del archivo
  return `"${v}"`;
}

function describeStep(s: RegressionStep, aliases: AliasOption[]): string {
  const t = stepType(s.op);
  const label = t?.label ?? s.op;
  const el = s.alias ? `«${s.alias}»` : "";
  const v1 = t?.field ? (s[t.field] ?? "") : "";
  const v2 = t?.field2 ? (s[t.field2] ?? "") : "";
  // Con dos campos (verificar_atributo) se muestra «atributo = valor»; con uno, el valor a secas.
  const val = t?.field2 ? [fieldText(t.field, v1), v2 ? `= ${fieldText(t.field2, v2)}` : ""].filter(Boolean).join(" ") : fieldText(t?.field, v1);
  const hint = s.alias ? aliases.find((a) => a.alias === s.alias)?.hint : "";
  return [label, el, val, hint ? `(${hint})` : ""].filter(Boolean).join(" ");
}

export function TestSteps({
  steps,
  aliases,
  onChange,
  secrets = false,
}: {
  steps: RegressionStep[];
  aliases: AliasOption[];
  onChange: (steps: RegressionStep[]) => void;
  secrets?: boolean; // el sistema tiene login → ofrecer tokens de credencial en vez de texto plano
}) {
  const [op, setOp] = useState("ir_a");
  const [alias, setAlias] = useState("");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState(""); // segundo dato (p.ej. valor esperado de un atributo)
  const [editIdx, setEditIdx] = useState<number | null>(null); // paso en edición (null = agregar uno nuevo)

  const t = stepType(op);

  function resetEditor() {
    setEditIdx(null);
    setOp("ir_a");
    setAlias("");
    setValue("");
    setValue2("");
  }
  // Agregar (editIdx === null) o REEMPLAZAR el paso en edición.
  function commitStep() {
    if (t?.needsElement && !alias) return;
    const step: RegressionStep = { op };
    if (t?.needsElement) step.alias = alias;
    if (t?.field && value.trim()) step[t.field] = value.trim();
    if (t?.field2 && value2.trim()) step[t.field2] = value2.trim();
    onChange(editIdx === null ? [...steps, step] : steps.map((s, j) => (j === editIdx ? step : s)));
    resetEditor();
  }
  // Cargar un paso existente en el editor para cambiar su operación / elemento / valores en el sitio.
  function startEdit(i: number) {
    const s = steps[i];
    const st = stepType(s.op);
    setEditIdx(i);
    setOp(s.op);
    setAlias(s.alias ?? "");
    setValue(st?.field ? (s[st.field] ?? "") : "");
    setValue2(st?.field2 ? (s[st.field2] ?? "") : "");
  }

  function remove(i: number) {
    onChange(steps.filter((_, j) => j !== i));
    resetEditor();
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    const next = steps.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
    resetEditor();
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-1">
        {steps.length === 0 && <li className="text-[11px] text-muted">Esta prueba no tiene pasos todavía.</li>}
        {steps.map((s, i) => (
          <li key={i} className={`flex items-center gap-2 text-[12px] rounded px-2 py-1 ${editIdx === i ? "bg-accent/15 ring-1 ring-accent/40" : "bg-panel2/40"}`}>
            <span className="text-muted w-5 shrink-0">{i + 1}.</span>
            <span className="flex-1">{describeStep(s, aliases)}</span>
            <button className="text-muted hover:text-accent px-1 text-[11px]" title="Editar este paso" onClick={() => startEdit(i)}>Editar</button>
            <button className="text-muted hover:text-white px-1" title="Subir" onClick={() => move(i, -1)}>↑</button>
            <button className="text-muted hover:text-white px-1" title="Bajar" onClick={() => move(i, 1)}>↓</button>
            <button className="text-red-300 hover:text-red-200 px-1" title="Quitar" onClick={() => remove(i)}>✕</button>
          </li>
        ))}
      </ol>

      <div className="flex items-end gap-2 flex-wrap border-t border-border pt-2">
        {editIdx !== null && <span className="w-full text-[11px] text-accent font-medium">Editando el paso {editIdx + 1}</span>}
        <label className="text-[11px] text-muted">
          Paso
          <select className="input block mt-0.5" value={op} onChange={(e) => { setOp(e.target.value); setAlias(""); setValue(""); setValue2(""); }}>
            {STEP_TYPES.map((st) => (
              <option key={st.op} value={st.op}>{st.label}</option>
            ))}
          </select>
        </label>

        {t?.needsElement && (
          <label className="text-[11px] text-muted">
            Elemento
            <div className="mt-0.5">
              <AliasPicker options={aliases} value={alias} onChange={setAlias} />
            </div>
          </label>
        )}

        {t?.field === "ruta" && (
          <label className="text-[11px] text-muted">
            Archivo
            <div className="mt-0.5">
              <FileField value={value} onChange={setValue} />
            </div>
          </label>
        )}

        {t?.field && t.field !== "ruta" && (
          <label className="text-[11px] text-muted">
            {fieldLabel(t.field)}
            <div className="mt-0.5 flex items-center gap-1">
              <input className="input" inputMode={t.field === "segundos" || t.field === "numero" ? "decimal" : undefined} placeholder={t.placeholder} value={value} onChange={(e) => setValue(e.target.value)} />
              {t.field === "valor" && secrets && (
                <>
                  <button type="button" className="btn-ghost text-[11px] whitespace-nowrap" title="Usa el usuario guardado del sistema (cifrado; no se muestra ni se guarda el valor real)" onClick={() => setValue("${QA_USER}")}>Usuario guardado</button>
                  <button type="button" className="btn-ghost text-[11px] whitespace-nowrap" title="Usa la clave guardada del sistema (cifrada; no se muestra ni se guarda el valor real)" onClick={() => setValue("${QA_PASS}")}>Clave guardada</button>
                </>
              )}
            </div>
          </label>
        )}

        {t?.field2 && (
          <label className="text-[11px] text-muted">
            {fieldLabel(t.field2)}
            <input className="input block mt-0.5" placeholder={t.placeholder2} value={value2} onChange={(e) => setValue2(e.target.value)} />
          </label>
        )}

        <button className="btn-primary text-[12px]" onClick={commitStep} disabled={!!t?.needsElement && !alias}>
          {editIdx === null ? "Agregar paso" : "Guardar paso"}
        </button>
        {editIdx !== null && <button className="btn-ghost text-[12px]" onClick={resetEditor}>Cancelar</button>}
      </div>
      {t?.hint && <p className="text-[11px] text-muted">{t.hint}</p>}
      {t?.needsElement && aliases.length === 0 && (
        <p className="text-[11px] text-warn">Este sistema no tiene catálogo todavía. Escaneá el sistema para poder elegir elementos.</p>
      )}
    </div>
  );
}
