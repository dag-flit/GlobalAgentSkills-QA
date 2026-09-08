// Tipos y helpers del módulo «Casos de Prueba» (Fase 1). Compartidos por la página y el editor.

export interface TestStep { action: string; expected: string }
export type TestPriority = "alta" | "media" | "baja";

export interface TestSuite { id: string; name: string; description: string; position: number }

export interface TestCase {
  id: string;
  suite_id: string | null;
  title: string;
  preconditions: string;
  priority: TestPriority;
  tags: string[];
  ado_wi: string;
  steps: TestStep[];
  position: number;
  created_at?: string;
  updated_at?: string;
}

// Cuerpo que espera el PUT /api/test-cases (camelCase del zod).
export interface TestCaseDraft {
  id: string;
  suiteId: string | null;
  title: string;
  preconditions: string;
  priority: TestPriority;
  tags: string[];
  adoWi: string;
  steps: TestStep[];
  position: number;
}

export const PRIORITY_LABELS: Record<TestPriority, string> = { alta: "Alta", media: "Media", baja: "Baja" };
export const PRIO_STYLE: Record<TestPriority, string> = {
  alta: "bg-red-900 text-red-300", media: "bg-panel2 text-muted", baja: "bg-panel2 text-muted",
};

function uid(prefix: string): string {
  return (crypto as { randomUUID?: () => string }).randomUUID ? crypto.randomUUID() : `${prefix}-${Date.now()}`;
}

export function blankCase(suiteId: string | null): TestCase {
  return {
    id: uid("tc"), suite_id: suiteId, title: "", preconditions: "", priority: "media",
    tags: [], ado_wi: "", steps: [{ action: "", expected: "" }], position: 0,
  };
}
export function blankSuiteId(): string { return uid("ts"); }

export function caseToDraft(c: TestCase): TestCaseDraft {
  return {
    id: c.id, suiteId: c.suite_id, title: c.title, preconditions: c.preconditions, priority: c.priority,
    tags: c.tags ?? [], adoWi: c.ado_wi, steps: c.steps ?? [], position: c.position,
  };
}
