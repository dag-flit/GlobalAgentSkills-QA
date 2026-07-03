"use client";

import { useState } from "react";
import type { RunWizardCtl } from "./useRunWizard";

// Panel «Importar / Exportar guion (JSON)». Pegar el JSON de un guion (p.ej. el que produce un
// análisis externo) y cargarlo en el constructor de un solo pegado, o exportar lo ya armado para
// copiarlo/compartirlo. NO ejecuta el texto: solo lo interpreta como lista de pasos y valida cada
// `op` contra el catálogo (useRunWizard.importFlowJson). Las credenciales viajan como ${VAR}.
export function FlowImportExport({ w }: { w: RunWizardCtl }) {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const doImport = () => {
    const err = w.importFlowJson(text.trim());
    setMsg(err ? { kind: "err", text: err } : { kind: "ok", text: "Guion cargado en el constructor. Revisalo abajo." });
  };
  const doExport = () => {
    const json = w.exportFlowJson();
    setText(json);
    setMsg({ kind: "ok", text: "Guion exportado abajo. Copialo con el botón o selección." });
  };
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg({ kind: "ok", text: "Copiado al portapapeles." });
    } catch {
      setMsg({ kind: "err", text: "No se pudo copiar; seleccioná el texto manualmente." });
    }
  };

  return (
    <div className="card space-y-2">
      <div className="text-sm font-medium">Importar / Exportar guion (JSON)</div>
      <p className="text-[11px] text-muted">
        Pegá un guion en JSON y <b>Importar</b> para llenar el constructor de una vez, o{" "}
        <b>Exportar</b> lo que ya armaste. Es una lista de pasos; las claves nunca se guardan acá
        (se referencian como <code>{"${QA_USER}"}</code> / <code>{"${QA_PASS}"}</code>).
      </p>
      <textarea
        className="input font-mono w-full h-40"
        placeholder='[ { "op": "ir_a", "url": "https://…" }, { "op": "clic", "por": "boton", "en": "Iniciar Sesión" } ]'
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button className="btn-ghost" onClick={doImport} disabled={!text.trim()} title="Toma el JSON pegado y llena los pasos del constructor">⤴ Importar (pegar → llenar los pasos)</button>
        <button className="btn-ghost" onClick={doExport} title="Convierte los pasos que armaste en JSON, acá abajo">⤓ Exportar (mis pasos → JSON)</button>
        <button className="btn-ghost" onClick={doCopy} disabled={!text.trim()}>⧉ Copiar</button>
      </div>
      {msg && (
        <p className={`text-[11px] ${msg.kind === "err" ? "text-red-300" : "text-green-300"}`}>{msg.text}</p>
      )}
    </div>
  );
}
