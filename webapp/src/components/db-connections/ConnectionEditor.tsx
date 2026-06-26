import type { DbEngine } from "@/lib/types";
import { Field } from "@/components/ui";
import { ENGINES, SECRET_MASK, hasEdgeSpaces } from "./helpers";
import { SshTunnelConfig } from "./SshTunnelConfig";
import { TestResult } from "./TestResult";
import type { DbConnectionsCtl } from "./useDbConnections";

/** Editor de la conexión seleccionada: campos, SSL, túnel SSH, prueba y acciones. */
export function ConnectionEditor({ c }: { c: DbConnectionsCtl }) {
  const selected = c.selected!;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Nombre" hint="Etiqueta amigable, ej. «Local Postgres»">
          <input className="input" value={selected.name} onChange={(e) => c.patchSelected({ name: e.target.value })} />
        </Field>
        <Field label="Motor">
          <select
            className="input"
            value={selected.engine}
            onChange={(e) => {
              const engine = e.target.value as DbEngine;
              const def = ENGINES.find((x) => x.value === engine)?.defaultPort ?? selected.port;
              c.patchSelected({ engine, port: def });
            }}
          >
            {ENGINES.map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <Field label="Host" hint="ej. localhost">
            <input className="input" value={selected.host} onChange={(e) => c.patchSelected({ host: e.target.value })} />
          </Field>
        </div>
        <Field label="Puerto">
          <input
            className="input"
            type="number"
            value={selected.port}
            onChange={(e) => c.patchSelected({ port: Number(e.target.value) || 0 })}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Field label="Base de datos">
          <input className="input" value={selected.database} onChange={(e) => c.patchSelected({ database: e.target.value })} />
        </Field>
        <Field label="Usuario">
          <input className="input" value={selected.user} onChange={(e) => c.patchSelected({ user: e.target.value })} />
        </Field>
        <Field label="Contraseña" hint="Se guarda local y se enmascara">
          <input
            className="input"
            type="password"
            value={selected.password}
            onChange={(e) => c.patchSelected({ password: e.target.value })}
          />
          {selected.password !== SECRET_MASK && hasEdgeSpaces(selected.password) && (
            <div className="mt-1 flex items-center gap-2 text-[11px] text-warn">
              <span>⚠ La contraseña tiene espacios al inicio/final.</span>
              <button
                type="button"
                className="underline hover:text-amber-300"
                onClick={() => c.patchSelected({ password: selected.password.trim() })}
              >
                Quitar espacios
              </button>
            </div>
          )}
        </Field>
      </div>

      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={selected.ssl} onChange={(e) => c.patchSelected({ ssl: e.target.checked })} />
          Usar SSL/TLS
        </label>
        {selected.ssl && (
          <label className="flex items-center gap-2 text-xs text-muted pl-6">
            <input
              type="checkbox"
              checked={!!selected.sslAllowSelfSigned}
              onChange={(e) => c.patchSelected({ sslAllowSelfSigned: e.target.checked })}
            />
            Aceptar certificado no confiable (self-signed) — por defecto se verifica
          </label>
        )}
      </div>

      <SshTunnelConfig selected={selected} patchSsh={c.patchSsh} />

      <TestResult test={c.test} />

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
        <button className="btn-ghost" onClick={c.runTest} disabled={c.test.status === "testing"}>
          🔌 Probar conexión
        </button>
        <button className="btn-primary" onClick={c.save} disabled={c.saving}>
          {c.saving ? "Guardando…" : "Guardar"}
        </button>
        <button className="btn-ghost" onClick={c.makeDefault} disabled={selected.isDefault}>
          Marcar como default
        </button>
        <button className="btn-danger ml-auto" onClick={c.deleteSelected}>
          Eliminar
        </button>
        {c.savedMsg && <span className="text-xs text-muted">{c.savedMsg}</span>}
      </div>
    </div>
  );
}
