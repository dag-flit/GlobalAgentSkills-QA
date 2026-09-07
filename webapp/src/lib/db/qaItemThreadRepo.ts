import crypto from "node:crypto";
import { withTenant } from "./tx";
import type { QaItemRow } from "./qaItemsRepo";

// DAL del HILO de un pendiente: comentarios + historial de actividad (dato del tenant → withTenant →
// RLS forzada). El autor/actor sale del contexto de auth (email), nunca del input.

export interface QaComment { id: string; item_id: string; author: string; body: string; created_at: string }
export interface QaActivity {
  id: string; item_id: string; actor: string; action: string;
  detail: Record<string, unknown>; created_at: string;
}

export async function listThread(itemId: string): Promise<{ comments: QaComment[]; activity: QaActivity[] }> {
  return withTenant(async (c) => {
    const cm = await c.query(
      "SELECT id, item_id, author, body, created_at FROM qa_item_comments WHERE item_id = $1 ORDER BY created_at",
      [itemId],
    );
    const ac = await c.query(
      "SELECT id, item_id, actor, action, detail, created_at FROM qa_item_activity WHERE item_id = $1 ORDER BY created_at",
      [itemId],
    );
    return { comments: cm.rows as QaComment[], activity: ac.rows as QaActivity[] };
  });
}

export async function addComment(args: { itemId: string; author: string; body: string }): Promise<void> {
  await withTenant(async (c) => {
    await c.query(
      "INSERT INTO qa_item_comments(id, item_id, author, body) VALUES($1, $2, $3, $4)",
      [crypto.randomUUID(), args.itemId, args.author, args.body],
    );
    await c.query(
      "INSERT INTO qa_item_activity(id, item_id, actor, action, detail) VALUES($1, $2, $3, 'comment', '{}'::jsonb)",
      [crypto.randomUUID(), args.itemId, args.author],
    );
  });
}

export interface ActivityEntry { action: string; detail: Record<string, unknown> }

// Registra las entradas de actividad de un cambio (mejor esfuerzo: un fallo NO debe tumbar el guardado
// del pendiente, que es lo importante). Se llama DESPUÉS del upsert.
export async function logActivity(itemId: string, actor: string, entries: ActivityEntry[]): Promise<void> {
  if (!entries.length) return;
  await withTenant(async (c) => {
    for (const e of entries) {
      await c.query(
        "INSERT INTO qa_item_activity(id, item_id, actor, action, detail) VALUES($1, $2, $3, $4, $5::jsonb)",
        [crypto.randomUUID(), itemId, actor, e.action, JSON.stringify(e.detail ?? {})],
      );
    }
  }).catch(() => { /* auditoría best-effort */ });
}

// PURO: qué cambió entre el estado previo (fila, o null si es nuevo) y el borrador guardado.
export interface QaDiffInput {
  status: string; priority: string; type: string; severity: string;
  assignee: string; title: string; dueDate: string | null;
}
export function diffActivity(before: QaItemRow | null, after: QaDiffInput): ActivityEntry[] {
  if (!before) return [{ action: "created", detail: {} }];
  const fields: [string, string, string][] = [
    ["estado", before.status, after.status],
    ["prioridad", before.priority, after.priority],
    ["tipo", before.type, after.type],
    ["severidad", before.severity, after.severity],
    ["responsable", before.assignee, after.assignee],
    ["título", before.title, after.title],
    ["fecha límite", before.due_date ?? "", after.dueDate ?? ""],
  ];
  const out: ActivityEntry[] = [];
  for (const [field, from, to] of fields) {
    if (String(from) !== String(to)) out.push({ action: "field", detail: { field, from, to } });
  }
  return out;
}
