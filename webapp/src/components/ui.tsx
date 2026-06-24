"use client";

import type { RunStatus } from "@/lib/types";

export const STATUS_STYLE: Record<RunStatus, { label: string; cls: string }> = {
  pending: { label: "En cola", cls: "bg-panel2 text-muted" },
  running: { label: "Ejecutando", cls: "bg-blue-900 text-blue-300" },
  passed: { label: "OK", cls: "bg-green-900 text-green-300" },
  failed: { label: "Fallo", cls: "bg-amber-900 text-amber-300" },
  error: { label: "Error", cls: "bg-red-900 text-red-300" },
  stopped: { label: "Detenido", cls: "bg-gray-800 text-gray-400" },
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function Spinner() {
  return (
    <span className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
  );
}

export function fmtTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CO");
  } catch {
    return iso;
  }
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted mt-1">{hint}</p>}
    </div>
  );
}
