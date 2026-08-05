"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui";
import type { RegressionTarget } from "@/lib/types";

// GRABADOR semi-automático (local): abrís un navegador real, navegás la app y el sistema cataloga cada
// pantalla y graba tus clics/escrituras como el recorrido — sin elegir alias a mano. Al terminar queda
// creado. El navegador se abre en la máquina donde corre el sistema (hoy, tu PC).

type Phase = "idle" | "starting" | "recording" | "stopping";

export function RecorridoRecorder({ target, onRecorded }: { target: RegressionTarget; onRecorded: (recorridoId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [name, setName] = useState("");
  const [entryRoute, setEntryRoute] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ screens: number; actions: number; url: string } | null>(null);
  const [browserClosed, setBrowserClosed] = useState(false); // navegador cerrado a mano: guardar o descartar
  const [msg, setMsg] = useState<string | null>(null);
  const [otherAcct, setOtherAcct] = useState(false); // grabar con otra cuenta (efímera)
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (poll.current) { clearInterval(poll.current); poll.current = null; }
  }
  useEffect(() => () => stopPolling(), []);

  async function start() {
    if (!name.trim()) { setMsg("Poné un nombre al recorrido (ej. Matrícula Inicial)."); return; }
    setPhase("starting");
    setMsg(null);
    setBrowserClosed(false);
    try {
      const r = await fetch("/api/regression/record/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: target.id, entryRoute, name, ...(otherAcct && user ? { username: user, password: pass } : {}) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo iniciar.");
      setId(j.id);
      setPhase("recording");
      setStatus({ screens: 0, actions: 0, url: "" });
      poll.current = setInterval(async () => {
        try {
          const s = await fetch(`/api/regression/record/status?id=${encodeURIComponent(j.id)}`);
          const sj = await s.json();
          if (sj.ok) {
            setStatus({ screens: sj.screens, actions: sj.actions, url: sj.url });
            // Cerraste el navegador a mano: dejamos de sondear pero conservamos lo capturado para
            // que puedas guardarlo o descartarlo (los botones siguen abajo).
            if (sj.closed) { stopPolling(); setBrowserClosed(true); }
          } else {
            // La sesión ya no existe: volvemos al formulario para poder arrancar de nuevo.
            stopPolling(); setPhase("idle"); setId(null); setStatus(null);
            setMsg(sj.error || "La grabación se cerró.");
          }
        } catch { /* poll best-effort */ }
      }, 1500);
    } catch (e: any) {
      setPhase("idle");
      setMsg(e?.message ?? "Error al iniciar.");
    }
  }

  async function discard() {
    setPhase("stopping");
    stopPolling();
    try {
      if (id) await fetch("/api/regression/record/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    } catch { /* best-effort */ }
    setPhase("idle");
    setId(null);
    setStatus(null);
    setBrowserClosed(false);
    setMsg("Grabación descartada. Podés arrancar de nuevo (con otra cuenta si querés).");
  }

  async function finish() {
    if (!id) return;
    setPhase("stopping");
    stopPolling();
    try {
      const r = await fetch("/api/regression/record/stop", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo terminar.");
      setMsg(`✓ Grabado: ${j.screens} pantalla(s) · ${j.actions} acción(es) · ${j.count} selector(es). Revisá los nombres de las etapas abajo.`);
      setPhase("idle");
      setId(null);
      setStatus(null);
      setBrowserClosed(false);
      setName("");
      onRecorded(j.recorridoId);
    } catch (e: any) {
      setPhase("idle");
      setMsg(e?.message ?? "Error al terminar.");
    }
  }

  const busy = phase === "starting" || phase === "stopping";

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-2 space-y-2">
      {!open ? (
        <button className="btn-primary text-[12px]" onClick={() => { setOpen(true); setMsg(null); }}>🎬 Grabar recorrido (navegás y captura solo)</button>
      ) : (
        <>
          <div className="text-[12px] font-medium">Grabar recorrido</div>
          <p className="text-[11px] text-muted">
            Se abre un navegador real (en esta máquina), inicia sesión solo y vos <b>usás la app normalmente</b>. Cada
            pantalla que pisás se cataloga completa y tus clics/escrituras quedan como el guion. Cuando termines el
            trámite, tocá <b>«Terminar»</b>.
          </p>

          {phase === "recording" || phase === "stopping" ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[12px]">
                {browserClosed ? (
                  <span className="text-amber-300">⏹ El navegador se cerró. Guardá lo capturado o descartá.</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-300"><span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" /> Grabando…</span>
                )}
                <span className="text-muted">· {status?.screens ?? 0} pantalla(s) · {status?.actions ?? 0} acción(es)</span>
              </div>
              {status?.url && !browserClosed && <div className="text-[10px] text-muted font-mono truncate" title={status.url}>{status.url}</div>}
              <div className="flex items-center gap-2">
                <button className="btn-primary text-[12px]" onClick={finish} disabled={phase === "stopping"}>
                  {phase === "stopping" ? <span className="flex items-center gap-2"><Spinner /> Guardando…</span> : "Terminar y guardar"}
                </button>
                <button className="btn-ghost text-[12px]" onClick={discard} disabled={phase === "stopping"}>Descartar</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input className="input" placeholder="Nombre del recorrido (ej. Matrícula Inicial)" value={name} onChange={(e) => setName(e.target.value)} />
                <input className="input font-mono" placeholder="Ruta de entrada (ej. /tramites/nuevo/matricula_inicial)" value={entryRoute} onChange={(e) => setEntryRoute(e.target.value)} />
              </div>

              {/* Grabar con OTRA cuenta (efímera; no se guarda). Vacío = usa las credenciales del sistema. */}
              {target.authMode === "login" && (
                otherAcct ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded border border-border/60 p-2">
                    <div className="md:col-span-2 text-[11px] text-muted flex items-center justify-between">
                      <span>Grabar con otra cuenta (solo esta grabación; no se guarda)</span>
                      <button className="btn-ghost text-[11px]" onClick={() => { setOtherAcct(false); setUser(""); setPass(""); }}>Usar la del sistema</button>
                    </div>
                    <input className="input" placeholder="Usuario" value={user} onChange={(e) => setUser(e.target.value)} />
                    <input className="input" type="password" placeholder="Clave" value={pass} onChange={(e) => setPass(e.target.value)} />
                  </div>
                ) : (
                  <button className="btn-ghost text-[11px]" onClick={() => setOtherAcct(true)}>+ Grabar con otra cuenta</button>
                )
              )}

              <div className="flex items-center gap-2">
                <button className="btn-primary text-[12px]" onClick={start} disabled={busy}>
                  {phase === "starting" ? <span className="flex items-center gap-2"><Spinner /> Abriendo navegador…</span> : "Empezar a grabar"}
                </button>
                <button className="btn-ghost text-[12px]" onClick={() => setOpen(false)} disabled={busy}>Cerrar</button>
              </div>
            </div>
          )}
        </>
      )}
      {msg && <p className="text-[11px] text-muted">{msg}</p>}
    </div>
  );
}
