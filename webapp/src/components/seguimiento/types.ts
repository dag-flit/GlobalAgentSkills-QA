// Tipos, constantes y helpers PUROS del módulo Seguimiento QA. Compartidos por la página, el tablero,
// la tabla, el editor y los filtros → una sola fuente de verdad (sin duplicar labels/estilos).

export type QaStatus = "todo" | "doing" | "blocked" | "review" | "done";
export type QaPriority = "alta" | "media" | "baja";
export type QaType = "bug" | "task" | "test" | "improvement";
export type QaSeverity = "" | "trivial" | "menor" | "mayor" | "critica";

// Una corrida vinculada a un pendiente (del kit o de regresión). Un pendiente puede tener varias.
export interface RunLink {
  kind: string;   // "run" (kit) | "regression"
  id: string;
  title: string;
  sub: string;    // subtítulo (modo·tracker, o «N/M ok»)
  href: string | null; // corrida del kit → navegable; regresión → sin página propia
  when: string;
  status: string; // passed | failed | …
}

// Fila tal como la devuelve la API (GET /api/qa-items).
export interface QaItem {
  id: string;
  title: string;
  notes: string;
  status: QaStatus;
  priority: QaPriority;
  type: QaType;
  severity: QaSeverity;
  labels: string[];
  due_date: string | null;
  reporter: string;
  assignee: string;
  ado_wi: string;
  link_run_kind: string;
  link_run_id: string;
  link_run_meta: Record<string, unknown>;
  link_runs: RunLink[];
  position: number;
  created_at?: string;
  updated_at?: string;
}

// Cuerpo que se manda al PUT (nombres camelCase que espera el zod).
export interface QaItemDraft {
  id: string;
  title: string;
  notes: string;
  status: QaStatus;
  priority: QaPriority;
  type: QaType;
  severity: QaSeverity;
  labels: string[];
  dueDate: string | null;
  reporter: string;
  assignee: string;
  adoWi: string;
  linkRunKind: string;
  linkRunId: string;
  linkRunMeta: Record<string, unknown>;
  linkRuns: RunLink[];
  position: number;
}

export const COLUMNS: { key: QaStatus; label: string; accent: string }[] = [
  { key: "todo", label: "Pendiente", accent: "border-t-muted" },
  { key: "doing", label: "En curso", accent: "border-t-blue-500" },
  { key: "blocked", label: "Bloqueado", accent: "border-t-red-500" },
  { key: "review", label: "En revisión", accent: "border-t-warn" },
  { key: "done", label: "Hecho", accent: "border-t-accent" },
];
export const STATUS_LABELS: Record<QaStatus, string> = {
  todo: "Pendiente", doing: "En curso", blocked: "Bloqueado", review: "En revisión", done: "Hecho",
};
export const PRIORITY_LABELS: Record<QaPriority, string> = { alta: "Alta", media: "Media", baja: "Baja" };
export const PRIO_STYLE: Record<QaPriority, string> = {
  alta: "bg-red-900 text-red-300", media: "bg-panel2 text-muted", baja: "bg-panel2 text-muted",
};

export const TYPE_META: Record<QaType, { label: string; cls: string }> = {
  bug: { label: "Bug", cls: "bg-red-900 text-red-300" },
  task: { label: "Tarea", cls: "bg-panel2 text-muted" },
  test: { label: "Caso de prueba", cls: "bg-blue-900 text-blue-300" },
  improvement: { label: "Mejora", cls: "bg-green-900 text-green-300" },
};

export const SEVERITY_LABELS: Record<QaSeverity, string> = {
  "": "—", trivial: "Trivial", menor: "Menor", mayor: "Mayor", critica: "Crítica",
};
export const SEVERITY_STYLE: Record<QaSeverity, string> = {
  "": "text-muted", trivial: "text-muted", menor: "text-blue-300", mayor: "text-warn", critica: "text-red-300",
};

// ¿La fecha límite ya pasó y el pendiente no está «Hecho»? (para resaltar vencidos).
export function isOverdue(item: QaItem): boolean {
  if (!item.due_date || item.status === "done") return false;
  const today = new Date().toISOString().slice(0, 10);
  return item.due_date < today;
}

// Fila (snake_case de la API) → borrador (camelCase del PUT), sin perder campos.
export function itemToDraft(i: QaItem): QaItemDraft {
  return {
    id: i.id, title: i.title, notes: i.notes, status: i.status, priority: i.priority,
    type: i.type, severity: i.severity, labels: i.labels ?? [], dueDate: i.due_date,
    reporter: i.reporter, assignee: i.assignee, adoWi: i.ado_wi, linkRunKind: i.link_run_kind,
    linkRunId: i.link_run_id, linkRunMeta: i.link_run_meta ?? {}, linkRuns: i.link_runs ?? [],
    position: i.position,
  };
}

export function blankItem(reporter = ""): QaItem {
  const id = (crypto as { randomUUID?: () => string }).randomUUID ? crypto.randomUUID() : `q-${Date.now()}`;
  return {
    id, title: "", notes: "", status: "todo", priority: "media", type: "task", severity: "",
    labels: [], due_date: null, reporter, assignee: "", ado_wi: "", link_run_kind: "",
    link_run_id: "", link_run_meta: {}, link_runs: [], position: 0,
  };
}
