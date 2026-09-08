// Tipos y estilos de las EJECUCIONES (Fase 2). Compartidos por la lista de corridas y el detalle.
import type { TestStep } from "./types";

export type ResultStatus = "untested" | "pass" | "fail" | "blocked" | "skipped";

export interface TestRun {
  id: string; name: string; suite_id: string | null; status: string;
  started_by: string; started_at: string; finished_at: string | null;
  total: number; passed: number; failed: number; blocked: number; untested: number;
}
export interface TestResult {
  id: string; run_id: string; case_id: string; case_title: string; ado_wi: string;
  steps: TestStep[]; step_results: ResultStatus[]; status: ResultStatus;
  actual_result: string; notes: string; executed_by: string; executed_at: string | null; position: number;
}

export const RESULT_META: Record<ResultStatus, { label: string; cls: string }> = {
  untested: { label: "Sin probar", cls: "bg-panel2 text-muted" },
  pass: { label: "Pasó", cls: "bg-green-900 text-green-300" },
  fail: { label: "Falló", cls: "bg-red-900 text-red-300" },
  blocked: { label: "Bloqueado", cls: "bg-amber-900 text-amber-300" },
  skipped: { label: "Omitido", cls: "bg-gray-800 text-gray-400" },
};
// Orden de los botones de estado (para pasos y casos).
export const RESULT_CYCLE: ResultStatus[] = ["pass", "fail", "blocked", "skipped", "untested"];

// Deriva el estado del CASO a partir de los estados de sus pasos (sin pasos → queda el manual).
export function deriveCaseStatus(stepResults: ResultStatus[]): ResultStatus {
  if (!stepResults.length) return "untested";
  if (stepResults.some((s) => s === "fail")) return "fail";
  if (stepResults.some((s) => s === "blocked")) return "blocked";
  if (stepResults.every((s) => s === "pass")) return "pass";
  if (stepResults.every((s) => s === "skipped")) return "skipped";
  if (stepResults.some((s) => s === "untested")) return "untested";
  return "pass";
}
