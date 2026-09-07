"use client";

import { useEffect, useMemo, useState } from "react";
import { Spinner } from "@/components/ui";
import { Select } from "@/components/Select";
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

  const smallBtn = "rounded-lg border border-border px-2 py-1 text-xs text-gray-200 hover:bg-panel2 disabled:opacity-50";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-bold text-white">Corridas programadas</h1>
        <p className="mt-1 text-sm text-muted">
          Programá la regresión para que corra sola. Un disparador externo (cron o GitHub Actions) la
          lanza con el token de servicio; acá definís cuándo.
        </p>
      </header>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {/* Alta de un horario */}
      <section className="card space-y-4">
        <h2 className="text-base font-semibold text-white">Nuevo horario</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted">Sistema</span>
            <Select value={targetId} onChange={setTargetId} className="w-full" placeholder="— elegí —"
              options={[{ value: "", label: "— elegí —" }, ...targets.map((t) => ({ value: t.id, label: t.name }))]} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted">Suite</span>
            <Select value={suiteId} onChange={setSuiteId} className="w-full" disabled={!targetId}
              options={suites.length === 0 ? [{ value: "", label: "— sin suites —" }] : suites.map((s) => ({ value: s.id, label: s.name }))} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-muted">Cadencia</span>
            <Select value={kind} onChange={(v) => setKind(v as Kind)} className="w-full"
              options={[{ value: "hourly", label: "Por hora" }, { value: "daily", label: "Diaria" }, { value: "weekly", label: "Semanal" }]} />
          </label>
          {kind === "hourly" ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted">Cada cuántas horas</span>
              <input type="number" min={1} max={168} value={everyHours} onChange={(e) => setEveryHours(+e.target.value)} className="input" />
            </label>
          ) : (
            <>
              {kind === "weekly" && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-muted">Día</span>
                  <Select value={String(weekday)} onChange={(v) => setWeekday(+v)} className="w-full"
                    options={DIAS.map((d, i) => ({ value: String(i), label: d }))} />
                </label>
              )}
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted">Hora (HH:MM)</span>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-muted">Zona horaria (IANA)</span>
                <input value={tz} onChange={(e) => setTz(e.target.value)} className="input" />
              </label>
            </>
          )}
        </div>
        <button onClick={save} disabled={busy} className="btn-primary">
          Agregar horario
        </button>
      </section>

      {/* Lista de horarios */}
      <section className="card">
        <h2 className="text-base font-semibold text-white">Horarios</h2>
        {loading ? (
          <div className="mt-4"><Spinner /></div>
        ) : schedules.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Todavía no hay horarios.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-gray-100">
                    {targetName[s.target_id] ?? s.target_id} · <span className="text-muted">{s.suite_id}</span>
                  </p>
                  <p className="text-xs text-muted">
                    {describeCadence(s.cadence)} · próxima {new Date(s.next_run_at).toLocaleString()}
                    {s.last_status ? ` · última: ${s.last_status}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${s.enabled ? "bg-green-900 text-green-300" : "bg-panel2 text-muted"}`}>
                    {s.enabled ? "activo" : "pausado"}
                  </span>
                  <button onClick={() => toggle(s)} disabled={busy} className={smallBtn}>
                    {s.enabled ? "Pausar" : "Activar"}
                  </button>
                  <button onClick={() => remove(s.id)} disabled={busy} className="rounded-lg border border-border px-2 py-1 text-xs text-red-300 hover:bg-panel2 disabled:opacity-50">
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
