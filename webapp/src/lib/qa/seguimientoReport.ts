import type { QaItem } from "@/components/seguimiento/types";
import { STATUS_LABELS, PRIORITY_LABELS, TYPE_META, SEVERITY_LABELS, isOverdue } from "@/components/seguimiento/types";

// Generadores PUROS de reportes del Seguimiento QA (CSV + HTML autocontenido imprimible). Sin efectos:
// reciben los pendientes y devuelven texto; el disparo de descarga vive en la UI. La descarga usa Blob
// + <a download> (funciona en la app real; no es un artifact).

// Se usa ';' como separador: Excel en configuración regional es/LatAm lo toma como separador de lista
// (con ',' abriría todo en una sola columna). Se escapa el campo si trae ';', comillas o salto de línea.
const SEP = ";";
const esc = (v: unknown) => {
  const s = String(v ?? "");
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const ROW = (i: QaItem): (string | number)[] => [
  i.id, i.title, TYPE_META[i.type].label, STATUS_LABELS[i.status], PRIORITY_LABELS[i.priority],
  SEVERITY_LABELS[i.severity], i.reporter, i.assignee, (i.labels ?? []).join("; "),
  i.due_date ?? "", i.ado_wi, i.created_at ?? "", i.updated_at ?? "",
];
const HEADERS = [
  "ID", "Título", "Tipo", "Estado", "Prioridad", "Severidad", "Reporter", "Responsable",
  "Etiquetas", "Fecha límite", "HU ADO", "Creado", "Actualizado",
];

export function toCsv(items: QaItem[]): string {
  const lines = [HEADERS.map(esc).join(SEP), ...items.map((i) => ROW(i).map(esc).join(SEP))];
  // BOM → Excel abre UTF-8 sin romper acentos; "sep=;" → fuerza el separador sin depender del locale.
  return "﻿sep=" + SEP + "\r\n" + lines.join("\r\n");
}

function countBy(items: QaItem[], key: (i: QaItem) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) { const k = key(i); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const h = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

export function toHtml(items: QaItem[], project: string, stamp: string): string {
  const overdue = items.filter(isOverdue).length;
  const byStatus = countBy(items, (i) => STATUS_LABELS[i.status]);
  const byType = countBy(items, (i) => TYPE_META[i.type].label);
  const byPriority = countBy(items, (i) => PRIORITY_LABELS[i.priority]);
  const byAssignee = countBy(items, (i) => i.assignee || "(sin asignar)");

  const chips = (title: string, rows: [string, number][]) =>
    `<div class="card"><h3>${h(title)}</h3>${rows.map(([k, n]) => `<span class="chip">${h(k)} <b>${n}</b></span>`).join(" ")}</div>`;

  const tableRows = items.map((i) => `<tr>
    <td>${h(i.title)}</td><td>${h(TYPE_META[i.type].label)}</td><td>${h(STATUS_LABELS[i.status])}</td>
    <td>${h(PRIORITY_LABELS[i.priority])}</td><td>${h(SEVERITY_LABELS[i.severity])}</td>
    <td>${h(i.assignee)}</td><td>${(i.labels ?? []).map(h).join(", ")}</td>
    <td${isOverdue(i) ? ' style="color:#b42318;font-weight:600"' : ""}>${h(i.due_date ?? "")}</td>
    <td>${h(i.ado_wi)}</td></tr>`).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Seguimiento QA — ${h(project)}</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;color:#101828;margin:24px;background:#fff}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#667;font-size:13px;margin-bottom:16px}
  .cards{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px}
  .card{border:1px solid #d0d5dd;border-radius:8px;padding:10px 12px;min-width:180px}
  .card h3{margin:0 0 8px;font-size:13px;color:#475467} .chip{display:inline-block;background:#f2f4f7;border-radius:12px;padding:2px 8px;margin:2px;font-size:12px}
  table{border-collapse:collapse;width:100%;font-size:12px} th,td{border:1px solid #d0d5dd;padding:5px 8px;text-align:left}
  th{background:#f9fafb} tr:nth-child(even) td{background:#fcfcfd}
  .big{font-size:26px;font-weight:700} @media print{body{margin:0}}
</style></head><body>
  <h1>Seguimiento QA — ${h(project)}</h1>
  <div class="sub">Generado ${h(stamp)} · ${items.length} pendiente(s) · ${overdue} vencido(s)</div>
  <div class="cards">
    <div class="card"><h3>Total</h3><div class="big">${items.length}</div></div>
    <div class="card"><h3>Vencidos</h3><div class="big" style="color:${overdue ? "#b42318" : "#101828"}">${overdue}</div></div>
    ${chips("Por estado", byStatus)}
    ${chips("Por prioridad", byPriority)}
    ${chips("Por tipo", byType)}
    ${chips("Por responsable", byAssignee)}
  </div>
  <table><thead><tr><th>Título</th><th>Tipo</th><th>Estado</th><th>Prioridad</th><th>Severidad</th><th>Responsable</th><th>Etiquetas</th><th>Vence</th><th>ADO</th></tr></thead>
  <tbody>${tableRows}</tbody></table>
</body></html>`;
}
