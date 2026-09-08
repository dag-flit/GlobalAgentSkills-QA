import { type TestRun, type TestResult, RESULT_META } from "@/components/testcases/runTypes";

// Generadores PUROS del reporte de una CORRIDA de pruebas (CSV + HTML autocontenido imprimible). Sin
// efectos: reciben la corrida + resultados y devuelven texto; la descarga (Blob) vive en la UI.

const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const SEP = ";";
const h = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

function coverage(results: TestResult[]): { total: number; passed: number } {
  const withHu = new Set(results.filter((r) => r.ado_wi).map((r) => r.ado_wi));
  const passed = new Set(results.filter((r) => r.ado_wi && r.status === "pass").map((r) => r.ado_wi));
  return { total: withHu.size, passed: passed.size };
}

const HEADERS = ["Caso", "Estado", "HU ADO", "Pasos", "Pasos OK", "Resultado real", "Notas", "Ejecutado por", "Fecha"];
function row(r: TestResult): (string | number)[] {
  const okSteps = (r.step_results ?? []).filter((s) => s === "pass").length;
  return [r.case_title, RESULT_META[r.status].label, r.ado_wi, (r.steps ?? []).length, okSteps,
    r.actual_result, r.notes, r.executed_by, r.executed_at ?? ""];
}

export function runToCsv(run: TestRun, results: TestResult[]): string {
  const lines = [HEADERS.map(esc).join(SEP), ...results.map((r) => row(r).map(esc).join(SEP))];
  return "﻿sep=" + SEP + "\r\n" + lines.join("\r\n");
}

export function runToHtml(run: TestRun, results: TestResult[], project: string, stamp: string): string {
  const cov = coverage(results);
  const done = run.total - run.untested;
  const pct = run.total ? Math.round((done / run.total) * 100) : 0;

  const cases = results.map((r) => {
    const stepsRows = (r.steps ?? []).map((st, i) => {
      const s = r.step_results?.[i] ?? "untested";
      return `<tr><td style="border:1px solid #d0d5dd;padding:4px 6px;color:#667">${i + 1}</td>
        <td style="border:1px solid #d0d5dd;padding:4px 6px">${h(st.action)}</td>
        <td style="border:1px solid #d0d5dd;padding:4px 6px">${h(st.expected)}</td>
        <td style="border:1px solid #d0d5dd;padding:4px 6px;font-weight:600">${h(RESULT_META[s].label)}</td></tr>`;
    }).join("");
    const stepsTable = (r.steps ?? []).length
      ? `<table style="border-collapse:collapse;width:100%;font-size:12px;margin-top:6px"><thead><tr>
          <th style="border:1px solid #d0d5dd;padding:4px 6px;background:#f9fafb">#</th>
          <th style="border:1px solid #d0d5dd;padding:4px 6px;background:#f9fafb;text-align:left">Acción</th>
          <th style="border:1px solid #d0d5dd;padding:4px 6px;background:#f9fafb;text-align:left">Esperado</th>
          <th style="border:1px solid #d0d5dd;padding:4px 6px;background:#f9fafb">Resultado</th></tr></thead><tbody>${stepsRows}</tbody></table>`
      : "";
    const extra = [r.actual_result && `<div style="font-size:12px;margin-top:4px"><b>Resultado real:</b> ${h(r.actual_result)}</div>`,
      r.notes && `<div style="font-size:12px;color:#475467"><b>Notas:</b> ${h(r.notes)}</div>`].filter(Boolean).join("");
    return `<div style="border:1px solid #d0d5dd;border-radius:8px;padding:10px 12px;margin-bottom:10px">
      <div style="font-weight:600">${h(r.case_title)} <span style="font-size:11px;color:#667">${r.ado_wi ? `· HU #${h(r.ado_wi)}` : ""} · ${h(RESULT_META[r.status].label)}</span></div>
      ${stepsTable}${extra}</div>`;
  }).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Corrida — ${h(run.name)}</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;color:#101828;margin:24px;background:#fff}h1{font-size:20px;margin:0 0 4px}
.sub{color:#667;font-size:13px;margin-bottom:14px}.cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:18px}
.card{border:1px solid #d0d5dd;border-radius:8px;padding:8px 12px;min-width:120px}.card .n{font-size:22px;font-weight:700}
.card .l{font-size:11px;color:#667}@media print{body{margin:0}}</style></head><body>
  <h1>Corrida de pruebas — ${h(run.name)}</h1>
  <div class="sub">Proyecto ${h(project)} · Iniciada por ${h(run.started_by)} · Generado ${h(stamp)}</div>
  <div class="cards">
    <div class="card"><div class="n" style="color:#14532d">${run.passed}</div><div class="l">Pasó</div></div>
    <div class="card"><div class="n" style="color:#b42318">${run.failed}</div><div class="l">Falló</div></div>
    <div class="card"><div class="n" style="color:#8a6d00">${run.blocked}</div><div class="l">Bloqueado</div></div>
    <div class="card"><div class="n">${run.untested}</div><div class="l">Sin probar</div></div>
    <div class="card"><div class="n">${pct}%</div><div class="l">Avance (${done}/${run.total})</div></div>
    ${cov.total ? `<div class="card"><div class="n">${cov.passed}/${cov.total}</div><div class="l">Cobertura HU</div></div>` : ""}
  </div>
  ${cases}
</body></html>`;
}
