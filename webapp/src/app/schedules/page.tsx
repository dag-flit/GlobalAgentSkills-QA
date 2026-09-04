"use client";

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { TokenPanel } from "@/components/schedules/TokenPanel";
import { describeCadence, type Cadence } from "@/lib/qa/cadence";

// Página «Programadas» (PRO #4): definís qué suite de qué sistema corre y con qué cadencia. El motor
// guarda next_run_at; un disparador externo (cron / GitHub Actions) golpea /api/schedule/tick con el
// token del tenant y corre lo vencido. Acá se administran los horarios y el token de servicio.

interface Named { id: string; name: string }
interface ScheduleRow {
  id: string; target_id: string; suite_id: string; cadence: Cadence; enabled: boolean;
  next_run_at: string; last_run_at: string | null; last_status: string | null;
}
type Kind = "hourly" | "daily" | "weekly";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();

export default function SchedulesPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Named[]>([]);
  const [suites, setSuites] = useState<Named[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Formulario de alta.
  const [targetId, setTargetId] = useState("");
  const [suiteId, setSuiteId] = useState("");
  const [kind, setKind] = useState<Kind>("daily");
  const [everyHours, setEveryHours] = useState(6);
  const [time, setTime] = useState("02:00");
  const [weekday, setWeekday] = useState(1);
  const [tz, setTz] = useState(LOCAL_TZ);

  const targetName = useMemo(() => Object.fromEntries(targets.map((t) => [t.id, t.name])), [targets]);

  async function loadBase() {
    setLoading(true); setError(null);
    try {
      const [me, tg, sc] = await Promise.all([
        fetch("/api/auth/me").then((r) => r.json()),
        fetch("/api/regression/targets").then((r) => r.json()),
        fetch("/api/schedule").then((r) => r.json()),
      ]);
      setTenantId(me?.tenantId ?? null);
      setTargets((tg?.targets ?? []).map((t: any) => ({ id: t.id, name: t.name })));
      if (!sc.ok) throw new Error(sc.error || "No se pudieron cargar los horarios.");
      setSchedules(sc.schedules ?? []);
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadBase(); }, []);

  // Suites del sistema elegido (para el desplegable).
  useEffect(() => {
    if (!targetId) { setSuites([]); setSuiteId(""); return; }
    fetch(`/api/regression/suites?targetId=${encodeURIComponent(targetId)}`)
      .then((r) => r.json())
      .then((j) => { const s = (j?.suites ?? []).map((x: any) => ({ id: x.id, name: x.name })); setSuites(s); setSuiteId(s[0]?.id ?? ""); })
      .catch(() => { setSuites([]); setSuiteId(""); });
  }, [targetId]);

  function buildCadence(): Cadence {
    if (kind === "hourly") return { kind: "hourly", everyHours };
    if (kind === "daily") return { kind: "daily", time, tz };
    return { kind: "weekly", weekday, time, tz };
  }

  async function save() {
    if (!targetId || !suiteId) { setError("Elegí sistema y suite."); return; }
    setBusy(true); setError(null);
    try {
      const id = (crypto as any).randomUUID ? crypto.randomUUID() : `s-${Date.now()}`;
      const r = await fetch("/api/schedule", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, targetId, suiteId, cadence: buildCadence(), enabled: true }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar.");
      await loadBase();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setBusy(false); }
  }

  async function toggle(s: ScheduleRow) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/schedule", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, targetId: s.target_id, suiteId: s.suite_id, cadence: s.cadence, enabled: !s.enabled }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo cambiar.");
      await loadBase();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/schedule", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo eliminar.");
      await loadBase();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setBusy(false); }
  }

  const inputCls = "rounded-md border border-neutral-300 px-3 py-1.5 text-sm";

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-xl font-semibold text-neutral-900">Corridas programadas</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Programá la regresión para que corra sola. Un disparador externo (cron o GitHub Actions) la
          lanza con el token de servicio; acá definís cuándo.
        </p>
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Alta de un horario */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="text-base font-semibold text-neutral-800">Nuevo horario</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-600">Sistema</span>
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputCls}>
              <option value="">— elegí —</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-600">Suite</span>
            <select value={suiteId} onChange={(e) => setSuiteId(e.target.value)} className={inputCls} disabled={!targetId}>
              {suites.length === 0 ? <option value="">— sin suites —</option> : suites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-600">Cadencia</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={inputCls}>
              <option value="hourly">Por hora</option>
              <option value="daily">Diaria</option>
              <option value="weekly">Semanal</option>
            </select>
          </label>
          {kind === "hourly" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-600">Cada cuántas horas</span>
              <input type="number" min={1} max={168} value={everyHours} onChange={(e) => setEveryHours(+e.target.value)} className={inputCls} />
            </label>
          ) : (
            <>
              {kind === "weekly" && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-neutral-600">Día</span>
                  <select value={weekday} onChange={(e) => setWeekday(+e.target.value)} className={inputCls}>
                    {DIAS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </label>
              )}
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-600">Hora (HH:MM)</span>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-600">Zona horaria (IANA)</span>
                <input value={tz} onChange={(e) => setTz(e.target.value)} className={inputCls} />
              </label>
            </>
          )}
        </div>
        <button onClick={save} disabled={busy} className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          Agregar horario
        </button>
      </section>

      {/* Lista de horarios */}
      <section className="rounded-lg border border-neutral-200 bg-white p-5">
        <h2 className="text-base font-semibold text-neutral-800">Horarios</h2>
        {loading ? (
          <div className="mt-4"><Spinner /></div>
        ) : schedules.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">Todavía no hay horarios.</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-100">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-neutral-800">
                    {targetName[s.target_id] ?? s.target_id} · <span className="text-neutral-500">{s.suite_id}</span>
                  </p>
                  <p className="text-xs text-neutral-500">
                    {describeCadence(s.cadence)} · próxima {new Date(s.next_run_at).toLocaleString()}
                    {s.last_status ? ` · última: ${s.last_status}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${s.enabled ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>
                    {s.enabled ? "activo" : "pausado"}
                  </span>
                  <button onClick={() => toggle(s)} disabled={busy} className="rounded border border-neutral-200 px-2 py-1 text-xs disabled:opacity-50">
                    {s.enabled ? "Pausar" : "Activar"}
                  </button>
                  <button onClick={() => remove(s.id)} disabled={busy} className="rounded border border-neutral-200 px-2 py-1 text-xs text-red-600 disabled:opacity-50">
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TokenPanel tenantId={tenantId} />
    </div>
  );
}
