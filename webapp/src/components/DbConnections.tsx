"use client";

import { useEffect, useState } from "react";
import type { AppConfig, DbConnection, DbEngine, SshAuthMethod, SshConfig } from "@/lib/types";
import { Field, Spinner } from "@/components/ui";
import { useAction } from "@/components/ActionFeedback";

function defaultSsh(): SshConfig {
  return {
    enabled: false,
    host: "",
    port: 22,
    user: "",
    authMethod: "password",
    password: "",
    privateKeyPath: "",
    passphrase: "",
    forwardHost: "",
    forwardPort: 0,
  };
}

const ENGINES: { value: DbEngine; label: string; defaultPort: number }[] = [
  { value: "postgres", label: "PostgreSQL", defaultPort: 5432 },
  { value: "mysql", label: "MySQL / MariaDB", defaultPort: 3306 },
  { value: "mssql", label: "SQL Server", defaultPort: 1433 },
];

type DbTarget = {
  engine: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
  hasPassword: boolean;
  passwordHasEdgeSpaces: boolean;
  viaSsh: boolean;
};

const SECRET_MASK = "••••••••";

/** ¿El texto tiene espacios (u otros blancos) al inicio o al final? */
function hasEdgeSpaces(s: string): boolean {
  return Boolean(s) && s !== s.trim();
}
type TestState = {
  status: "idle" | "testing" | "ok" | "err";
  message?: string;
  hint?: string;
  target?: DbTarget;
};

/** Convierte el error del driver en una pista accionable en español. */
function hintFor(message: string, t?: DbTarget): string | undefined {
  const m = (message || "").toLowerCase();
  if (/all configured authentication methods failed/.test(m))
    return "El servidor SSH rechazó las credenciales. Revisa el usuario y la contraseña (o la llave) del túnel SSH.";
  if (/handshake|getaddrinfo.*22|ssh/.test(m))
    return "No se pudo establecer la sesión SSH. Revisa el host, puerto y credenciales del servidor SSH.";
  if (/does not support ssl/.test(m))
    return "Tu servidor no acepta SSL. Desmarca «Usar SSL/TLS» y vuelve a probar (normal en localhost).";
  if (/password|autentificaci|authentication/.test(m))
    return `Usuario o contraseña de la BD incorrectos para «${t?.user ?? "?"}». Verifica también que ese usuario tenga acceso a la base «${t?.database ?? "?"}».`;
  if (/econnrefused/.test(m))
    return `No hay nadie escuchando en el destino. ${t?.viaSsh ? "Revisa el forward host/puerto (la BD vista desde el servidor SSH)." : `Revisa host/puerto (${t?.host}:${t?.port}) y que el servidor esté encendido.`}`;
  if (/enotfound|getaddrinfo/.test(m)) return `No se pudo resolver el host${t?.viaSsh ? " del servidor SSH" : ` «${t?.host}»`}.`;
  if (/no existe la base|database .* does not exist/.test(m))
    return `La base «${t?.database}» no existe. Revisa el nombre.`;
  if (/timeout|timed out/.test(m)) return `Tiempo de espera agotado conectando a ${t?.host}:${t?.port}.`;
  return undefined;
}

function newConnection(): DbConnection {
  return {
    id: `db-${Date.now()}`,
    name: "Nueva conexión",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "",
    user: "postgres",
    password: "",
    ssl: false,
    ssh: defaultSsh(),
    isDefault: false,
  };
}

export function DbConnections() {
  const action = useAction();
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: AppConfig) => {
        setCfg(c);
        setSelectedId(c.databases.find((d) => d.isDefault)?.id ?? c.databases[0]?.id ?? null);
      })
      .catch(() =>
        setCfg({
          databases: [],
          tracker: {
            selected: "local",
            azure: { orgUrl: "", project: "", pat: "", userEmail: "" },
            github: { repository: "", token: "" },
            jira: { baseUrl: "", email: "", token: "", projectKey: "" },
          },
        })
      );
  }, []);

  if (!cfg) {
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> Cargando conexiones…
      </div>
    );
  }

  const selected = cfg.databases.find((d) => d.id === selectedId) ?? null;

  function patchSelected(patch: Partial<DbConnection>) {
    if (!selected) return;
    setCfg((c) => ({
      ...c!,
      databases: c!.databases.map((d) => (d.id === selected.id ? { ...d, ...patch } : d)),
    }));
    setTest({ status: "idle" });
    setSavedMsg(null);
  }

  function patchSsh(patch: Partial<SshConfig>) {
    if (!selected) return;
    const base = selected.ssh ?? defaultSsh();
    patchSelected({ ssh: { ...base, ...patch } });
  }

  function addConnection() {
    const conn = newConnection();
    if (cfg!.databases.length === 0) conn.isDefault = true;
    setCfg((c) => ({ ...c!, databases: [...c!.databases, conn] }));
    setSelectedId(conn.id);
    setSavedMsg(null);
    action.notify("Conexión añadida — recuerda Guardar para conservarla");
  }

  function deleteSelected() {
    if (!selected) return;
    const name = selected.name || "(sin nombre)";
    const rest = cfg!.databases.filter((d) => d.id !== selected.id);
    // si borramos la default, promover la primera restante
    if (selected.isDefault && rest.length) rest[0].isDefault = true;
    setCfg((c) => ({ ...c!, databases: rest }));
    setSelectedId(rest[0]?.id ?? null);
    setSavedMsg(null);
    action.notify(`Conexión «${name}» eliminada — recuerda Guardar`);
  }

  function makeDefault() {
    if (!selected) return;
    setCfg((c) => ({
      ...c!,
      databases: c!.databases.map((d) => ({ ...d, isDefault: d.id === selected.id })),
    }));
    setSavedMsg(null);
    action.notify(`«${selected.name || "(sin nombre)"}» marcada como default — recuerda Guardar`);
  }

  async function save() {
    setSaving(true);
    setSavedMsg(null);
    await action
      .run({ loading: "Guardando conexiones…", success: "Conexiones guardadas correctamente" }, async () => {
        const r = await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cfg),
        });
        if (!r.ok) throw new Error("No se pudo guardar la configuración");
        const updated: AppConfig = await r.json();
        setCfg(updated);
        setSavedMsg("Guardado ✓");
      })
      .catch(() => setSavedMsg("No se pudo guardar"))
      .finally(() => setSaving(false));
  }

  async function runTest() {
    if (!selected) return;
    setTest({ status: "testing" });
    await action
      .run(
        { loading: "Probando conexión a la base de datos…", success: (m) => String(m) },
        async () => {
          let res: any;
          try {
            const r = await fetch("/api/db/test", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ db: selected }),
            });
            res = await r.json();
          } catch (e: any) {
            const message = e?.message ?? "Error de red";
            setTest({ status: "err", message });
            throw new Error(message);
          }
          if (res.ok) {
            const message = `${res.message} · ${res.serverVersion ?? ""}`.trim();
            setTest({ status: "ok", message, target: res.target });
            return `Conexión exitosa${res.serverVersion ? ` · ${res.serverVersion}` : ""}`;
          }
          const message = res.message || res.error || "Falló la conexión";
          setTest({ status: "err", message, hint: hintFor(message, res.target), target: res.target });
          throw new Error(hintFor(message, res.target) || message);
        }
      )
      .catch(() => {});
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Lista de conexiones */}
      <aside className="card h-fit">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm">Conexiones</h2>
          <button className="btn-ghost text-xs px-2 py-1" onClick={addConnection}>
            + Añadir
          </button>
        </div>
        <ul className="space-y-1">
          {cfg.databases.length === 0 && (
            <li className="text-xs text-muted">Aún no hay conexiones. Añade una.</li>
          )}
          {cfg.databases.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => {
                  setSelectedId(d.id);
                  setTest({ status: "idle" });
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                  d.id === selectedId ? "bg-accent text-white" : "hover:bg-panel2 text-gray-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{d.name || "(sin nombre)"}</span>
                  {d.isDefault && (
                    <span className="badge bg-green-900 text-green-300 text-[10px]">default</span>
                  )}
                </div>
                <div className="text-[11px] opacity-70 truncate">
                  {d.engine} · {d.host}:{d.port}/{d.database || "—"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Editor de la conexión seleccionada */}
      <section className="card lg:col-span-2">
        {!selected ? (
          <p className="text-muted text-sm">Selecciona o añade una conexión.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Nombre" hint="Etiqueta amigable, ej. «Local Postgres»">
                <input
                  className="input"
                  value={selected.name}
                  onChange={(e) => patchSelected({ name: e.target.value })}
                />
              </Field>
              <Field label="Motor">
                <select
                  className="input"
                  value={selected.engine}
                  onChange={(e) => {
                    const engine = e.target.value as DbEngine;
                    const def = ENGINES.find((x) => x.value === engine)?.defaultPort ?? selected.port;
                    patchSelected({ engine, port: def });
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
                  <input
                    className="input"
                    value={selected.host}
                    onChange={(e) => patchSelected({ host: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Puerto">
                <input
                  className="input"
                  type="number"
                  value={selected.port}
                  onChange={(e) => patchSelected({ port: Number(e.target.value) || 0 })}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Base de datos">
                <input
                  className="input"
                  value={selected.database}
                  onChange={(e) => patchSelected({ database: e.target.value })}
                />
              </Field>
              <Field label="Usuario">
                <input
                  className="input"
                  value={selected.user}
                  onChange={(e) => patchSelected({ user: e.target.value })}
                />
              </Field>
              <Field label="Contraseña" hint="Se guarda local y se enmascara">
                <input
                  className="input"
                  type="password"
                  value={selected.password}
                  onChange={(e) => patchSelected({ password: e.target.value })}
                />
                {selected.password !== SECRET_MASK && hasEdgeSpaces(selected.password) && (
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-warn">
                    <span>⚠ La contraseña tiene espacios al inicio/final.</span>
                    <button
                      type="button"
                      className="underline hover:text-amber-300"
                      onClick={() => patchSelected({ password: selected.password.trim() })}
                    >
                      Quitar espacios
                    </button>
                  </div>
                )}
              </Field>
            </div>

            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={selected.ssl}
                  onChange={(e) => patchSelected({ ssl: e.target.checked })}
                />
                Usar SSL/TLS
              </label>
              {selected.ssl && (
                <label className="flex items-center gap-2 text-xs text-muted pl-6">
                  <input
                    type="checkbox"
                    checked={!!selected.sslAllowSelfSigned}
                    onChange={(e) => patchSelected({ sslAllowSelfSigned: e.target.checked })}
                  />
                  Aceptar certificado no confiable (self-signed) — por defecto se verifica
                </label>
              )}
            </div>

            {/* Túnel SSH */}
            <div className="rounded-lg border border-border bg-panel2/40 p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={(selected.ssh ?? defaultSsh()).enabled}
                  onChange={(e) => patchSsh({ enabled: e.target.checked })}
                />
                Conectar a través de un túnel SSH (servidor remoto / bastión)
              </label>

              {(selected.ssh ?? defaultSsh()).enabled && (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted">
                    El driver no conecta directo a la BD: primero abre una sesión SSH al servidor
                    remoto y, a través de ese túnel, llega a la base. Los campos <b>Host</b>/<b>Puerto</b>
                    de arriba son la BD <i>vista desde el servidor</i> (normalmente <code>localhost:5432</code>).
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <Field label="Servidor SSH (host)" hint="IP o dominio del servidor remoto">
                        <input
                          className="input"
                          value={selected.ssh.host}
                          onChange={(e) => patchSsh({ host: e.target.value })}
                        />
                      </Field>
                    </div>
                    <Field label="Puerto SSH">
                      <input
                        className="input"
                        type="number"
                        value={selected.ssh.port}
                        onChange={(e) => patchSsh({ port: Number(e.target.value) || 22 })}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="Usuario SSH">
                      <input
                        className="input"
                        value={selected.ssh.user}
                        onChange={(e) => patchSsh({ user: e.target.value })}
                      />
                    </Field>
                    <Field label="Método de autenticación SSH">
                      <select
                        className="input"
                        value={selected.ssh.authMethod}
                        onChange={(e) => patchSsh({ authMethod: e.target.value as SshAuthMethod })}
                      >
                        <option value="password">Contraseña</option>
                        <option value="privateKey">Llave privada</option>
                        <option value="agent">Agente SSH</option>
                      </select>
                    </Field>
                  </div>

                  {selected.ssh.authMethod === "password" && (
                    <Field label="Contraseña SSH" hint="Se guarda local y se enmascara">
                      <input
                        className="input"
                        type="password"
                        value={selected.ssh.password}
                        onChange={(e) => patchSsh({ password: e.target.value })}
                      />
                    </Field>
                  )}

                  {selected.ssh.authMethod === "privateKey" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Field label="Ruta de la llave privada">
                        <input
                          className="input"
                          value={selected.ssh.privateKeyPath}
                          onChange={(e) => patchSsh({ privateKeyPath: e.target.value })}
                        />
                      </Field>
                      <Field label="Passphrase (opcional)">
                        <input
                          className="input"
                          type="password"
                          value={selected.ssh.passphrase}
                          onChange={(e) => patchSsh({ passphrase: e.target.value })}
                        />
                      </Field>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Field label="Forward host (opcional)" hint="BD vista desde el servidor; vacío = usa el Host de arriba">
                      <input
                        className="input"
                        placeholder={selected.host}
                        value={selected.ssh.forwardHost}
                        onChange={(e) => patchSsh({ forwardHost: e.target.value })}
                      />
                    </Field>
                    <Field label="Forward puerto (opcional)" hint="vacío/0 = usa el Puerto de arriba">
                      <input
                        className="input"
                        type="number"
                        value={selected.ssh.forwardPort}
                        onChange={(e) => patchSsh({ forwardPort: Number(e.target.value) || 0 })}
                      />
                    </Field>
                  </div>
                </div>
              )}
            </div>

            {/* Resultado de la prueba */}
            {test.status !== "idle" && (
              <div
                className={`text-sm rounded-lg px-3 py-2 border ${
                  test.status === "ok"
                    ? "border-green-700 bg-green-900/30 text-green-300"
                    : test.status === "err"
                    ? "border-red-700 bg-red-900/30 text-red-300"
                    : "border-border bg-panel2 text-muted"
                }`}
              >
                {test.status === "testing" ? (
                  <span className="flex items-center gap-2">
                    <Spinner /> Probando conexión…
                  </span>
                ) : (
                  <div className="space-y-1">
                    <div>{test.message}</div>
                    {test.target?.passwordHasEdgeSpaces && (
                      <div className="text-xs text-warn">
                        ⚠ La contraseña usada tiene espacios al inicio/final — probablemente sea un
                        error de pegado. Reescríbela sin espacios.
                      </div>
                    )}
                    {test.hint && <div className="text-xs opacity-90">💡 {test.hint}</div>}
                    {test.target && (
                      <div className="text-[11px] opacity-70 font-mono">
                        Intento: {test.target.user}@{test.target.host}:{test.target.port}/
                        {test.target.database || "—"} · SSL {test.target.ssl ? "on" : "off"} ·{" "}
                        {test.target.hasPassword ? "con contraseña" : "SIN contraseña"}
                        {test.target.viaSsh ? " · vía SSH" : ""}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
              <button className="btn-ghost" onClick={runTest} disabled={test.status === "testing"}>
                🔌 Probar conexión
              </button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
              <button className="btn-ghost" onClick={makeDefault} disabled={selected.isDefault}>
                Marcar como default
              </button>
              <button className="btn-danger ml-auto" onClick={deleteSelected}>
                Eliminar
              </button>
              {savedMsg && <span className="text-xs text-muted">{savedMsg}</span>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
