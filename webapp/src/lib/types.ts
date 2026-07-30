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

// "explore" = pruebas E2E sobre una URL viva; "code" = QA del código (capas estáticas/unit/api/
// db/security sobre un repo local confinado). Ambos entregan evidencia por el mismo sink.
export type RunMode = "explore" | "code";

// Capas del modo "QA del código" (subconjunto ejecutable determinista, sin IA).
export type CodeLayer = "static" | "unit" | "api" | "db" | "security";

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
  sourcePath?: string; // modo "code": ruta (relativa a CODE_QA_BASE_DIR) del repo analizado
  workItemId?: string; // WI destino de la evidencia (Azure); ausente/"local" = solo reporte local
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

// ---------- Test de Regresión (sistemas + catálogo de selectores) ----------

// Un elemento del catálogo, expresado en el vocabulario robusto de localización (espeja
// explore-steps.resolveLocator): by ∈ role|label|text|placeholder|testid. `role`+`name` para
// getByRole; el resto usa `value`.
export interface SelectorElement {
  alias: string;
  by: string;
  role?: string;
  name?: string;
  value?: string;
}
export interface SelectorCatalogPage {
  route: string;
  name: string;
  elements: SelectorElement[];
  scannedAt?: string; // ISO — cuándo se escaneó por última vez esta página (para el catálogo incremental)
}
export interface SelectorCatalog {
  baseUrl?: string;
  authMode?: string;
  pages: SelectorCatalogPage[];
}

export type RegressionAuthMode = "none" | "login";

// Un SISTEMA a probar por regresión. Multi-sistema por tenant. `password` es secreto (cifrado en
// reposo; enmascarado al enviarlo al navegador). `catalog` es el último escaneo (solo selectores).
export interface RegressionTarget {
  id: string;
  name: string;
  baseUrl: string;
  authMode: RegressionAuthMode;
  username: string;
  password: string;
  catalog?: SelectorCatalog | null;
  updatedAt?: string;
}

// Un PASO de una prueba de regresión. Los pasos que tocan un elemento referencian un `alias` del
// catálogo (no el selector crudo → robustez: el selector vive UNA vez). Los campos libres
// (valor/texto/ruta/nombre) son opcionales según la operación. El compilador (Fase 3) resuelve
// `alias` → localizador usando el catálogo del sistema.
export interface RegressionStep {
  op: string;
  alias?: string;
  valor?: string;
  texto?: string;
  ruta?: string;
  nombre?: string;
  segundos?: string;
  numero?: string;
}
export interface RegressionTest {
  id: string;
  name: string;
  steps: RegressionStep[];
}
// Una SUITE de regresión (colección de pruebas) atada a un sistema. Reusa el patrón `flows` (jsonb).
export interface RegressionSuite {
  id: string;
  targetId: string;
  name: string;
  tests: RegressionTest[];
  updatedAt?: string;
}
