"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { SECRET_MASK, type RegressionTarget } from "@/lib/types";
import { SuiteBuilder } from "./SuiteBuilder";
import { RegressionCatalog } from "./RegressionCatalog";
import { RecorridoBuilder } from "./RecorridoBuilder";

// Tarjeta de UN sistema de regresión. Un botón «Abrir» la expande en CUATRO secciones (pestañas):
//   • Pruebas   → armar/editar/correr las suites (usa el catálogo YA guardado; no re-escanea).
//   • Recorridos→ GRABAR un flujo multipantalla y convertirlo en prueba (puente → Pruebas).
//   • Catálogo  → ver el inventario de selectores (plegado + buscador); aquí vive «Escanear».
//   • Ajustes   → nombre, URL y credenciales del sistema.
// Escanear, grabar y editar son trabajos separados: el catálogo persiste, así que las pruebas abren
// sin re-escanear. Los recorridos salieron del Catálogo a su propia pestaña (antes estaban mezclados).

type Tab = "pruebas" | "recorridos" | "catalogo" | "ajustes";
const TAB_LABEL: Record<Tab, string> = { pruebas: "Pruebas", recorridos: "Recorridos", catalogo: "Catálogo", ajustes: "Ajustes" };
type Settings = { name: string; baseUrl: string; authMode: "none" | "login"; username: string; password: string };

export function SystemCard({ target, onChanged, onRemoved }: { target: RegressionTarget; onChanged: () => void; onRemoved: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("pruebas");
  const [confirming, setConfirming] = useState(false);
  // Foco entre pestañas: una prueba creada desde un recorrido abre esa suite en «Pruebas»; el botón
  // «Ver recorrido» del catálogo abre ese recorrido en «Recorridos».
  const [focusSuiteId, setFocusSuiteId] = useState<string | null>(null);
  const [focusTestId, setFocusTestId] = useState<string | null>(null);
  const [focusRecorrido, setFocusRecorrido] = useState<string | null>(null);
  const selectors = target.catalog?.pages?.reduce((n, p) => n + p.elements.length, 0) ?? 0;

  return (
    <div className={`card space-y-2 ${open ? "border-accent" : ""}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button className="flex items-center gap-2 text-left flex-1" onClick={() => setOpen((o) => !o)}>
          <span className="text-muted w-4 shrink-0">{open ? "▾" : "▸"}</span>
          <span className="text-sm">
            <span className="font-medium text-white">{target.name}</span>{" "}
            <span className="text-[11px] text-muted">
              · <code>{target.baseUrl}</code> · {target.authMode === "login" ? "con login" : "público"}
              {selectors ? ` · ${selectors} selector(es)` : " · sin catálogo"}
            </span>
          </span>
        </button>
        {/* Borrar el sistema es una cascada IRREVERSIBLE → botón discreto (gris, rojo al pasar) que abre
            una confirmación fuerte (tipear el nombre), no un borrado de un clic. */}
        <button className="btn-ghost text-[12px] text-muted hover:text-red-300" title="Eliminar sistema" onClick={() => setConfirming(true)}>Eliminar</button>
      </div>

      {confirming && <DeleteConfirm target={target} onRemoved={onRemoved} onCancel={() => setConfirming(false)} />}

      {open && (
        <div className="pt-2 border-t border-border space-y-3">
          <div className="flex items-center gap-1">
            {(["pruebas", "recorridos", "catalogo", "ajustes"] as Tab[]).map((tb) => (
              <button
                key={tb}
                className={`text-[12px] px-3 py-1.5 rounded-md ${tab === tb ? "bg-accent/15 text-accent font-medium" : "text-muted hover:text-white"}`}
                onClick={() => setTab(tb)}
              >
                {TAB_LABEL[tb]}
              </button>
            ))}
          </div>

          {tab === "pruebas" &&
            (selectors > 0 ? (
              <SuiteBuilder
                target={target}
                focusSuiteId={focusSuiteId}
                focusTestId={focusTestId}
                onFocusConsumed={() => { setFocusSuiteId(null); setFocusTestId(null); }}
              />
            ) : (
              <p className="text-[12px] text-muted">
                Este sistema todavía no tiene catálogo de selectores. Andá a <b>Recorridos</b> y <b>grabá</b> un flujo
                (llena el catálogo solo), o a <b>Catálogo → Escanear</b> una página; después armás las pruebas.
              </p>
            ))}

          {tab === "recorridos" && (
            <RecorridoBuilder
              target={target}
              focusName={focusRecorrido}
              onChanged={onChanged}
              onCreatedTest={(suiteId, testId) => { setFocusSuiteId(suiteId); setFocusTestId(testId); setFocusRecorrido(null); setTab("pruebas"); }}
            />
          )}

          {tab === "catalogo" && (
            <RegressionCatalog
              target={target}
              onChanged={onChanged}
              onEditRecorrido={(name) => { setFocusRecorrido(name); setTab("recorridos"); }}
            />
          )}

          {tab === "ajustes" && <SettingsTab target={target} onChanged={onChanged} />}
        </div>
      )}
    </div>
  );
}

// ── Confirmación FUERTE para borrar un sistema (cascada irreversible) ─────────────────────────────
// Muestra qué se borra (suites + recorridos + histórico + catálogo) y EXIGE tipear el nombre del
// sistema. Así un clic accidental en «Eliminar» no destruye nada (fue justo el accidente que hubo).
function DeleteConfirm({ target, onRemoved, onCancel }: { target: RegressionTarget; onRemoved: (id: string) => void; onCancel: () => void }) {
  const [usage, setUsage] = useState<{ suites: number; recorridos: number; runs: number } | null>(null);
  const [text, setText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const selectors = target.catalog?.pages?.reduce((n, p) => n + p.elements.length, 0) ?? 0;

  useEffect(() => {
    fetch(`/api/regression/usage?id=${encodeURIComponent(target.id)}`)
      .then((r) => r.json())
      .then((u) => { if (u?.ok) setUsage({ suites: u.suites ?? 0, recorridos: u.recorridos ?? 0, runs: u.runs ?? 0 }); })
      .catch(() => { /* si no se pudo consultar, se avisa genérico */ });
  }, [target.id]);

  const match = text.trim() === target.name.trim();
  async function confirmDelete() {
    if (!match || deleting) return;
    setDeleting(true);
    await Promise.resolve(onRemoved(target.id)); // recarga la lista → esta tarjeta desaparece
  }

  return (
    <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 space-y-2">
      <div className="text-[12px] font-semibold text-red-200">Eliminar «{target.name}» — acción IRREVERSIBLE</div>
      <p className="text-[11px] text-red-100/90">
        Se borra el sistema y su catálogo ({selectors} selector(es)), y en cascada{" "}
        {usage
          ? <b>{usage.suites} suite(s), {usage.recorridos} recorrido(s) y {usage.runs} corrida(s) del histórico</b>
          : "sus suites, recorridos e histórico"}. No se puede deshacer.
      </p>
      <label className="block text-[11px] text-red-100/90">
        Escribí <b>{target.name}</b> para confirmar:
        <input autoFocus className="input mt-1" value={text} placeholder={target.name}
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && confirmDelete()} />
      </label>
      <div className="flex items-center gap-2">
        <button
          className="rounded bg-red-500/80 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1 text-[12px]"
          onClick={confirmDelete} disabled={!match || deleting}>
          {deleting ? <span className="flex items-center gap-2"><Spinner /> Eliminando…</span> : "Eliminar definitivamente"}
        </button>
        <button className="btn-ghost text-[12px]" onClick={onCancel} disabled={deleting}>Cancelar</button>
      </div>
    </div>
  );
}

// ── Ajustes: nombre, URL y credenciales del sistema ──────────────────────────────────────────────
function SettingsTab({ target, onChanged }: { target: RegressionTarget; onChanged: () => void }) {
  const [d, setD] = useState<Settings>({
    name: target.name,
    baseUrl: target.baseUrl,
    authMode: target.authMode,
    username: target.username,
    password: target.password || "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    if (!d.name.trim() || !d.baseUrl.trim()) {
      setMsg("Poné al menos un nombre y la URL base.");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/regression/targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...d, id: target.id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo guardar.");
      setMsg("✓ Guardado.");
      onChanged();
    } catch (e: any) {
      setMsg(e?.message ?? "Error de red.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input className="input" placeholder="Nombre" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <input className="input font-mono" placeholder="https://dev.flitsas.online" value={d.baseUrl} onChange={(e) => setD({ ...d, baseUrl: e.target.value })} />
      </div>
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={d.authMode === "none"} onChange={() => setD({ ...d, authMode: "none" })} /> Sin login
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={d.authMode === "login"} onChange={() => setD({ ...d, authMode: "login" })} /> Con login
        </label>
      </div>
      {d.authMode === "login" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <input className="input" placeholder="Usuario" value={d.username} onChange={(e) => setD({ ...d, username: e.target.value })} />
          <input
            className="input"
            type="password"
            placeholder="Clave"
            value={d.password}
            onFocus={() => d.password === SECRET_MASK && setD({ ...d, password: "" })}
            onChange={(e) => setD({ ...d, password: e.target.value })}
          />
        </div>
      )}
      {d.authMode === "login" && (
        <p className="text-[11px] text-muted">La clave se guarda <b>cifrada</b> (AES-256-GCM). Al editar se muestra enmascarada; dejala así para conservarla.</p>
      )}
      <div className="flex items-center gap-2">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? <span className="flex items-center gap-2"><Spinner /> Guardando…</span> : "Guardar cambios"}
        </button>
        {msg && <span className="text-[11px] text-muted">{msg}</span>}
      </div>

      <DuplicatePanel target={target} onChanged={onChanged} />
    </div>
  );
}

// Duplicar el sistema a OTRO AMBIENTE (QA/PDN): reusa el mismo catálogo + copia las suites; solo se
// cambian URL y credenciales. Así las pruebas se reutilizan sin volver a escanear el sistema.
function DuplicatePanel({ target, onChanged }: { target: RegressionTarget; onChanged: () => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [d, setD] = useState({ name: `${target.name} (QA)`, baseUrl: "", authMode: target.authMode, username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function duplicate() {
    if (!d.name.trim() || !d.baseUrl.trim()) {
      setMsg("Poné un nombre nuevo y la URL del otro ambiente.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/regression/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId: target.id, ...d }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo duplicar.");
      setMsg(`Creado «${j.id}» con ${j.copiedSuites} suite(s) copiada(s)${j.hasCatalog ? " y el mismo catálogo" : ""}.`);
      setOpenForm(false);
      onChanged();
    } catch (e: any) {
      setMsg(e?.message ?? "Error de red.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-3 mt-2 border-t border-border space-y-2">
      <div className="text-[12px] font-medium">Reutilizar en otro ambiente (QA / PDN)</div>
      <p className="text-[11px] text-muted">
        Crea un sistema nuevo con el <b>mismo catálogo</b> y una <b>copia de todas las suites</b>, cambiando solo la
        URL y las credenciales. Las pruebas quedan listas sin volver a escanear (los alias siguen resolviendo). Si la
        interfaz del otro ambiente difiere, podés re-escanear ese sistema después.
      </p>
      {!openForm ? (
        <button className="btn-ghost text-[12px]" onClick={() => { setOpenForm(true); setMsg(null); }}>Duplicar para otro ambiente</button>
      ) : (
        <div className="space-y-2 rounded-lg border border-border p-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <input className="input" placeholder="Nombre del nuevo sistema (ej. FLIT QA)" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
            <input className="input font-mono" placeholder="https://qa.flitsas.online" value={d.baseUrl} onChange={(e) => setD({ ...d, baseUrl: e.target.value })} />
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={d.authMode === "none"} onChange={() => setD({ ...d, authMode: "none" })} /> Sin login
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={d.authMode === "login"} onChange={() => setD({ ...d, authMode: "login" })} /> Con login
            </label>
          </div>
          {d.authMode === "login" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input className="input" placeholder="Usuario del otro ambiente" value={d.username} onChange={(e) => setD({ ...d, username: e.target.value })} />
              <input className="input" type="password" placeholder="Clave del otro ambiente" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button className="btn-primary text-[12px]" onClick={duplicate} disabled={busy}>
              {busy ? <span className="flex items-center gap-2"><Spinner /> Duplicando…</span> : "Crear copia"}
            </button>
            <button className="btn-ghost text-[12px]" onClick={() => setOpenForm(false)}>Cancelar</button>
          </div>
        </div>
      )}
      {msg && <p className="text-[11px] text-muted">{msg}</p>}
    </div>
  );
}
