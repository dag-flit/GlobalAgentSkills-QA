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

// Input de una corrida: modo único "explore" + la URL viva a explorar.
export const runInputSchema = z.object({
  mode: z.literal("explore"),
  appUrl: z.string().optional(),
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
