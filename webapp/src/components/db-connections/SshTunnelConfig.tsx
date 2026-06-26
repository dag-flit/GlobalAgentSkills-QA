import { Field } from "@/components/ui";
import type { DbConnection, SshAuthMethod, SshConfig } from "@/lib/types";
import { defaultSsh } from "./helpers";

/** Bloque de configuración del túnel SSH (bastión) para la conexión seleccionada. */
export function SshTunnelConfig({
  selected,
  patchSsh,
}: {
  selected: DbConnection;
  patchSsh: (patch: Partial<SshConfig>) => void;
}) {
  const ssh = selected.ssh ?? defaultSsh();
  return (
    <div className="rounded-lg border border-border bg-panel2/40 p-3 space-y-3">
      <label className="flex items-center gap-2 text-sm text-gray-200">
        <input type="checkbox" checked={ssh.enabled} onChange={(e) => patchSsh({ enabled: e.target.checked })} />
        Conectar a través de un túnel SSH (servidor remoto / bastión)
      </label>

      {ssh.enabled && (
        <div className="space-y-3">
          <p className="text-[11px] text-muted">
            El driver no conecta directo a la BD: primero abre una sesión SSH al servidor remoto y, a
            través de ese túnel, llega a la base. Los campos <b>Host</b>/<b>Puerto</b> de arriba son la
            BD <i>vista desde el servidor</i> (normalmente <code>localhost:5432</code>).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <Field label="Servidor SSH (host)" hint="IP o dominio del servidor remoto">
                <input className="input" value={ssh.host} onChange={(e) => patchSsh({ host: e.target.value })} />
              </Field>
            </div>
            <Field label="Puerto SSH">
              <input
                className="input"
                type="number"
                value={ssh.port}
                onChange={(e) => patchSsh({ port: Number(e.target.value) || 22 })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Usuario SSH">
              <input className="input" value={ssh.user} onChange={(e) => patchSsh({ user: e.target.value })} />
            </Field>
            <Field label="Método de autenticación SSH">
              <select
                className="input"
                value={ssh.authMethod}
                onChange={(e) => patchSsh({ authMethod: e.target.value as SshAuthMethod })}
              >
                <option value="password">Contraseña</option>
                <option value="privateKey">Llave privada</option>
                <option value="agent">Agente SSH</option>
              </select>
            </Field>
          </div>

          {ssh.authMethod === "password" && (
            <Field label="Contraseña SSH" hint="Se guarda local y se enmascara">
              <input
                className="input"
                type="password"
                value={ssh.password}
                onChange={(e) => patchSsh({ password: e.target.value })}
              />
            </Field>
          )}

          {ssh.authMethod === "privateKey" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Ruta de la llave privada">
                <input
                  className="input"
                  value={ssh.privateKeyPath}
                  onChange={(e) => patchSsh({ privateKeyPath: e.target.value })}
                />
              </Field>
              <Field label="Passphrase (opcional)">
                <input
                  className="input"
                  type="password"
                  value={ssh.passphrase}
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
                value={ssh.forwardHost}
                onChange={(e) => patchSsh({ forwardHost: e.target.value })}
              />
            </Field>
            <Field label="Forward puerto (opcional)" hint="vacío/0 = usa el Puerto de arriba">
              <input
                className="input"
                type="number"
                value={ssh.forwardPort}
                onChange={(e) => patchSsh({ forwardPort: Number(e.target.value) || 0 })}
              />
            </Field>
          </div>
        </div>
      )}
    </div>
  );
}
