"use client";

// Paso «Código» del asistente de Ejecución (modo "QA del código"). Indicás la carpeta del repo
// a analizar (relativa al directorio base permitido del server, CODE_QA_BASE_DIR). Las capas se
// DETECTAN automáticamente según lo que tenga el repo (linter/tests/OpenAPI/DB/escáner) y cada
// capa sin herramienta se OMITE sola durante la ejecución. Determinista, sin IA, sin navegador.
// La ruta se resuelve y CONFINA dentro de la base en el server (nunca una ruta libre); las
// herramientas corren en un sandbox con allowlist y timeout. Antes de avanzar, el server valida
// que la ruta apunte a un PROYECTO real (no un texto cualquiera).

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import type { AppConfig, DbConnection } from "@/lib/types";
import type { RunWizardCtl } from "./useRunWizard";

export function CodeStep({ w }: { w: RunWizardCtl }) {
  const canContinue = w.sourcePath.trim().length > 0;
  const [checking, setChecking] = useState(false);
  const [pathErr, setPathErr] = useState<string | null>(null);
  const [defaultDb, setDefaultDb] = useState<DbConnection | null>(null);

  // Trae la BD marcada por defecto (módulo de BD) para mostrar qué conexión se usaría en las pruebas.
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: AppConfig) => {
        const dbs = c.databases || [];
        setDefaultDb(dbs.find((d) => d.isDefault) ?? dbs[0] ?? null);
      })
      .catch(() => setDefaultDb(null));
  }, []);
  const dbReady = Boolean(defaultDb && defaultDb.host && defaultDb.user);

  // Valida la ruta en el server (que exista, sea un directorio confinado y parezca un proyecto)
  // antes de avanzar. Si no es un proyecto real, NO deja continuar (fix: antes cualquier string pasaba).
  async function continueStep() {
    if (!canContinue) return;
    setChecking(true);
    setPathErr(null);
    try {
      const r = await fetch("/api/code/validate-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePath: w.sourcePath.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setPathErr(j.reason || "La ruta no es válida.");
        return;
      }
      w.next();
    } catch (e: any) {
      setPathErr(e?.message ?? "No se pudo validar la ruta.");
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h2 className="font-semibold">Repositorio a analizar</h2>
        <p className="text-sm text-muted">
          Indicá la <b>carpeta del repo</b> a analizar. Si el operador definió un directorio base
          (<code>CODE_QA_BASE_DIR</code>), poné la ruta <b>relativa</b> a esa base; si no, poné la
          ruta directa de la carpeta.
        </p>
        <input
          className="input font-mono w-full"
          placeholder="C:\FLIT\mi-repo   ·   o  mi-repo  (si hay base configurada)"
          value={w.sourcePath}
          onChange={(e) => { w.setSourcePath(e.target.value); setPathErr(null); }}
          onKeyDown={(e) => e.key === "Enter" && canContinue && !checking && continueStep()}
        />
        <div className="text-[11px] text-muted rounded-lg px-3 py-2 border border-border bg-panel2/40">
          ⚙️ El modo corre las herramientas de prueba del repo <b>en el server</b>, dentro de un
          sandbox (solo herramientas de QA conocidas, con timeout). En un server compartido, definí
          <code> CODE_QA_BASE_DIR</code> para confinar el análisis a esa carpeta.
        </div>
        {pathErr && (
          <div className="text-sm rounded-lg px-3 py-2 border border-red-700 bg-red-900/30 text-red-300">
            {pathErr}
          </div>
        )}
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">Capas</h2>
        <p className="text-sm text-muted">
          Se <b>detectan automáticamente</b> según lo que tenga el repo: análisis estático
          (linter / type-checker), pruebas unitarias, contrato de API, base de datos y seguridad.
          Cada capa <b>sin herramienta en el proyecto se omite sola</b> durante la ejecución — no falla.
        </p>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">Base de datos de las pruebas</h2>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-1"
            checked={w.useDb}
            disabled={!dbReady}
            onChange={(e) => w.setUseDb(e.target.checked)}
          />
          <span>
            Usar la <b>BD configurada</b> en las pruebas
            {dbReady ? (
              <span className="text-muted">
                {" "}— <span className="font-mono">{defaultDb!.name}</span> ({defaultDb!.host}:{defaultDb!.port}/{defaultDb!.database}
                {defaultDb!.ssh?.enabled ? " · vía SSH" : ""})
              </span>
            ) : (
              <span className="text-warn"> — no hay una conexión configurada. Cargala en <b>Ajustes → Base de datos</b>.</span>
            )}
          </span>
        </label>
        <p className="text-[11px] text-muted">
          Inyecta la conexión (con la clave guardada, descifrada en el server) al entorno de las pruebas:
          conecta las <b>pruebas de integración</b> (.NET) y activa la capa <b>db</b>. La contraseña va solo
          al proceso de las pruebas, nunca al navegador. Si no lo marcás, las pruebas usan su propia configuración.
        </p>
      </div>

      <div className="card space-y-1">
        <div className="text-sm">📌 Los hallazgos se registran en una <b>HU nueva</b> en Azure</div>
        <p className="text-[11px] text-muted">
          Al ejecutar, se crea una <b>Historia de Usuario</b> (no relacionada a nada) en el
          <b> sprint en curso</b> del proyecto configurado, con la tabla de hallazgos y un
          incrementador <code>#N</code>. Además, el <b>reporte local</b> queda dentro del repo analizado.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={w.back}>← Atrás</button>
        <button className="btn-primary" onClick={continueStep} disabled={!canContinue || checking}>
          {checking ? <span className="flex items-center gap-2"><Spinner /> Validando ruta…</span> : "Continuar →"}
        </button>
      </div>
    </div>
  );
}
