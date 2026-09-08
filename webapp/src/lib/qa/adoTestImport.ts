import { getAzureAdapter } from "./adoImport";
import { importAdoTestCases, type AdoTestCaseRow } from "@/lib/db/qaTestCasesRepo";

// Puente webapp → Azure Test Plans (Fase 3 de Casos de Prueba). Trae planes/suites para elegir y luego
// importa los TEST CASES de una suite CON SUS PASOS al módulo local. Una vía (solo lectura de ADO; el
// PAT vive en el server). Reusa el adapter del tenant de adoImport.

interface AdoTC { id: string; title: string; steps: { action: string; expected: string }[] }

export async function listAdoTestPlans(): Promise<{ ok: boolean; plans?: { id: string; name: string }[]; error?: string }> {
  try {
    const adapter = await getAzureAdapter();
    return { ok: true, plans: await adapter.listTestPlans() };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
}

export async function listAdoTestSuites(planId: string): Promise<{ ok: boolean; suites?: { id: string; name: string }[]; error?: string }> {
  try {
    const adapter = await getAzureAdapter();
    return { ok: true, suites: await adapter.listTestSuites(planId) };
  } catch (e: any) { return { ok: false, error: e?.message ?? String(e) }; }
}

export async function importAdoTestPlan(
  req: { planId: string; suiteId: string; targetSuiteId: string | null },
): Promise<{ ok: boolean; fetched: number; created: number; updated: number; error?: string }> {
  try {
    const adapter = await getAzureAdapter();
    const tcs: AdoTC[] = await adapter.importTestCases({ planId: req.planId, suiteId: req.suiteId });
    if (!tcs.length) return { ok: true, fetched: 0, created: 0, updated: 0 };
    const rows: AdoTestCaseRow[] = tcs.map((t) => ({ adoWi: String(t.id), title: t.title || `Caso ${t.id}`, steps: t.steps ?? [] }));
    const { created, updated } = await importAdoTestCases(rows, req.targetSuiteId);
    return { ok: true, fetched: tcs.length, created, updated };
  } catch (e: any) { return { ok: false, fetched: 0, created: 0, updated: 0, error: e?.message ?? String(e) }; }
}
