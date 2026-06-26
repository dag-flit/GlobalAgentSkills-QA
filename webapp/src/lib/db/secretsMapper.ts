import { encryptSecret, decryptSecret } from "@/lib/security/secretsCrypto";
import type { DbConnection, TrackerConfig } from "@/lib/types";

// Cifra/descifra los campos SECRETOS de la config en la frontera con la BD. El resto del
// código (config.ts, rutas, UI) trabaja con texto plano en memoria. AAD por campo liga
// cada criptograma a su contexto lógico; en F6 se le antepondrá el tenant_id real.
const aad = (s: string) => `system:${s}`;

function mapDb(db: DbConnection, fn: (v: string, aad: string) => string): DbConnection {
  const ssh = db.ssh ?? ({} as DbConnection["ssh"]);
  return {
    ...db,
    password: fn(db.password ?? "", aad(`db:${db.id}:password`)),
    ssh: {
      ...ssh,
      password: fn(ssh.password ?? "", aad(`db:${db.id}:ssh.password`)),
      passphrase: fn(ssh.passphrase ?? "", aad(`db:${db.id}:ssh.passphrase`)),
    },
  };
}

function mapTracker(t: TrackerConfig, fn: (v: string, aad: string) => string): TrackerConfig {
  return {
    ...t,
    azure: { ...t.azure, pat: fn(t.azure.pat ?? "", aad("tracker:azure.pat")) },
    github: { ...t.github, token: fn(t.github.token ?? "", aad("tracker:github.token")) },
    jira: { ...t.jira, token: fn(t.jira.token ?? "", aad("tracker:jira.token")) },
  };
}

export const encryptDb = (db: DbConnection) => mapDb(db, encryptSecret);
export const decryptDb = (db: DbConnection) => mapDb(db, decryptSecret);
export const encryptTracker = (t: TrackerConfig) => mapTracker(t, encryptSecret);
export const decryptTracker = (t: TrackerConfig) => mapTracker(t, decryptSecret);
