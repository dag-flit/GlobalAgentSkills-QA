import path from "node:path";
import { tenantDir } from "@/lib/paths";
import { filesDir } from "@/lib/qa/regressionFiles";
import { getTarget } from "@/lib/db/regressionTargetsRepo";
import { getSuite } from "@/lib/db/regressionSuitesRepo";
import { saveHistoryRun } from "@/lib/db/regressionHistoryRepo";
import { runSuite } from "@/lib/qa/regressionRun";
import { listDueSchedules, markScheduleRun } from "@/lib/db/schedulesRepo";
import { computeNextRun } from "./cadence";

// Corre los horarios VENCIDOS del tenant ACTIVO. DEBE llamarse dentro de runInTenant(tenantId).
// Reusa exactamente el mismo camino que POST /api/regression/run (runSuite + histórico). Secuencial
// (un navegador a la vez) para no saturar la máquina; el evento loop sigue vivo (exec async).

export interface TickResult {
  ran: Array<{ id: string; suite: string; status: string; runId: string | null }>;
  skipped: Array<{ id: string; reason: string }>;
}

export async function runDueSchedules(tenantId: string): Promise<TickResult> {
  const now = new Date();
  const due = await listDueSchedules(now);
  const out: TickResult = { ran: [], skipped: [] };

  for (const s of due) {
    const next = computeNextRun(s.cadence, now);
    const target = await getTarget(s.target_id);
    const suite = target ? await getSuite(s.target_id, s.suite_id) : null;
    if (!target || !suite) {
      // El sistema/suite ya no existe → se salta, pero se AVANZA el turno para no reintentar en bucle.
      await markScheduleRun(s.id, { lastRunAt: now, nextRunAt: next, lastRunId: null, lastStatus: "skipped" });
      out.skipped.push({ id: s.id, reason: !target ? "sistema inexistente" : "suite inexistente" });
      continue;
    }

    const evidenceBase = path.join(tenantDir(tenantId), "regression-evidence");
    const r = await runSuite(target, suite, { evidenceBase, filesDir: filesDir(tenantId) });
    const status = !r.ok ? "error" : r.failed > 0 ? "failed" : "passed";

    if (r.ok && r.runId) {
      await saveHistoryRun({
        targetId: s.target_id, suiteId: s.suite_id, suiteName: suite.name, systemName: target.name,
        runId: r.runId, total: r.tests.length, passed: r.passed, failed: r.failed, flaky: r.flaky ?? 0,
        tests: r.tests.map((t) => ({
          id: t.id, name: t.name, status: t.status, flaky: t.flaky, attempts: t.attempts,
          kinds: Array.from(new Set((t.cases ?? []).filter((c) => c.status === "fail" && c.kind).map((c) => c.kind!))),
        })),
      }).catch(() => {});
    }

    await markScheduleRun(s.id, { lastRunAt: now, nextRunAt: next, lastRunId: r.runId ?? null, lastStatus: status });
    out.ran.push({ id: s.id, suite: suite.name, status, runId: r.runId ?? null });
  }

  return out;
}
