import type { LogLevel } from "@/lib/types";

// Constantes y utilidades del detalle de corrida (RunDetail). Extraídas para repartir el
// componente en archivos bajo el límite de líneas.

export const LEVEL_COLOR: Record<LogLevel, string> = {
  info: "text-blue-300",
  stdout: "text-gray-300",
  stderr: "text-amber-300",
  agent: "text-green-300",
  tool: "text-violet-300",
  result: "text-cyan-300",
  error: "text-red-300",
  system: "text-muted",
};

// Descripción en lenguaje claro de cada capa (exploración E2E + capas de QA del código).
export const LAYER_INFO: Record<string, { label: string; desc: string }> = {
  explore: { label: "Exploración de URL", desc: "Abre la app en un navegador: revisa estado HTTP, errores de consola y guarda una captura." },
  static: { label: "Análisis estático", desc: "Linter / type-checker: revisa estilo, tipos y reglas del código (eslint, tsc, ruff, mypy)." },
  unit: { label: "Pruebas unitarias", desc: "Corre la suite de tests del repo (vitest, jest, pytest, dotnet test)." },
  api: { label: "Contrato de API", desc: "Valida el contrato OpenAPI (redocly) o corre colecciones Postman (newman)." },
  db: { label: "Base de datos", desc: "Valida la base: conecta directamente a PostgreSQL (o corre pgTAP/prisma) usando la conexión configurada." },
  security: { label: "Seguridad", desc: "Escáner SAST (semgrep / bandit) + escáner de secretos + análisis de dependencias (SCA: npm / pnpm / dotnet / pip): patrones de vulnerabilidad, credenciales quemadas y librerías vulnerables." },
};

// Nombre amigable del stack/herramienta (para descripciones claras y específicas de la evidencia).
const TOOL_STACK: Record<string, string> = {
  "dotnet-test": ".NET", vitest: "Vitest", jest: "Jest", pytest: "pytest", eslint: "ESLint",
  tsc: "TypeScript", ruff: "Ruff", mypy: "mypy", semgrep: "Semgrep", bandit: "Bandit",
  "secret-scan": "escáner de secretos", "npm-audit": "npm audit", "pnpm-audit": "pnpm audit", "dotnet-vulnerable": "dotnet (NuGet)", "pip-audit": "pip-audit",
  "postgres-probe": "PostgreSQL", openapi: "OpenAPI", newman: "Postman", pgtap: "pgTAP", prisma: "Prisma",
};
// Herramientas de análisis de dependencias (SCA).
const SCA_TOOLS = new Set(["npm-audit", "pnpm-audit", "dotnet-vulnerable", "pip-audit"]);

// Da SIGNIFICADO al nombre de un proyecto/objetivo de test (capa arquitectónica + módulo de negocio),
// para que la evidencia de cada objetivo sea distinta y descriptiva (no un molde repetido). Espejo del
// motor `layer-explain.describePassed` → mismo texto en la UI que en el reporte/HU.
const ARCH_LAYER: Record<string, string> = {
  domain: "las reglas de negocio del dominio (entidades e invariantes)",
  application: "los casos de uso y servicios de aplicación (orquestación, handlers, validaciones)",
  infrastructure: "la infraestructura (acceso a datos e integraciones externas)",
  persistence: "la persistencia (repositorios y consultas)",
  api: "los endpoints de la API (controllers y autorización)",
  webapi: "los endpoints de la API (controllers y autorización)",
  web: "la capa web (endpoints/controllers)",
};
const AREA_HINT: Record<string, string> = {
  admin: "administración (empresas, usuarios y roles)",
  analytics: "analítica y reportería",
  security: "seguridad (autenticación, autorización y RBAC)",
  tramites: "trámites",
  infrastructure: "infraestructura (acceso a datos e integraciones)",
  identity: "identidad y autenticación",
  notifications: "notificaciones",
};
function humanizeName(s: string): string {
  return String(s).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._]/g, " ").trim();
}
function describeUnitObjective(label: string, cwd: string, stack: string, p: number): string {
  const nP = p ? ` (${p} prueba${p === 1 ? "" : "s"} en verde)` : "";
  if (label) {
    let segs = label.split(".").filter((s) => s && !/^(flit|tests?|modules?)$/i.test(s));
    let layer: string | null = null;
    if (segs.length > 1) {
      const last = segs[segs.length - 1].toLowerCase();
      if (ARCH_LAYER[last]) { layer = last; segs = segs.slice(0, -1); }
    }
    const areaKey = (segs[0] || "").toLowerCase();
    const areaName = AREA_HINT[areaKey] || humanizeName(segs.join(" ")) || "el sistema";
    const covers = layer ? `${ARCH_LAYER[layer]} del módulo de ${areaName}` : `el módulo de ${areaName}`;
    return `Verifica ${covers}${stack ? ` — ${stack}` : ""}: sus pruebas automáticas pasaron${nP}.`;
  }
  const where = cwd ? (cwd === "frontend" ? "del frontend" : `del paquete «${cwd}»`) : "del código";
  return `Verifica el comportamiento ${where}${stack ? ` — ${stack}` : ""}: sus pruebas automáticas pasaron${nP}.`;
}

export const STATUS_TXT: Record<string, { label: string; cls: string }> = {
  pass: { label: "PASÓ", cls: "bg-green-900 text-green-300" },
  fail: { label: "FALLÓ", cls: "bg-red-900 text-red-300" },
  skip: { label: "OMITIDA", cls: "bg-panel2 text-muted" },
};

// Explicación en lenguaje claro de una capa: QUÉ hace la herramienta (para qué sirve) y QUÉ significó
// su resultado. Pensado para alguien NO técnico: nada de "exit 0", sí "no encontró problemas". Así,
// cuando algo dice "pasó", queda claro POR QUÉ pasó.
export function layerNarrative(r: any): { what: string; result: string } {
  const layer = r.layer as string;
  const tool = r.metrics?.tool as string | undefined;
  const cases = Array.isArray(r.cases) ? r.cases : [];
  const p = cases.filter((c: any) => c.status === "pass").length;
  const f = cases.filter((c: any) => c.status === "fail").length;
  const other = cases.length - p - f; // advertencias (static) / saltados o pendientes (unit)

  // Descripción POR HERRAMIENTA (no por capa): si el comando cambia, cambia la descripción.
  const TOOL_WHAT: Record<string, string> = {
    eslint: "Linter de JS/TS: revisa estilo, errores y malas prácticas SIN ejecutar el código.",
    tsc: "Chequeo de tipos de TypeScript: verifica que los tipos sean correctos (no genera archivos).",
    ruff: "Linter de Python: detecta errores y malas prácticas.",
    mypy: "Chequeo de tipos de Python (anotaciones de tipo).",
    vitest: "Corre las pruebas unitarias del proyecto con Vitest.",
    jest: "Corre las pruebas unitarias del proyecto con Jest.",
    pytest: "Corre las pruebas unitarias de Python con pytest.",
    "dotnet-test": "Corre las pruebas unitarias de .NET (dotnet test).",
    postman: "Ejecuta la colección Postman contra la API (newman).",
    openapi: "Valida el contrato OpenAPI contra la especificación (redocly), sin servidor vivo.",
    pgtap: "Corre pruebas de base de datos con pgTAP.",
    prisma: "Verifica el estado de las migraciones de Prisma.",
    "postgres-probe": "Conecta DIRECTAMENTE a la base PostgreSQL configurada (usuario, clave y túnel del módulo de BD) y contrasta la base REAL contra lo que el código del repo declara: que la conexión funcione, que la base tenga tablas, que las migraciones del código estén aplicadas, que el aislamiento por cliente (RLS) que el propio DDL declara esté activo en la base, que toda tabla tenga clave primaria, que las llaves foráneas tengan índice, que los contadores de IDs no estén por agotarse, la codificación del texto y el tamaño de las tablas.",
    semgrep: "Escáner de seguridad: busca patrones de vulnerabilidad (OWASP) en el código.",
    bandit: "Escáner de seguridad para Python: detecta usos inseguros comunes.",
    "secret-scan": "Escáner de secretos: busca credenciales quemadas en el código (contraseñas, llaves privadas, tokens de API, cadenas de conexión con contraseña), con reglas de alta confianza. El valor detectado se muestra REDACTADO.",
    "npm-audit": "Análisis de dependencias (SCA): revisa las librerías npm del proyecto contra la base pública de avisos de seguridad conocidos.",
    "pnpm-audit": "Análisis de dependencias (SCA): revisa las librerías del workspace pnpm contra la base pública de avisos de seguridad conocidos.",
    "dotnet-vulnerable": "Análisis de dependencias (SCA): revisa los paquetes NuGet (.NET) del proyecto contra la base de avisos de seguridad conocidos.",
    "pip-audit": "Análisis de dependencias (SCA): revisa las librerías de Python del proyecto contra la base de avisos de seguridad conocidos.",
  };
  const WHAT: Record<string, string> = {
    static: "Revisa el código SIN ejecutarlo, buscando errores de tipos, estilo y malas prácticas.",
    unit: "Ejecuta las pruebas unitarias del proyecto: comprueba que cada parte haga lo que debe.",
    api: "Valida que la API cumpla el contrato que declara, sin necesitar el servidor corriendo.",
    db: "Corre verificaciones sobre la base de datos usando la conexión del entorno.",
    security: "Escanea el código en busca de patrones de vulnerabilidad conocidos, estilo OWASP.",
  };
  let what = (tool && TOOL_WHAT[tool]) || WHAT[layer] || (tool ? `Herramienta ejecutada: ${tool}.` : "");
  // Cada tarjeta es UN objetivo distinto (un comando). Cuando el objetivo tiene nombre propio (p.ej. un
  // proyecto de test .NET en el fan-out, o la sonda de BD), se antepone para que no se confunda con otro.
  const label = r.metrics?.label as string | undefined;
  if (label) what = `Objetivo: «${label}» (esta tarjeta es un comando/proyecto puntual). ${what}`;

  if (r.status === "skip") {
    return { what, result: `No se ejecutó — ${r.narrative || "no aplicaba o la herramienta no está en el proyecto"}.` };
  }
  // Falló sin desglose por caso (tsc/pytest/dotnet/redocly no emiten JSON por caso).
  if (r.status === "fail" && cases.length === 0) {
    return { what, result: "La herramienta terminó en ERROR (código ≠ 0) pero no listó las pruebas una por una. El motivo está en «Qué pasó» aquí abajo y en el detalle técnico." };
  }
  // Evidencia ESPECÍFICA (no genérica) cuando la capa PASA: nombra su objetivo/proyecto y qué validó.
  if (r.status === "pass") {
    const objId = (r.metrics?.label as string) || (r.metrics?.cwd as string) || "";
    const stack = TOOL_STACK[tool || ""] || tool || "";
    const objTxt = objId ? ` «${objId}»` : "";
    let res: string;
    if (layer === "unit") res = describeUnitObjective((r.metrics?.label as string) || "", (r.metrics?.cwd as string) || "", stack, p);
    else if (layer === "static") res = `Se revisó el código${objId ? ` de${objTxt}` : ""} SIN ejecutarlo${stack ? ` (con ${stack})` : ""} — estilo, tipos y buenas prácticas — y no hay errores${other ? `. Quedan ${other} sugerencia(s) menor(es), listadas abajo` : ""}.`;
    else if (layer === "security") res = tool === "secret-scan"
      ? `Se revisó el código del proyecto buscando credenciales quemadas (contraseñas, llaves privadas, tokens de API, cadenas de conexión con contraseña) con reglas de alta confianza y no apareció ninguna. Reduce el riesgo; no garantiza ausencia total.`
      : SCA_TOOLS.has(tool || "")
        ? `Se revisaron las dependencias de${objTxt || " terceros del proyecto"} contra la base pública de avisos de seguridad y ninguna versión usada tiene una vulnerabilidad conocida. Reduce el riesgo; no lo elimina.`
        : `Se escaneó el código${objId ? ` de${objTxt}` : ""}${stack ? ` con ${stack}` : ""} buscando vulnerabilidades conocidas (OWASP) y no apareció ninguna. Reduce el riesgo; no garantiza seguridad total.`;
    // Se NOMBRAN los puntos comprobados: cada uno es un "momento" distinto que cubrió la capa
    // (conexión, estructura, migraciones, aislamiento por cliente, claves, índices, capacidad…).
    // Espejo de layer-explain.describePassed → mismo texto en UX, reporte md/html y HU.
    else if (layer === "db") {
      const okNames = cases.filter((c: any) => c.status === "pass").map((c: any) => c.name);
      res = okNames.length
        ? `Se conectó a la base de datos REAL del proyecto (con las credenciales del módulo de Bases de datos) y se comprobó punto por punto, contra lo que el propio código declara: ${okNames.join(" · ")}. ${okNames.length} verificación(es) en verde.`
        : "Se conectó a la base de datos real del proyecto y se corrieron sus verificaciones.";
    }
    else if (layer === "api") res = `El contrato de la API${objTxt} (OpenAPI) es válido: cumple lo que declara, sin necesitar el servidor corriendo.`;
    else res = p ? `${p} verificación(es) pasaron.` : "Se ejecutó sin errores.";
    return { what, result: res };
  }
  let result: string;
  if (layer === "static") {
    result = f > 0
      ? `Encontró ${f} error(es) que hay que corregir${other ? ` y ${other} advertencia(s) menor(es)` : ""}.`
      : other > 0
        ? `PASÓ porque el linter NO encontró errores (los errores son lo único que bloquea). Lo que aparece como “saltados” son ${other} ADVERTENCIA(s): avisos de estilo o buenas prácticas, de severidad baja (p. ej. usar el componente de imagen optimizado, o una variable declarada y sin usar). No rompen ni bloquean la app, pero conviene revisarlas — están listadas abajo.`
        : `PASÓ: el linter no encontró ni errores ni advertencias. Código limpio.`;
  } else if (layer === "security") {
    result = f > 0
      ? `Encontró ${f} posible(s) hallazgo(s) de seguridad — revisá el detalle abajo.`
      : `No encontró patrones de vulnerabilidad conocidos. Es un escaneo automático: reduce riesgo, no garantiza seguridad total.`;
  } else if (cases.length) {
    result = f > 0
      ? `De ${cases.length} caso(s): ❌ ${f} fallaron y ✅ ${p} pasaron${other ? `, ⏭ ${other} saltado(s)` : ""}.`
      : `Los ${p} caso(s) ejecutados pasaron${other ? ` (⏭ ${other} saltado[s]/pendiente[s])` : ""}.`;
  } else {
    result = r.status === "pass"
      ? `Se ejecutó sin errores: la herramienta no reportó problemas.`
      : `Falló — revisá el detalle / el reporte.`;
  }
  return { what, result };
}

export const artifactUrl = (p: string) => `/api/artifacts?path=${encodeURIComponent(p)}`;

// Explicación en lenguaje CLARO de una regla de linter (para quien no es técnico): qué significa la
// advertencia, más allá del código de la regla y la ruta del archivo. El nombre del caso viene como
// "ruta/archivo.ext:línea:col regla" (eslint/ruff) → separa ubicación y regla, y traduce la regla.
const RULE_HELP: Record<string, string> = {
  // Sin `<` `>` en el texto (en JSX/HTML se interpretan como etiquetas y desaparecen): se usan «».
  "@next/next/no-img-element": "Se usa la etiqueta «img» en lugar del componente «Image» de Next, que optimiza el peso y la carga de la imagen. Conviene reemplazarla por «Image».",
  "react-hooks/exhaustive-deps": "A un useEffect/useMemo le faltan (o le sobran) dependencias en su lista; puede mostrar datos desactualizados.",
  "react/no-unescaped-entities": "Hay comillas o apóstrofos sin escapar dentro del texto JSX; conviene escaparlos.",
  "prefer-const": "Una variable declarada con «let» que nunca cambia: debería ser «const».",
  "no-console": "Quedó un console.* (log/warn) en el código; conviene quitarlo antes de producción.",
  "no-debugger": "Quedó un «debugger» en el código; hay que quitarlo.",
};
const RULE_PREFIX_HELP: Array<[RegExp, string]> = [
  [/no-unused-vars/, "Hay una variable, import o parámetro declarado que no se usa; conviene quitarlo para limpiar el código."],
  [/no-explicit-any/, "Se usa el tipo «any», que apaga el chequeo de tipos; preferí un tipo concreto."],
  [/^jsx-a11y\//, "Regla de accesibilidad (a11y): el elemento no cumple una buena práctica de accesibilidad (p.ej. falta una etiqueta o un texto alternativo)."],
  [/^@typescript-eslint\//, "Regla de TypeScript sobre tipos o estilo del código."],
  [/^react-hooks\//, "Regla sobre el uso correcto de los hooks de React."],
  [/^react\//, "Regla de buenas prácticas de React."],
  [/^import\//, "Regla sobre cómo se importan o exportan los módulos."],
];
export function lintRuleHelp(name: string): { rule: string; location: string; help: string } | null {
  // "ruta/archivo.ext:línea[:col] regla" → ubicación + regla.
  const m = String(name || "").match(/^(.*?:\d+(?::\d+)?)\s+(\S.*)$/);
  if (!m) return null;
  const location = m[1];
  const rule = m[2].trim();
  const help = RULE_HELP[rule] || RULE_PREFIX_HELP.find(([re]) => re.test(rule))?.[1]
    || "Regla de buenas prácticas del linter. No bloquea ni rompe la app, pero conviene revisarla (el nombre de la regla indica el tema).";
  return { rule, location, help };
}

// Separa "ruta:línea[:col]" (posix). Preserva la ruta EXACTA (los agentes la usan para corregir).
export function parseLoc(location: string): { path: string; line: number | null; raw: string } {
  const s = String(location || "").replace(/\\/g, "/");
  const m = s.match(/^(.*?):(\d+)(?::\d+)?$/);
  const path = m ? m[1] : s.replace(/:.*$/, "") || s;
  const line = m ? Number(m[2]) : null;
  return { path, line, raw: line ? `${path}:${line}` : path };
}

// Nombre AMIGABLE de un archivo (para no técnicos), derivado de la ruta por convención. Espejo del motor
// `lint-explain.friendlyFile`. NO reemplaza la ruta exacta: es un rótulo humano que va JUNTO a ella.
export function friendlyFile(path: string): string {
  const p = String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const base = p.split("/").pop() || p;
  const noExt = base.replace(/\.[^.]+$/, "");
  const app = p.match(/(?:^|\/)app\/(.*)\/(page|layout|route|loading|error|not-found)\.[jt]sx?$/i);
  if (app) {
    const route = "/" + app[1].replace(/\((?:[^)]+)\)\/?/g, "").replace(/^\/+/, "");
    const kind: Record<string, string> = { page: "Página", layout: "Layout", route: "Ruta API", loading: "Estado de carga", error: "Página de error", "not-found": "Página 404" };
    return `${kind[app[2].toLowerCase()] || "Vista"} «${route || "/"}»`;
  }
  if (/(?:^|\/)components?\//i.test(p)) return `Componente «${noExt}»`;
  if (/(?:^|\/)hooks?\//i.test(p) || /^use[A-Z]/.test(noExt)) return `Hook «${noExt}»`;
  if (/\.(test|spec)\.[jt]sx?$|(?:^|\/)__tests__\//i.test(p)) return `Prueba «${noExt}»`;
  if (/(?:^|\/)api\//i.test(p)) return `API «${noExt}»`;
  if (/(?:^|\/)(lib|utils?|helpers?|services?|domain|application|infrastructure)\//i.test(p)) return `Módulo «${noExt}»`;
  return `Archivo «${base}»`;
}

// Agrupa las advertencias del linter (casos "skip" de static) por REGLA → explicación UNA vez + ocurrencias.
export function groupLintWarnings(cases: any[]): Array<{ rule: string; help: string; files: number; occ: Array<{ friendly: string; line: number | null; raw: string }> }> {
  const byRule = new Map<string, { rule: string; help: string; occ: Array<{ friendly: string; line: number | null; raw: string }> }>();
  for (const c of cases) {
    if (c.status !== "skip") continue;
    const lr = lintRuleHelp(c.name);
    const rule = lr?.rule || String(c.name);
    const loc = parseLoc(lr?.location || String(c.name));
    if (!byRule.has(rule)) byRule.set(rule, { rule, help: lr?.help || "", occ: [] });
    byRule.get(rule)!.occ.push({ friendly: friendlyFile(loc.path), line: loc.line, raw: loc.raw });
  }
  return [...byRule.values()].map((r) => ({ ...r, files: new Set(r.occ.map((o) => o.raw.replace(/:.*/, ""))).size }));
}
