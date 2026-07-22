"use client";

import { useMemo, useRef, useState } from "react";
import { KIND_META, type AliasOption } from "@/lib/qa/regressionSteps";

// Selector BUSCABLE de un elemento del catálogo. Reemplaza al <select> plano: filtra por nombre/tipo/
// página (sin acentos), agrupa por página y muestra ícono + tipo → distingue elementos con el mismo
// texto (título vs botón «Iniciar Sesión») y escala aunque el catálogo crezca a decenas de elementos.

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function AliasPicker({
  options,
  value,
  onChange,
}: {
  options: AliasOption[];
  value: string;
  onChange: (alias: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.alias === value) ?? null;

  const groups = useMemo(() => {
    const words = norm(q.trim()).split(/\s+/).filter(Boolean);
    const m = new Map<string, AliasOption[]>();
    for (const o of options) {
      const hay = norm(`${o.name} ${o.alias} ${o.page} ${KIND_META[o.kind].label}`);
      if (words.length && !words.every((w) => hay.includes(w))) continue;
      if (!m.has(o.page)) m.set(o.page, []);
      m.get(o.page)!.push(o);
    }
    return [...m.entries()];
  }, [q, options]);

  function pick(alias: string) {
    onChange(alias);
    setOpen(false);
    setQ("");
  }

  return (
    <div
      className="relative"
      ref={boxRef}
      onBlur={(e) => {
        if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="input flex items-center justify-between gap-2 min-w-[200px] max-w-[280px] text-left"
        onClick={() => setOpen((o) => !o)}
      >
        {selected ? (
          <span className="flex items-center gap-1 truncate">
            <span>{KIND_META[selected.kind].icon}</span>
            <span className="truncate">{selected.name}</span>
          </span>
        ) : (
          <span className="text-muted">— elegí un elemento —</span>
        )}
        <span className="text-muted shrink-0">▾</span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-[320px] max-h-[320px] overflow-auto rounded-lg border border-border bg-panel shadow-lg p-1">
          <input
            autoFocus
            className="input w-full mb-1"
            placeholder="Buscar… (nombre, tipo o página)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {groups.length === 0 && <div className="text-[11px] text-muted px-2 py-3">Sin resultados para «{q}».</div>}
          {groups.map(([page, items]) => (
            <div key={page}>
              <div className="text-[10px] uppercase tracking-wide text-muted px-2 pt-2 pb-0.5">{page}</div>
              {items.map((o) => (
                <button
                  key={o.alias}
                  type="button"
                  onClick={() => pick(o.alias)}
                  className={`w-full text-left flex items-start gap-2 rounded px-2 py-1 hover:bg-panel2 ${o.alias === value ? "bg-panel2" : ""}`}
                >
                  <span className="mt-0.5 shrink-0">{KIND_META[o.kind].icon}</span>
                  <span className="min-w-0">
                    <span className="block text-[12px] truncate">{o.name}</span>
                    <span className="block text-[10px] text-muted truncate">
                      {KIND_META[o.kind].label} · {o.alias}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
