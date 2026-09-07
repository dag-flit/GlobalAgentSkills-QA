"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";

// Hilo de un pendiente: timeline unificado de comentarios + actividad (auditoría) + caja para comentar.
// Solo se muestra para pendientes YA guardados (los nuevos aún no tienen hilo). Lee/escribe en
// /api/qa-items/thread (acotado al proyecto por RLS).

interface Comment { id: string; author: string; body: string; created_at: string }
interface Activity { id: string; actor: string; action: string; detail: { field?: string; from?: string; to?: string }; created_at: string }
type Entry =
  | { at: string; kind: "comment"; who: string; body: string }
  | { at: string; kind: "activity"; who: string; text: string };

function val(s?: string) { return s && s.length ? `«${s}»` : "(vacío)"; }
function activityText(a: Activity): string {
  if (a.action === "created") return "creó el pendiente";
  if (a.action === "field") return `cambió ${a.detail.field} de ${val(a.detail.from)} a ${val(a.detail.to)}`;
  return "actualizó el pendiente";
}

export function ItemThread({ itemId }: { itemId: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const r = await fetch(`/api/qa-items/thread?itemId=${encodeURIComponent(itemId)}`);
      if (!r.ok) throw new Error(`No se pudo cargar el hilo (HTTP ${r.status}).`);
      const j = await r.json();
      const merged: Entry[] = [
        ...((j.comments ?? []) as Comment[]).map((c) => ({ at: c.created_at, kind: "comment" as const, who: c.author, body: c.body })),
        ...((j.activity ?? []) as Activity[]).filter((a) => a.action !== "comment").map((a) => ({ at: a.created_at, kind: "activity" as const, who: a.actor, text: activityText(a) })),
      ].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
      setEntries(merged);
    } catch (e: any) { setError(e?.message ?? "Error de red."); setEntries([]); }
  }
  useEffect(() => { load(); }, [itemId]);

  async function comment() {
    const value = body.trim();
    if (!value) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/qa-items/thread", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, body: value }),
      });
      const j = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo comentar.");
      setBody(""); await load();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <h3 className="text-sm font-semibold text-white">Actividad y comentarios</h3>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      {entries === null ? (
        <div className="py-3"><Spinner /></div>
      ) : entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted">Sin actividad todavía.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {entries.map((e, idx) => (
            <li key={idx} className="text-xs">
              {e.kind === "comment" ? (
                <div className="rounded-lg border border-border bg-panel2 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-gray-200">{e.who}</span>
                    <span className="text-[10px] text-muted">{new Date(e.at).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-gray-100">{e.body}</p>
                </div>
              ) : (
                <p className="text-muted">
                  <span className="text-gray-300">{e.who}</span> {e.text}
                  <span className="ml-1 text-[10px]">· {new Date(e.at).toLocaleString()}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex items-start gap-2">
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)} rows={2}
          placeholder="Escribí un comentario…"
          className="flex-1 rounded-lg border border-border bg-panel2 px-2 py-1.5 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-accent"
        />
        <button onClick={comment} disabled={busy || !body.trim()} className="btn-primary py-1.5 text-xs">
          {busy ? "…" : "Comentar"}
        </button>
      </div>
    </div>
  );
}
