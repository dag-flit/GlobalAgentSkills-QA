"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui";
import type { RegressionTest } from "@/lib/types";

// Importar una suite de regresión desde JSON (pegado). Genera ids nuevos y crea una suite en ESTE
// sistema. Extraído de SuiteBuilder para respetar el límite de líneas.

function genId(name: string): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "x";
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

export function SuiteImport({ targetId, onImported }: { targetId: string; onImported: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function importSuite() {
    let obj: any;
    try {
      obj = JSON.parse(text);
    } catch {
      setMsg("El JSON no es válido.");
      return;
    }
    const raw = Array.isArray(obj?.tests) ? obj.tests : null;
    if (!raw) {
      setMsg("El JSON no tiene una lista de pruebas («tests»).");
      return;
    }
    const tests: RegressionTest[] = raw.map((t: any) => ({
      id: genId(String(t?.name || "prueba")),
      name: String(t?.name || "Prueba"),
      steps: Array.isArray(t?.steps) ? t.steps.filter((s: any) => s && typeof s.op === "string") : [],
    }));
    const name = String(obj?.name || "Suite importada");
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/regression/suites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: genId(name), targetId, name, tests }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo importar.");
      setOpen(false);
      setText("");
      await onImported();
    } catch (e: any) {
      setMsg(e?.message ?? "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn-ghost text-[12px]" onClick={() => { setOpen((o) => !o); setMsg(null); }}>Importar (JSON)</button>
      {open && (
        <div className="rounded-lg border border-border p-2 space-y-2">
          <p className="text-[11px] text-muted">Pegá el JSON de una suite exportada. Se crea una suite nueva en <b>este</b> sistema (con ids nuevos). Los pasos referencian alias del catálogo: si venís de otro sistema con distinta interfaz, revisá que los elementos existan (o re-escaneá).</p>
          <textarea className="input font-mono w-full" rows={5} placeholder='{ "kind": "regression-suite", "name": "Login", "tests": [ … ] }' value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-2">
            <button className="btn-primary text-[12px]" onClick={importSuite} disabled={busy || !text.trim()}>
              {busy ? <span className="flex items-center gap-2"><Spinner /> Importando…</span> : "Importar suite"}
            </button>
            <button className="btn-ghost text-[12px]" onClick={() => { setOpen(false); setText(""); setMsg(null); }}>Cancelar</button>
            {msg && <span className="text-[11px] text-red-300">{msg}</span>}
          </div>
        </div>
      )}
    </>
  );
}
