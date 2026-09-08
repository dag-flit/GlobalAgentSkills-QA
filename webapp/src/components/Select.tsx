"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

// Selector propio (reemplaza al <select> nativo) para que el hover/selección de las opciones use el
// VERDE del sistema (los <option> nativos los pinta el SO en azul y no se pueden estilar). El popup va
// con position:fixed calculado desde el disparador → no lo recorta el overflow de un modal/tarjeta.
// Teclado: ↑/↓ mueven, Enter elige, Esc cierra. Cierra al hacer clic afuera o al hacer scroll.

export interface SelectOption { value: string; label: string; group?: string }

export function Select({
  value, onChange, options, disabled, className, ariaLabel, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0); // índice resaltado
  const [pos, setPos] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);
  const label = selected ? selected.label : (placeholder ?? "—");

  function place() {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const belowSpace = window.innerHeight - r.bottom;
    const above = belowSpace < 240 && r.top > belowSpace;
    setPos({ top: above ? r.top : r.bottom, left: r.left, width: r.width, above });
  }

  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const idx = options.findIndex((o) => o.value === value);
    setHi(idx >= 0 ? idx : 0);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, options, value]);

  function pick(v: string) { onChange(v); setOpen(false); btnRef.current?.focus(); }

  function onKey(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); btnRef.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (options[hi]) pick(options[hi].value); }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKey}
        className={`flex items-center justify-between gap-2 rounded-lg border bg-panel2 px-3 py-1.5 text-left text-sm text-gray-100 focus:outline-none focus:border-accent disabled:opacity-50 ${open ? "border-accent" : "border-border"} ${className ?? ""}`}
      >
        <span className={`truncate ${selected ? "" : "text-gray-500"}`}>{label}</span>
        <span className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && pos && (
        <ul
          ref={popRef}
          role="listbox"
          style={{ position: "fixed", top: pos.above ? undefined : pos.top + 4, bottom: pos.above ? window.innerHeight - pos.top + 4 : undefined, left: pos.left, width: pos.width, maxHeight: 240, zIndex: 60 }}
          className="overflow-auto rounded-lg border border-border bg-panel py-1 shadow-xl"
        >
          {options.map((o, idx) => {
            const isSel = o.value === value;
            const isHi = idx === hi;
            const header = o.group && o.group !== options[idx - 1]?.group
              ? <li key={`g-${o.group}`} role="presentation" className="px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-muted/70">{o.group}</li>
              : null;
            return (
              <Fragment key={o.value}>
                {header}
                <li
                  role="option"
                  aria-selected={isSel}
                  onMouseEnter={() => setHi(idx)}
                  onMouseDown={(e) => { e.preventDefault(); pick(o.value); }}
                  className={`cursor-pointer px-3 py-1.5 text-sm ${isHi ? "bg-accent/15 text-accent" : isSel ? "text-accent" : "text-gray-100"}`}
                >
                  {o.label}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </>
  );
}
