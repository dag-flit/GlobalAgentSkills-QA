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

export const trackerConfigSchema = z.object({
  selected: z.enum(["local", "azure-devops", "github", "jira"]),
  azure: z.object({ orgUrl: z.string(), project: z.string(), pat: z.string(), userEmail: z.string() }),
  github: z.object({ repository: z.string(), token: z.string() }),
  jira: z.object({ baseUrl: z.string(), email: z.string(), token: z.string(), projectKey: z.string() }),
});

export const appConfigSchema = z.object({
  databases: z.array(dbConnectionSchema),
  tracker: trackerConfigSchema,
});

const templateCaseSchema = z.object({
  template: z.string(),
  params: z.record(z.string(), z.string()).optional(),
  huId: z.string(),
});

export const runInputSchema = z.object({
  mode: z.enum(["code", "explore"]),
  repoRoot: z.string().optional(),
  layers: z.array(z.string()).optional(),
  appUrl: z.string().optional(),
  featureId: z.string().optional(),
  huIds: z.array(z.string()).optional(),
  generate: z.boolean().optional(),
  approvedTcKeys: z.array(z.string()).optional(),
  templateCases: z.array(templateCaseSchema).optional(),
});

/** Plan: RunInput pero featureId es obligatorio (se planifica contra un Feature). */
export const planInputSchema = runInputSchema.extend({ featureId: z.string().min(1) });

export const projectSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("local"), localPath: z.string().min(1) }),
  z.object({ kind: z.literal("git"), gitUrl: z.string().min(1), branch: z.string().optional() }),
]);

export const generatePreviewSchema = z.object({
  huIds: z.array(z.union([z.string(), z.number()])).optional(),
  unitTool: z.string().nullable().optional(),
  repoRoot: z.string().nullable().optional(),
});

export const dbTestSchema = z
  .object({ id: z.string().optional(), db: dbConnectionSchema.optional() })
  .refine((b) => Boolean(b.id) || Boolean(b.db), { message: "Falta 'id' o 'db'." });

export const trackerTestSchema = z.object({ tracker: trackerConfigSchema });

export const featureTreeSchema = z.object({
  featureId: z.string().min(1),
  tracker: trackerConfigSchema.optional(),
});

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
