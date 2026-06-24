import fs from "node:fs";
import { RUNS_FILE, ensureDataDirs } from "./paths";
import type { RunRecord } from "./types";

// Cache en globalThis para sobrevivir al HMR de Next en dev.
const g = globalThis as any;
function cache(): Map<string, RunRecord> {
  if (!g.__qofRuns) {
    g.__qofRuns = new Map<string, RunRecord>();
    try {
      ensureDataDirs();
      if (fs.existsSync(RUNS_FILE)) {
        const arr: RunRecord[] = JSON.parse(fs.readFileSync(RUNS_FILE, "utf-8"));
        for (const r of arr) g.__qofRuns.set(r.id, r);
      }
    } catch {
      /* arranca vacío */
    }
  }
  return g.__qofRuns;
}

function persist(): void {
  ensureDataDirs();
  const arr = [...cache().values()];
  const tmp = RUNS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2), "utf-8");
  fs.renameSync(tmp, RUNS_FILE);
}

export function saveRun(record: RunRecord): void {
  cache().set(record.id, record);
  persist();
}

export function getRun(id: string): RunRecord | undefined {
  return cache().get(id);
}

export function listRuns(): RunRecord[] {
  return [...cache().values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
