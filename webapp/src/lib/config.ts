import fs from "node:fs";
import { CONFIG_FILE, ensureDataDirs } from "./paths";
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

export function loadConfig(): AppConfig {
  if (cached) return cached;
  ensureDataDirs();
  if (!fs.existsSync(CONFIG_FILE)) {
    cached = defaultConfig();
    saveConfig(cached);
    return cached;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    const merged = deepMerge(defaultConfig(), raw);
    // deepMerge reemplaza arrays completos: normaliza cada conexión para rellenar
    // campos nuevos (p.ej. `ssh`) en configuraciones guardadas antes de existir.
    merged.databases = (merged.databases ?? []).map(normalizeDb);
    if (merged.databases.length === 0) merged.databases = [defaultDbConnection()];
    cached = merged;
    return cached!;
  } catch {
    cached = defaultConfig();
    return cached;
  }
}

export function saveConfig(cfg: AppConfig): void {
  ensureDataDirs();
  const tmp = CONFIG_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf-8");
  fs.renameSync(tmp, CONFIG_FILE);
  cached = cfg;
}

export function reloadConfig(): AppConfig {
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

export function getDbConnection(id?: string): DbConnection | undefined {
  const cfg = loadConfig();
  if (!id) return cfg.databases.find((d) => d.isDefault) ?? cfg.databases[0];
  return cfg.databases.find((d) => d.id === id);
}
