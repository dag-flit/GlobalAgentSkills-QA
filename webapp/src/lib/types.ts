// Tipos centrales de QA Kit Studio

// ---------- Runs (ciclo QA) ----------

export type RunStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "error"
  | "stopped";

export type LogLevel =
  | "info"
  | "stdout"
  | "stderr"
  | "agent"
  | "tool"
  | "result"
  | "error"
  | "system";

export interface RunEvent {
  ts: number;
  level: LogLevel;
  msg: string;
}

export type RunMode = "explore";

export interface RunRecord {
  id: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  status: RunStatus;
  mode: RunMode;
  tracker: string;
  title: string;
  // inputs
  repoRoot?: string; // carpeta de evidencia de la corrida (capturas)
  appUrl?: string;
  // outputs
  summary?: any; // resumen de runQaCycle
  error?: string;
}

// ---------- Conexiones de BD (estilo pgAdmin, varias guardadas) ----------

export type DbEngine = "postgres" | "mysql" | "mssql";
export type SshAuthMethod = "password" | "privateKey" | "agent";

export interface SshConfig {
  /** Si true, el driver conecta a través de un túnel SSH (bastión/servidor remoto). */
  enabled: boolean;
  host: string; // host del servidor SSH (bastión), ej. IP pública o dominio
  port: number; // normalmente 22
  user: string; // usuario SSH
  authMethod: SshAuthMethod;
  password: string; // secreto (auth por contraseña)
  privateKeyPath: string; // ruta a la llave privada (auth por llave)
  passphrase: string; // secreto (passphrase de la llave)
  /** Host de la BD visto desde el bastión (default = host de la conexión). */
  forwardHost: string;
  /** Puerto de la BD visto desde el bastión (default = port de la conexión). */
  forwardPort: number;
}

export interface DbConnection {
  id: string;
  name: string; // etiqueta amigable: "Local Postgres", "QA", ...
  engine: DbEngine;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string; // secreto (enmascarado al enviar al navegador)
  ssl: boolean;
  /** Si true, acepta certificados TLS no confiables (self-signed). Por defecto false = verificar. */
  sslAllowSelfSigned?: boolean;
  ssh: SshConfig;
  isDefault: boolean;
}

// ---------- Tracker (dónde reportar) ----------

export type TrackerName = "local" | "azure-devops";

export interface AzureCfg {
  orgUrl: string; // https://dev.azure.com/<org>
  project: string;
  pat: string; // secreto
  userEmail: string;
}
export interface TrackerConfig {
  selected: TrackerName;
  azure: AzureCfg;
}

// ---------- Configuración persistente (data/config.json) ----------

export interface AppConfig {
  /** Conexiones de BD guardadas (gestor tipo pgAdmin). */
  databases: DbConnection[];
  /** Configuración del tracker (dónde se reportan los resultados). */
  tracker: TrackerConfig;
}

export const SECRET_MASK = "••••••••";
