"use client";

import { useState } from "react";

// Confirmación FUERTE para eliminar un proyecto: hay que tipear el nombre exacto (la eliminación es en
// cascada e irreversible — se lleva regresión, seguimiento, horarios, config, todo). Owner-only en la API.
export function DeleteProjectModal({
  name, busy, onConfirm, onCancel,
}: {
  name: string;
  busy: boolean;
  onConfirm: (confirmName: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const match = text.trim() === name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-xl border border-border bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-white">Eliminar proyecto</h2>
        <p className="mt-2 text-sm text-muted">
          Vas a eliminar <b className="text-gray-100">{name}</b> y <b className="text-red-300">todo su contenido</b>
          {" "}(pendientes, regresión, horarios, config). Es <b>irreversible</b>.
        </p>
        <label className="mt-4 block text-sm">
          <span className="label">Escribí el nombre exacto para confirmar</span>
          <input value={text} onChange={(e) => setText(e.target.value)} className="input" autoFocus placeholder={name} />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost">Cancelar</button>
          <button onClick={() => onConfirm(text.trim())} disabled={!match || busy} className="btn-danger">
            {busy ? "Eliminando…" : "Eliminar definitivamente"}
          </button>
        </div>
      </div>
    </div>
  );
}
