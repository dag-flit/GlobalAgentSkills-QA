import { readConfig, writeConfig } from "./db/configRepo";
import type { AppConfig, DbConnection } from "./types";
import { SECRET_MASK } from "./types";

// ---------- Defaults ----------

export function defaultSshConfig(): DbConnection["ssh"] {
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

export function defaultDbConnection(): DbConnection {
  return {
    id: "default",
    name: "Local Postgres",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "postgres",
    user: "postgres",
    password: "",
    ssl: false,
    sslAllowSelfSigned: false, // por defecto: verificar el certificado TLS
    ssh: defaultSshConfig(),
    isDefault: true,
  };
}

export function defaultTrackerConfig(): AppConfig["tracker"] {
  return {
    selected: "local",
    azure: { orgUrl: "https://dev.azure.com/", project: "", pat: "", userEmail: "" },
    github: { repository: "", token: "" },
    jira: { baseUrl: "", email: "", token: "", projectKey: "" },
  };
}

export function defaultConfig(): AppConfig {
  return {
    databases: [defaultDbConnection()],
    tracker: defaultTrackerConfig(),
  };
}

/** Garantiza que una conexión tenga todos los campos (rellena `ssh` en configs viejas). */
function normalizeDb(db: Partial<DbConnection>): DbConnection {
  const base = defaultDbConnection();
  return {
    ...base,
    ...db,
    ssh: { ...defaultSshConfig(), ...(db.ssh ?? {}) },
  };
}

// ---------- Persistencia ----------

let cached: AppConfig | null = null;

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (override == null) return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const key of Object.keys(override as any)) {
    const ov = (override as any)[key];
    const bv = (base as any)[key];
    if (ov && typeof ov === "object" && !Array.isArray(ov) && bv && typeof bv === "object") {
      out[key] = deepMerge(bv, ov);
    } else if (ov !== undefined) {
      out[key] = ov;
    }
  }
  return out;
}

export async function loadConfig(): Promise<AppConfig> {
  if (cached) return cached;
  const { databases, tracker } = await readConfig();
  const def = defaultConfig();
  // normaliza cada conexión (rellena `ssh` y campos nuevos en filas viejas).
  const dbs = databases.length ? databases.map(normalizeDb) : def.databases;
  const trk = tracker ? deepMerge(defaultTrackerConfig(), tracker) : def.tracker;
  const cfg: AppConfig = { databases: dbs, tracker: trk };
  // Primer arranque (control-plane vacío): siémbralo con los defaults.
  if (!databases.length || !tracker) await writeConfig(cfg);
  cached = cfg;
  return cfg;
}

export async function saveConfig(cfg: AppConfig): Promise<void> {
  await writeConfig(cfg);
  cached = cfg;
}

export async function reloadConfig(): Promise<AppConfig> {
  cached = null;
  return loadConfig();
}

// ---------- Redacción de secretos ----------

function mask(value: string): string {
  return value ? SECRET_MASK : "";
}

/** Copia con contraseñas enmascaradas (para enviar al navegador). */
export function redactConfig(cfg: AppConfig): AppConfig {
  const c: AppConfig = JSON.parse(JSON.stringify(cfg));
  c.databases = c.databases.map((db) => {
    const ssh = db.ssh ?? defaultSshConfig();
    return {
      ...db,
      password: mask(db.password),
      ssh: { ...ssh, password: mask(ssh.password), passphrase: mask(ssh.passphrase) },
    };
  });
  const t = c.tracker ?? defaultTrackerConfig();
  c.tracker = {
    ...t,
    azure: { ...t.azure, pat: mask(t.azure.pat) },
    github: { ...t.github, token: mask(t.github.token) },
    jira: { ...t.jira, token: mask(t.jira.token) },
  };
  return c;
}

/**
 * Aplica un update entrante preservando contraseñas previas cuando llegan
 * enmascaradas (el navegador nunca recibe el valor real; si reenvía la máscara
 * significa "no cambiar"). Conexiones nuevas (id inexistente) conservan su valor.
 */
export function applySecretPreserving(current: AppConfig, incoming: AppConfig): AppConfig {
  const keep = (inVal: string, curVal: string) => (inVal === SECRET_MASK ? curVal : inVal);
  const merged: AppConfig = JSON.parse(JSON.stringify(incoming));
  merged.databases = incoming.databases.map((db) => {
    const prev = current.databases.find((d) => d.id === db.id);
    const ssh = db.ssh ?? defaultSshConfig();
    return {
      ...db,
      password: keep(db.password, prev?.password ?? ""),
      ssh: {
        ...ssh,
        password: keep(ssh.password, prev?.ssh?.password ?? ""),
        passphrase: keep(ssh.passphrase, prev?.ssh?.passphrase ?? ""),
      },
    };
  });

  const inT = incoming.tracker ?? defaultTrackerConfig();
  const curT = current.tracker ?? defaultTrackerConfig();
  merged.tracker = {
    ...inT,
    azure: { ...inT.azure, pat: keep(inT.azure.pat, curT.azure.pat) },
    github: { ...inT.github, token: keep(inT.github.token, curT.github.token) },
    jira: { ...inT.jira, token: keep(inT.jira.token, curT.jira.token) },
  };

  return merged;
}

export async function getDbConnection(id?: string): Promise<DbConnection | undefined> {
  const cfg = await loadConfig();
  if (!id) return cfg.databases.find((d) => d.isDefault) ?? cfg.databases[0];
  return cfg.databases.find((d) => d.id === id);
}
