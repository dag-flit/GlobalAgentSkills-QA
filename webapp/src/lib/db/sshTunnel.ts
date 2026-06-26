import net from "node:net";
import fs from "node:fs";
import { Client } from "ssh2";
import { assertAbsoluteNoTraversal } from "../security/paths";
import type { DbConnection } from "../types";

export interface Tunnel {
  localHost: string;
  localPort: number;
  close: () => void;
}

/**
 * Abre un túnel SSH (port-forwarding local) hacia el host:puerto de la BD,
 * visto desde el bastión. Devuelve el puerto local al que conectará el driver.
 */
export function openSshTunnel(db: DbConnection): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    const ssh = db.ssh;
    const conn = new Client();
    const fwdHost = ssh.forwardHost || db.host;
    const fwdPort = ssh.forwardPort || db.port;
    const localHost = "127.0.0.1";

    let settled = false;
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        /* noop */
      }
      reject(e);
    };

    conn.on("ready", () => {
      const server = net.createServer((sock) => {
        conn.forwardOut(localHost, 0, fwdHost, fwdPort, (err, stream) => {
          if (err) {
            sock.destroy();
            return;
          }
          sock.pipe(stream).pipe(sock);
          stream.on("error", () => sock.destroy());
          sock.on("error", () => stream.destroy());
        });
      });

      server.on("error", fail);
      server.listen(0, localHost, () => {
        const addr = server.address();
        const localPort = typeof addr === "object" && addr ? addr.port : 0;
        settled = true;
        resolve({
          localHost,
          localPort,
          close: () => {
            try {
              server.close();
            } catch {
              /* noop */
            }
            try {
              conn.end();
            } catch {
              /* noop */
            }
          },
        });
      });
    });

    conn.on("error", (e) => fail(e instanceof Error ? e : new Error(String(e))));

    const cfg: Record<string, unknown> = {
      host: ssh.host,
      port: ssh.port || 22,
      username: ssh.user,
      readyTimeout: 15000,
    };

    try {
      if (ssh.authMethod === "password") {
        cfg.password = ssh.password;
      } else if (ssh.authMethod === "privateKey") {
        // Ruta absoluta y sin traversal (evita leer archivos arbitrarios del servidor).
        const keyPath = assertAbsoluteNoTraversal(ssh.privateKeyPath, "ruta de la llave privada");
        cfg.privateKey = fs.readFileSync(keyPath);
        if (ssh.passphrase) cfg.passphrase = ssh.passphrase;
      } else if (ssh.authMethod === "agent") {
        cfg.agent =
          process.env.SSH_AUTH_SOCK || (process.platform === "win32" ? "pageant" : undefined);
      }
    } catch (e: any) {
      fail(new Error(`No se pudo leer la llave privada: ${e?.message ?? e}`));
      return;
    }

    conn.connect(cfg);
  });
}
