"use client";

import { useEffect, useRef, useState } from "react";

interface Notif { id: string; text: string; read_at: string | null; created_at: string }

// Campana de notificaciones in-app (en la barra superior). Muestra las notificaciones del usuario en el
// proyecto activo (asignaciones y cambios de estado). Polling suave cada 45s. Degrada en silencio si la
// tabla aún no existe (migración sin aplicar) → no molesta.
export function NotificationBell() {
  const [list, setList] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const r = await fetch("/api/notifications");
      if (!r.ok) return; // sin ruido si falla (p.ej. migración no aplicada)
      const j = await r.json();
      if (j?.ok) { setList(j.notifications ?? []); setUnread(j.unread ?? 0); }
    } catch { /* noop */ }
  }
  useEffect(() => {
    let alive = true;
    const tick = () => { if (alive) load(); };
    tick();
    const t = setInterval(tick, 45000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // cerrar al hacer clic afuera
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function markAll() {
    await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
    await load();
  }
  async function markOne(id: string) {
    await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
    await load();
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => { setOpen((v) => !v); if (!open) load(); }}
        title="Notificaciones"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-panel2 hover:text-white"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-[16px] h-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-panel shadow-xl z-20">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-semibold text-white">Notificaciones</span>
            {list.some((n) => !n.read_at) && (
              <button onClick={markAll} className="text-xs text-accent hover:underline">Marcar todas leídas</button>
            )}
          </div>
          {list.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted">No tenés notificaciones.</p>
          ) : (
            <ul className="divide-y divide-border">
              {list.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => markOne(n.id)}
                    className={`block w-full px-3 py-2 text-left hover:bg-panel2 ${n.read_at ? "opacity-60" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                      <div className="min-w-0">
                        <p className="text-xs text-gray-100">{n.text}</p>
                        <p className="text-[10px] text-muted">{new Date(n.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
