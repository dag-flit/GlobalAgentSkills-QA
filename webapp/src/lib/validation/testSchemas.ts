import { z } from "zod";

// Schemas del módulo «Casos de Prueba» (Fase 1: casos/suites) y sus ejecuciones (Fase 2). Separados de
// schemas.ts por el guardrail de 400 líneas; se re-exportan desde schemas.ts para no cambiar imports.

// ── Casos de Prueba (Fase 1) ────────────────────────────────────────────────
export const testSuiteSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).default(""),
  position: z.number().int().min(0).max(100000).default(0),
});
export const testSuiteDeleteSchema = z.object({ id: z.string().min(1).max(64) });
export const testStepSchema = z.object({
  action: z.string().max(1000).default(""),
  expected: z.string().max(1000).default(""),
});
export const testCaseSchema = z.object({
  id: z.string().min(1).max(64),
  suiteId: z.string().max(64).nullable().default(null),
  title: z.string().trim().min(1).max(200),
  preconditions: z.string().max(2000).default(""),
  priority: z.enum(["alta", "media", "baja"]).default("media"),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  adoWi: z.string().max(32).default(""),
  steps: z.array(testStepSchema).max(100).default([]),
  position: z.number().int().min(0).max(100000).default(0),
});
export const testCaseDeleteSchema = z.object({ id: z.string().min(1).max(64) });

// ── Ejecuciones (Fase 2) ────────────────────────────────────────────────────
const resultStatusEnum = z.enum(["untested", "pass", "fail", "blocked", "skipped"]);
export const testRunCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  suiteId: z.string().max(64).nullable().default(null),
});
export const testRunFinishSchema = z.object({ id: z.string().min(1).max(64), done: z.boolean() });
export const testRunDeleteSchema = z.object({ id: z.string().min(1).max(64) });
export const testResultUpdateSchema = z.object({
  id: z.string().min(1).max(64),
  status: resultStatusEnum,
  stepResults: z.array(resultStatusEnum).max(100).default([]),
  actualResult: z.string().max(4000).default(""),
  notes: z.string().max(4000).default(""),
});
