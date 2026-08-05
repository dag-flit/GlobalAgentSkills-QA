"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui";

// Campo del paso «subir archivo»: en vez de escribir una ruta, el usuario SUBE un archivo de prueba
// (se guarda por tenant en el server) o ELIGE uno ya subido. El valor del paso queda como el token
// `${QA_FILES}/<nombre>`; el runner lo resuelve al archivo real en el server (nunca una ruta del cliente).

const TOKEN = "${QA_FILES}/"; // prefijo literal (NO interpolar): el runner lo reemplaza por el dir del tenant

function nameOf(value: string): string {
  return value?.startsWith(TOKEN) ? value.slice(TOKEN.length) : "";
}

export function FileField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = nameOf(value);

  async function loadList() {
    try {
      const r = await fetch("/api/regression/files");
      const j = await r.json();
      setFiles(j.files ?? []);
    } catch {
      /* lista best-effort */
    }
  }
  useEffect(() => {
    loadList();
  }, []);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/regression/files", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo subir.");
      onChange(TOKEN + j.name);
      await loadList();
    } catch (e: any) {
      setErr(e?.message ?? "Error al subir.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <span className="flex items-center gap-1.5 flex-wrap">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
      <button type="button" className="btn-ghost text-[11px]" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <span className="flex items-center gap-1"><Spinner /> Subiendo…</span> : "Subir archivo"}
      </button>
      {files.length > 0 && (
        <select className="input text-[12px]" value={current} onChange={(e) => onChange(e.target.value ? TOKEN + e.target.value : "")}>
          <option value="">— o elegí uno subido —</option>
          {files.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      )}
      {current && <span className="text-[11px] text-accent truncate max-w-[160px]" title={current}>📎 {current}</span>}
      {err && <span className="text-[11px] text-red-300">{err}</span>}
    </span>
  );
}
