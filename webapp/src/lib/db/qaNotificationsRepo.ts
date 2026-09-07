import crypto from "node:crypto";
import { withTenant } from "./tx";
import type { QaItemRow } from "./qaItemsRepo";

// DAL de notificaciones in-app del Seguimiento QA (dato del tenant → withTenant → RLS forzada). Además
// de la RLS por proyecto, la API filtra por `recipient` (email) → cada usuario ve solo las suyas.

export interface QaNotification {
  id: string; item_id: string; kind: string; text: string; read_at: string | null; created_at: string;
}

const STATUS_ES: Record<string, string> = {
  todo: "Pendiente", doing: "En curso", blocked: "Bloqueado", review: "En revisión", done: "Hecho",
};

export async function listForUser(recipient: string, limit = 30): Promise<{ notifications: QaNotification[]; unread: number }> {
  return withTenant(async (c) => {
    const r = await c.query(
      "SELECT id, item_id, kind, text, read_at, created_at FROM qa_notifications WHERE recipient = $1 ORDER BY created_at DESC LIMIT $2",
      [recipient, limit],
    );
    const u = await c.query(
      "SELECT count(*)::int AS n FROM qa_notifications WHERE recipient = $1 AND read_at IS NULL",
      [recipient],
    );
    return { notifications: r.rows as QaNotification[], unread: u.rows[0]?.n ?? 0 };
  });
}

export async function markRead(recipient: string, id: string | null): Promise<void> {
  await withTenant(async (c) => {
    if (id) {
      await c.query("UPDATE qa_notifications SET read_at = now() WHERE recipient = $1 AND id = $2 AND read_at IS NULL", [recipient, id]);
    } else {
      await c.query("UPDATE qa_notifications SET read_at = now() WHERE recipient = $1 AND read_at IS NULL", [recipient]);
    }
  });
}

export interface NotifEntry { recipient: string; kind: string; text: string }

// PURO: qué notificaciones dispara un cambio. Solo se avisa al RESPONSABLE, y nunca de sus propios
// cambios (si el que edita es el mismo responsable, no tiene sentido avisarle).
export function buildNotifications(before: QaItemRow | null, after: { title: string; status: string; assignee: string }, actor: string): NotifEntry[] {
  const out: NotifEntry[] = [];
  const to = after.assignee;
  if (!to || to === actor) return out;
  const assignedNow = to !== (before?.assignee ?? "");
  if (assignedNow) out.push({ recipient: to, kind: "assigned", text: `Te asignaron «${after.title}»` });
  if (before && before.status !== after.status && !assignedNow) {
    out.push({ recipient: to, kind: "status", text: `«${after.title}» pasó a ${STATUS_ES[after.status] ?? after.status}` });
  }
  return out;
}

// Best-effort: un fallo al notificar NO debe tumbar el guardado del pendiente.
export async function addNotifications(itemId: string, entries: NotifEntry[]): Promise<void> {
  if (!entries.length) return;
  await withTenant(async (c) => {
    for (const e of entries) {
      await c.query(
        "INSERT INTO qa_notifications(id, recipient, item_id, kind, text) VALUES($1, $2, $3, $4, $5)",
        [crypto.randomUUID(), e.recipient, itemId, e.kind, e.text],
      );
    }
  }).catch(() => { /* notificación best-effort */ });
}
