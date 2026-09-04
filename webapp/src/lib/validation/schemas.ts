import { z } from "zod";

// Esquemas zod de los inputs de las rutas API. Validan en la frontera (reemplazan los
// `as RunInput`/`as ProjectSource` crudos). `.object()` descarta claves desconocidas;
// los puertos se coercionan (la UI puede mandarlos como string).

export const sshConfigSchema = z.object({
  enabled: z.boolean(),
  host: z.string(),
  port: z.coerce.number().int(),
  user: z.string(),
  authMethod: z.enum(["password", "privateKey", "agent"]),
  password: z.string(),
  privateKeyPath: z.string(),
  passphrase: z.string(),
  forwardHost: z.string(),
  forwardPort: z.coerce.number().int(),
});

export const dbConnectionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  engine: z.enum(["postgres", "mysql", "mssql"]),
  host: z.string(),
  port: z.coerce.number().int(),
  database: z.string(),
  user: z.string(),
  password: z.string(),
  ssl: z.boolean(),
  sslAllowSelfSigned: z.boolean().optional(),
  ssh: sshConfigSchema,
  isDefault: z.boolean(),
});

// Campos de conexión obligatorios por tracker (guardrail de selección). Al elegir un
// tracker, sus credenciales no pueden quedar vacías → el fallo se reporta en la frontera
// (zod), con el nombre HUMANO del campo, en vez de aparecer tarde como `Faltan variables:
// USER_REAL_EMAIL` en el preflight del adapter. `local` no exige nada (sin red).
// Nota: los secretos (pat/token) llegan ENMASCARADOS cuando ya están guardados
// (SECRET_MASK, no vacío) → este guardrail no bloquea una config completa preexistente;
// solo exige que, al configurarla por primera vez, no queden campos en blanco.
const TRACKER_REQUIRED: Record<string, { group: string; fields: { field: string; label: string }[] }> = {
  "azure-devops": {
    group: "azure",
    fields: [
      { field: "orgUrl", label: "Organization URL" },
      { field: "project", label: "Project" },
      { field: "pat", label: "Personal Access Token" },
      { field: "userEmail", label: "Tu email (supervisión)" },
    ],
  },
};

export const trackerConfigSchema = z
  .object({
    selected: z.enum(["local", "azure-devops"]),
    azure: z.object({ orgUrl: z.string(), project: z.string(), pat: z.string(), userEmail: z.string() }),
  })
  .superRefine((t, ctx) => {
    const spec = TRACKER_REQUIRED[t.selected];
    if (!spec) return; // `local` (u otro sin requisitos de conexión)
    const group = (t as unknown as Record<string, Record<string, string>>)[spec.group];
    for (const { field, label } of spec.fields) {
      if (!group?.[field]?.trim()) {
        ctx.addIssue({
          code: "custom",
          path: [spec.group, field],
          message: `Falta "${label}" para el tracker ${t.selected}.`,
        });
      }
    }
  });

export const appConfigSchema = z.object({
  databases: z.array(dbConnectionSchema),
  tracker: trackerConfigSchema,
});

// Un paso del guion E2E: la operación + campos (todos strings; el motor los normaliza).
// `.catchall(z.string())` acepta los campos variables por operación (en/valor/texto/url/…)
// y rechaza cualquier valor no-string en la frontera.
const flowStepSchema = z.object({ op: z.string().min(1) }).catchall(z.string());

// Input de una corrida: modo "explore". Con `steps` corre un GUION (flujo E2E); sin él, es el
// smoke de la URL. `workItemId` es el WI destino de la evidencia (Azure); `vars` son las
// variables/credenciales para `${VAR}` del guion (efímeras, no se persisten).
export const runInputSchema = z.object({
  mode: z.literal("explore"),
  appUrl: z.string().optional(),
  workItemId: z.string().optional(),
  steps: z.array(flowStepSchema).optional(),
  vars: z.record(z.string(), z.string()).optional(),
  // AC declarados de la HU (títulos) → matriz de cobertura en el reporte. Efímeros por corrida.
  declaredAcs: z.array(z.string()).optional(),
});

// Input de una corrida de "QA del código" (modo "code"): analiza un repo LOCAL confinado
// (la ruta se resuelve DENTRO de CODE_QA_BASE_DIR en el server) y corre las capas deterministas
// static/unit/api/db/security. `sourcePath` es relativa a la base permitida (nunca una ruta libre
// del server). `layers` es el subconjunto opcional a correr (vacío/ausente = las detectadas).
// Es un schema NUEVO — `runInputSchema` (explore) queda intacto.
export const codeRunInputSchema = z.object({
  mode: z.literal("code"),
  sourcePath: z.string().min(1),
  workItemId: z.string().optional(),
  layers: z.array(z.enum(["static", "unit", "api", "db", "security"])).optional(),
  featureId: z.string().optional(),
  developer: z.string().optional(),
  // Inyectar la BD configurada (módulo de BD) al entorno de las pruebas: conecta las pruebas de
  // integración .NET y activa la capa `db`. Opt-in por corrida (interruptor en el asistente).
  useConfiguredDb: z.boolean().optional(),
});

// Unión discriminada por `mode`: la ruta /api/runs acepta E2E (explore) o QA de código (code)
// sin modificar ninguno de los dos schemas base.
export const anyRunInputSchema = z.discriminatedUnion("mode", [runInputSchema, codeRunInputSchema]);

// Validar la ruta del repo antes de avanzar en el asistente de QA del código: que exista, sea un
// directorio confinado (CODE_QA_BASE_DIR) y PAREZCA un proyecto real (no un texto cualquiera).
export const codeValidatePathSchema = z.object({
  sourcePath: z.string().min(1),
});

// Guardar el guion de una HU (persistencia por work item). Sin credenciales: solo la estructura.
export const flowSaveSchema = z.object({
  wid: z.string().min(1),
  steps: z.array(flowStepSchema),
});

// Generar el brief de validación PR-driven: solo la URL del PR de GitHub (owner/repo/número salen
// de ahí). Sin credenciales: el token de GitHub (opcional) vive en el server (GITHUB_TOKEN).
export const prBriefSchema = z.object({
  prUrl: z.string().min(1),
});

// Publicar el brief como comentario en una HU de Azure. `workItemId` = HU destino.
export const prPublishSchema = z.object({
  prUrl: z.string().min(1),
  workItemId: z.string().min(1),
});

export const dbTestSchema = z
  .object({ id: z.string().optional(), db: dbConnectionSchema.optional() })
  .refine((b) => Boolean(b.id) || Boolean(b.db), { message: "Falta 'id' o 'db'." });

export const trackerTestSchema = z.object({ tracker: trackerConfigSchema });

// ---------- Auth ----------

export const registerSchema = z.object({
  tenantName: z.string().min(1),
  email: z.email(),
  password: z.string().min(8),
  userName: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const switchTenantSchema = z.object({ tenantId: z.uuid() });

// ---------- Test de Regresión ----------

// Guardar un SISTEMA a probar. `password` viaja enmascarado si ya estaba guardado (la ruta lo
// preserva). auth_mode='none' → username/password se ignoran (público, sin credenciales).
export const regressionTargetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  authMode: z.enum(["none", "login"]),
  username: z.string().default(""),
  password: z.string().default(""),
});

// Duplicar un sistema a OTRO AMBIENTE (QA/PDN): copia el catálogo y las suites del origen a un
// sistema nuevo, cambiando solo URL + credenciales → se reutilizan las pruebas sin re-escanear.
export const regressionDuplicateSchema = z.object({
  sourceId: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  authMode: z.enum(["none", "login"]),
  username: z.string().default(""),
  password: z.string().default(""),
});

// Escanear un sistema por id. `routes` (opcional) = rutas a catalogar (una por página); sin ellas
// se escanea solo la URL base. Efímeras (no se persisten en esta fase).
export const regressionScanSchema = z.object({
  id: z.string().min(1),
  routes: z
    .array(z.object({ route: z.string(), name: z.string().optional() }))
    .optional(),
  // Catálogo incremental: "merge" (por defecto) agrega/actualiza las páginas escaneadas y CONSERVA
  // las demás; "replace" reemplaza todo el catálogo (empezar de cero a propósito).
  mode: z.enum(["merge", "replace"]).optional(),
});

// Guardar una SUITE de regresión (colección de pruebas). Un paso es { op, ...campos string } — los
// campos variables (alias/valor/texto/ruta/nombre/segundos) llegan por catchall como strings.
const regressionStepSchema = z.object({ op: z.string().min(1) }).catchall(z.string());
const regressionTestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  steps: z.array(regressionStepSchema),
});
export const regressionSuiteSchema = z.object({
  targetId: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  tests: z.array(regressionTestSchema),
});

// Guardar un RECORRIDO (walk-through de un asistente multi-pantalla). Etapas ordenadas; cada etapa
// tiene un nombre y sus pasos de avance (mismos pasos que una prueba → referencian alias del catálogo).
const regressionStageSchema = z.object({
  name: z.string().min(1),
  guardText: z.string().optional(), // etapa condicional: solo aplica si ese texto está visible al llegar
  prepare: z.array(regressionStepSchema).optional(), // acciones para revelar todo antes de cosechar
  advance: z.array(regressionStepSchema).optional(),
});
export const regressionRecorridoSchema = z.object({
  targetId: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  entryRoute: z.string(),
  stages: z.array(regressionStageSchema),
});

// Caminar un RECORRIDO: abre el navegador, entra al asistente (login si aplica) y lo recorre etapa por
// etapa cosechando selectores. El catálogo resultante se FUSIONA (reemplaza solo el bloque del recorrido).
export const regressionWalkSchema = z.object({
  targetId: z.string().min(1),
  recorridoId: z.string().min(1),
});

// GRABADOR semi-automático: abrir un navegador headed, iniciar sesión y grabar mientras el usuario
// navega. `start` recibe el sistema + entrada + nombre; `stop` recibe el id de la grabación en curso.
export const recordStartSchema = z.object({
  targetId: z.string().min(1),
  entryRoute: z.string(),
  name: z.string().min(1),
  // Credenciales EFÍMERAS para grabar con OTRA cuenta (no se guardan; solo esta sesión). Vacío = usa
  // las credenciales configuradas del sistema.
  username: z.string().optional(),
  password: z.string().optional(),
});
export const recordStopSchema = z.object({
  id: z.string().min(1),
});

// Correr una SUITE de regresión (por sistema + suite). Abre el navegador, compila cada prueba contra
// el catálogo vigente y la ejecuta. Las credenciales del sistema (cifradas) se resuelven en el server.
export const regressionRunSchema = z.object({
  targetId: z.string().min(1),
  suiteId: z.string().min(1),
  testId: z.string().min(1).optional(), // correr una sola prueba de la suite (si se omite, corre todas)
  // Anti-flaky: si una prueba falla, se re-corre hasta N veces; si pasa en un reintento se marca
  // «inestable» (no se esconde). 0 = sin reintentos. Un fallo por regresión de selector NO se reintenta.
  retries: z.number().int().min(0).max(3).optional(),
});

// Publicar en ADO la evidencia de una corrida YA ejecutada. `runId` = basename de la carpeta de la
// corrida (Date.now(), solo dígitos); el server reconstruye la ruta (no se aceptan rutas del cliente).
// Sin `testId` publica una HU por CADA prueba de la corrida (alcance «por prueba individual»).
export const regressionPublishSchema = z.object({
  targetId: z.string().min(1),
  suiteId: z.string().min(1),
  runId: z.string().regex(/^\d+$/),
  testId: z.string().min(1).optional(),
});

// ── Programación de corridas (PRO #4) ───────────────────────────────────────
// Cadencia de un horario: por hora / diaria / semanal. `time` en HH:MM; `tz` IANA opcional (UTC por
// defecto). El motor (cadence.ts) traduce esto al instante UTC de la próxima corrida.
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, "hora en formato HH:MM");
export const cadenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("hourly"), everyHours: z.number().int().min(1).max(168) }),
  z.object({ kind: z.literal("daily"), time: hhmm, tz: z.string().max(64).optional() }),
  z.object({ kind: z.literal("weekly"), weekday: z.number().int().min(0).max(6), time: hhmm, tz: z.string().max(64).optional() }),
]);

export const scheduleSaveSchema = z.object({
  id: z.string().min(1).max(64),
  targetId: z.string().min(1).max(64),
  suiteId: z.string().min(1).max(64),
  cadence: cadenceSchema,
  enabled: z.boolean().default(true),
});

export const scheduleDeleteSchema = z.object({ id: z.string().min(1).max(64) });

export const schedulerTokenCreateSchema = z.object({ label: z.string().max(120).default("") });

// Credencial de servicio del disparador externo: tenant reclamado + token (validado bajo la RLS
// del tenant). NO es una sesión de usuario.
export const scheduleTickSchema = z.object({
  tenantId: z.uuid(),
  token: z.string().min(10).max(200),
});
