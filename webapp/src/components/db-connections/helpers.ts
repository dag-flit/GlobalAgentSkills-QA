import type { DbConnection, DbEngine, SshConfig } from "@/lib/types";

// Constantes y utilidades del gestor de conexiones de BD. Extraídas del componente para
// mantener cada archivo bajo el límite de líneas.

export function defaultSsh(): SshConfig {
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

export const ENGINES: { value: DbEngine; label: string; defaultPort: number }[] = [
  { value: "postgres", label: "PostgreSQL", defaultPort: 5432 },
  { value: "mysql", label: "MySQL / MariaDB", defaultPort: 3306 },
  { value: "mssql", label: "SQL Server", defaultPort: 1433 },
];

export const SECRET_MASK = "••••••••";

export type DbTarget = {
  engine: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
  hasPassword: boolean;
  passwordHasEdgeSpaces: boolean;
  viaSsh: boolean;
};

export type TestState = {
  status: "idle" | "testing" | "ok" | "err";
  message?: string;
  hint?: string;
  target?: DbTarget;
};

/** ¿El texto tiene espacios (u otros blancos) al inicio o al final? */
export function hasEdgeSpaces(s: string): boolean {
  return Boolean(s) && s !== s.trim();
}

/** Convierte el error del driver en una pista accionable en español. */
export function hintFor(message: string, t?: DbTarget): string | undefined {
  const m = (message || "").toLowerCase();
  if (/all configured authentication methods failed/.test(m))
    return "El servidor SSH rechazó las credenciales. Revisa el usuario y la contraseña (o la llave) del túnel SSH.";
  if (/handshake|getaddrinfo.*22|ssh/.test(m))
    return "No se pudo establecer la sesión SSH. Revisa el host, puerto y credenciales del servidor SSH.";
  if (/does not support ssl/.test(m))
    return "Tu servidor no acepta SSL. Desmarca «Usar SSL/TLS» y vuelve a probar (normal en localhost).";
  if (/password|autentificaci|authentication/.test(m))
    return `Usuario o contraseña de la BD incorrectos para «${t?.user ?? "?"}». Verifica también que ese usuario tenga acceso a la base «${t?.database ?? "?"}».`;
  if (/econnrefused/.test(m))
    return `No hay nadie escuchando en el destino. ${t?.viaSsh ? "Revisa el forward host/puerto (la BD vista desde el servidor SSH)." : `Revisa host/puerto (${t?.host}:${t?.port}) y que el servidor esté encendido.`}`;
  if (/enotfound|getaddrinfo/.test(m)) return `No se pudo resolver el host${t?.viaSsh ? " del servidor SSH" : ` «${t?.host}»`}.`;
  if (/no existe la base|database .* does not exist/.test(m))
    return `La base «${t?.database}» no existe. Revisa el nombre.`;
  if (/timeout|timed out/.test(m)) return `Tiempo de espera agotado conectando a ${t?.host}:${t?.port}.`;
  return undefined;
}

export function newConnection(): DbConnection {
  return {
    id: `db-${Date.now()}`,
    name: "Nueva conexión",
    engine: "postgres",
    host: "localhost",
    port: 5432,
    database: "",
    user: "postgres",
    password: "",
    ssl: false,
    ssh: defaultSsh(),
    isDefault: false,
  };
}
