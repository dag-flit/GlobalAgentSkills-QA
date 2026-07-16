// layer-explain.mjs — traduce el resultado de una capa de QA del código a lenguaje claro para el
// REPORTE (local-sink). Dos piezas: qué HACE la herramienta ejecutada (por comando, no por capa) y
// qué SIGNIFICÓ su resultado. Así, cuando algo dice "pasó/falló", se entiende por qué. Puro/offline.

// Qué hace cada herramienta concreta (no la capa): si el comando cambia, cambia la descripción.
const TOOL_DESC = {
  eslint: "linter de JS/TS: revisa estilo, errores y malas prácticas SIN ejecutar el código",
  tsc: "chequeo de tipos de TypeScript: verifica que los tipos sean correctos (no genera archivos)",
  ruff: "linter de Python: detecta errores y malas prácticas",
  mypy: "chequeo de tipos de Python (anotaciones de tipo)",
  "dotnet-build": "análisis estático de .NET: compila con los analizadores Roslyn activados y reporta advertencias (CAxxxx) y errores de compilación (CSxxxx) SIN modificar el repo",
  vitest: "corre las pruebas unitarias del proyecto con Vitest",
  jest: "corre las pruebas unitarias del proyecto con Jest",
  pytest: "corre las pruebas unitarias de Python con pytest",
  "dotnet-test": "corre las pruebas unitarias de .NET (dotnet test)",
  postman: "ejecuta la colección Postman contra la API (newman)",
  openapi: "valida el contrato OpenAPI contra la especificación (redocly lint), sin servidor vivo",
  pgtap: "corre pruebas de base de datos con pgTAP (pg_prove)",
  prisma: "verifica el estado de las migraciones de Prisma",
  "postgres-probe":
    "conecta DIRECTAMENTE a PostgreSQL (con las credenciales/túnel del módulo de BD) y contrasta la base REAL contra lo que el código del repo declara: conectividad, estructura, migraciones aplicadas vs. las del código, aislamiento por cliente (RLS/policies que el propio DDL declara), el privilegio mínimo del rol de conexión (que no sea superusuario), clave primaria por tabla, índices en llaves foráneas, integridad referencial (restricciones validadas), capacidad de las secuencias, codificación y tamaño de las tablas",
  axe: "análisis de accesibilidad (WCAG) con axe-core: abre la página viva y detecta barreras para lectores de pantalla, teclado y contraste. Solo en el modo Explorar URL",
  semgrep: "escáner de seguridad: busca patrones de vulnerabilidad (reglas tipo OWASP) en el código",
  bandit: "escáner de seguridad para Python: detecta usos inseguros comunes",
  "secret-scan": "escáner de secretos: busca credenciales quemadas en el código (contraseñas, llaves privadas, tokens de API, cadenas de conexión con contraseña), con reglas de alta confianza",
  "license-scan": "escáner de licencias: lee la licencia declarada de las dependencias instaladas (node_modules) y marca las copyleft (GPL/AGPL) o sin licencia — riesgo legal en un producto propietario",
  "npm-audit": "análisis de dependencias (SCA): revisa las librerías npm del proyecto contra la base pública de avisos de seguridad",
  "pnpm-audit": "análisis de dependencias (SCA): revisa las librerías del workspace pnpm contra la base pública de avisos de seguridad",
  "dotnet-vulnerable": "análisis de dependencias (SCA): revisa los paquetes NuGet (.NET) del proyecto contra la base de avisos de seguridad",
  "pip-audit": "análisis de dependencias (SCA): revisa las librerías de Python del proyecto contra la base de avisos de seguridad",
};
// Herramientas de análisis de dependencias (SCA), para descripciones que las traten como grupo.
const SCA_TOOLS = new Set(["npm-audit", "pnpm-audit", "dotnet-vulnerable", "pip-audit"]);
export const isScaTool = (tool) => SCA_TOOLS.has(tool);

// Descripción de respaldo por capa cuando la herramienta no está en el mapa.
const LAYER_DESC = {
  static: "revisa el código sin ejecutarlo (linter / chequeo de tipos)",
  unit: "corre las pruebas unitarias del proyecto",
  api: "valida el contrato de la API",
  db: "verificaciones de base de datos",
  security: "escáner de seguridad del código",
  explore: "explora una URL viva (estado HTTP, consola, captura)",
};

/** Qué hace el comando ejecutado (por herramienta; cae a la capa si la herramienta es desconocida). */
export function toolDescription(tool, layer) {
  if (tool && TOOL_DESC[tool]) return TOOL_DESC[tool];
  return LAYER_DESC[layer] || "";
}

// Nombre amigable del stack/herramienta (para descripciones legibles).
const TOOL_STACK = {
  "dotnet-test": ".NET", vitest: "Vitest", jest: "Jest", pytest: "pytest", eslint: "ESLint",
  "dotnet-build": ".NET (analizadores Roslyn)",
  tsc: "TypeScript", ruff: "Ruff", mypy: "mypy", semgrep: "Semgrep", bandit: "Bandit",
  "secret-scan": "escáner de secretos", "license-scan": "licencias de dependencias", "npm-audit": "npm audit", "pnpm-audit": "pnpm audit", "dotnet-vulnerable": "dotnet (NuGet)", "pip-audit": "pip-audit",
  "postgres-probe": "PostgreSQL", openapi: "OpenAPI", newman: "Postman (newman)", pgtap: "pgTAP", prisma: "Prisma",
  axe: "axe-core (accesibilidad)", playwright: "Playwright",
};
export function toolStack(tool) {
  return TOOL_STACK[tool] || tool || "";
}

// Capa ARQUITECTÓNICA (por convención de nombres de proyecto .NET) → qué verifica esa capa.
const ARCH_LAYER = {
  domain: "las reglas de negocio del dominio (entidades e invariantes)",
  application: "los casos de uso y servicios de aplicación (orquestación, handlers, validaciones)",
  infrastructure: "la infraestructura (acceso a datos e integraciones externas)",
  persistence: "la persistencia (repositorios y consultas)",
  api: "los endpoints de la API (controllers y autorización)",
  webapi: "los endpoints de la API (controllers y autorización)",
  web: "la capa web (endpoints/controllers)",
};
// Pista de NEGOCIO por área/módulo (mejora la claridad; con fallback genérico si no está en el mapa).
const AREA_HINT = {
  admin: "administración (empresas, usuarios y roles)",
  analytics: "analítica y reportería",
  security: "seguridad (autenticación, autorización y RBAC)",
  tramites: "trámites",
  infrastructure: "infraestructura (acceso a datos e integraciones)",
  identity: "identidad y autenticación",
  notifications: "notificaciones",
};
function humanize(s) {
  return String(s).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[._]/g, " ").trim();
}
// Parsea el nombre de un proyecto de test (p.ej. "Flit.Analytics.Application.Tests") → módulo + capa.
function parseProject(label) {
  let segs = String(label || "").split(".").filter((s) => s && !/^(flit|tests?|modules?)$/i.test(s));
  let layer = null;
  // La capa arquitectónica solo aplica si NO es el único segmento (califica a un módulo).
  if (segs.length > 1) {
    const last = segs[segs.length - 1].toLowerCase();
    if (ARCH_LAYER[last]) { layer = last; segs = segs.slice(0, -1); }
  }
  const areaKey = (segs[0] || "").toLowerCase();
  const areaName = AREA_HINT[areaKey] || humanize(segs.join(" ")) || "el sistema";
  return { areaName, layer };
}
// Descripción ESPECÍFICA de un objetivo de pruebas unitarias (qué módulo/capa cubre), no un molde repetido.
function describeUnitObjective(r, stack, p) {
  const nP = p ? ` (${p} prueba${p === 1 ? "" : "s"} en verde)` : "";
  const label = r.metrics?.label;
  if (label) {
    const { areaName, layer } = parseProject(label);
    const covers = layer ? `${ARCH_LAYER[layer]} del módulo de ${areaName}` : `el módulo de ${areaName}`;
    return `Verifica ${covers}${stack ? ` — ${stack}` : ""}: sus pruebas automáticas pasaron${nP}.`;
  }
  const pkg = r.metrics?.cwd;
  const where = pkg ? (pkg === "frontend" ? "del frontend" : `del paquete «${pkg}»`) : "del código";
  return `Verifica el comportamiento ${where}${stack ? ` — ${stack}` : ""}: sus pruebas automáticas pasaron${nP}.`;
}

/**
 * Descripción ESPECÍFICA (no genérica) de qué validó una capa que PASÓ, nombrando su OBJETIVO
 * (proyecto/paquete) para que quede claro QUÉ parte del sistema se verificó. Compartida por el
 * reporte local (md/html) y la HU → una sola redacción, consistente en todas las rutas.
 */
export function describePassed(r) {
  const cases = Array.isArray(r.cases) ? r.cases : [];
  const p = cases.filter((c) => c.status === "pass").length;
  const stack = toolStack(r.metrics?.tool);
  const obj = r.metrics?.label || r.metrics?.cwd || "";
  const objTxt = obj ? ` «${obj}»` : "";
  switch (r.layer) {
    case "unit":
      return describeUnitObjective(r, stack, p);
    case "static":
      return `Se revisó el código${obj ? ` de${objTxt}` : ""} SIN ejecutarlo${stack ? ` (con ${stack})` : ""} — estilo, tipos y buenas prácticas — y no hay errores.`;
    case "security":
      if (r.metrics?.tool === "secret-scan")
        return `Se revisó el código del proyecto buscando credenciales quemadas (contraseñas, llaves privadas, tokens de API, cadenas de conexión con contraseña) con reglas de alta confianza y no apareció ninguna. Reduce el riesgo; no garantiza ausencia total.`;
      if (r.metrics?.tool === "license-scan")
        return `Se revisaron las licencias declaradas de las dependencias instaladas del proyecto y todas son permisivas conocidas (MIT/BSD/Apache/ISC…), compatibles con un producto propietario. Reduce el riesgo legal; no lo elimina.`;
      if (isScaTool(r.metrics?.tool))
        return `Se revisaron las dependencias de${objTxt || " terceros del proyecto"} contra la base pública de avisos de seguridad y ninguna versión usada tiene una vulnerabilidad conocida. Reduce el riesgo; no lo elimina.`;
      return `Se escaneó el código${obj ? ` de${objTxt}` : ""}${stack ? ` con ${stack}` : ""} buscando vulnerabilidades conocidas (estilo OWASP) y no apareció ninguna. Reduce el riesgo; no garantiza seguridad total.`;
    case "db": {
      // Se NOMBRAN los puntos comprobados: cada uno es un "momento" distinto que cubrió la capa
      // (conexión, estructura, migraciones, aislamiento por cliente, claves, índices, capacidad…).
      const okNames = cases.filter((c) => c.status === "pass").map((c) => c.name);
      if (!okNames.length) return "Se conectó a la base de datos real del proyecto y se corrieron sus verificaciones.";
      return `Se conectó a la base de datos REAL del proyecto (con las credenciales del módulo de Bases de datos) y se comprobó punto por punto, contra lo que el propio código declara: ${okNames.join(" · ")}. ${okNames.length} verificación(es) en verde.`;
    }
    case "api":
      return `El contrato de la API${objTxt} (OpenAPI) es válido: cumple lo que declara, sin necesitar el servidor corriendo.`;
    case "explore":
      if (r.metrics?.tool === "axe")
        return `Se analizó la accesibilidad (reglas WCAG con axe-core) de ${r.metrics?.pages || "las"} página(s) y no aparecieron violaciones automáticas. Es un análisis automático: cubre parte de WCAG, no reemplaza una revisión manual.`;
      return "Se abrió la URL en un navegador y respondió sin errores (estado HTTP y consola OK).";
    default:
      return p ? `${p} verificación(es) pasaron.` : r.narrative || "Se ejecutó sin problemas.";
  }
}

/**
 * Capas con EVIDENCIA POSITIVA: las que pasaron enteras, y también las que quedaron en rojo pero
 * validaron cosas adentro. Antes la evidencia se perdía justo cuando la capa tenía un hallazgo (la
 * BD conectaba y comprobaba 6 puntos, pero al fallar uno no se mostraba ninguno).
 * REGLA: todo ítem de prueba que una capa cubre se plasma en las 4 rutas (HU, MD, HTML y UX).
 */
export function evidenceLayers(results = []) {
  return results.filter((r) => r.status === "pass" || (Array.isArray(r.cases) && r.cases.some((c) => c.status === "pass")));
}

/**
 * Redacción de la evidencia de una capa, sea completa o parcial. Compartida por md/html/HU → una
 * sola forma de contar qué se validó.
 * @returns {{partial:boolean, passed:object[], lead:string}}
 */
export function describeEvidence(r) {
  const cases = Array.isArray(r.cases) ? r.cases : [];
  const passed = cases.filter((c) => c.status === "pass");
  const partial = r.status !== "pass";
  // Si la capa quedó en rojo NO se puede decir "todo pasó": se nombra lo que sí se validó.
  const lead = partial
    ? `Esta capa terminó con hallazgos, pero ${passed.length} verificación(es) SÍ pasaron y quedan como evidencia (lo que falló está en Hallazgos).`
    : describePassed(r);
  return { partial, passed, lead };
}

/**
 * Qué verificaciones de una capa se listan UNA POR UNA como evidencia concreta.
 * REGLA: un check que trae su propia explicación (`plain` — los declarativos, p.ej. cada punto de la
 * sonda de BD) es un ÍTEM DE PRUEBA y se lista SIEMPRE, sin tope: no puede quedar excluido de "qué se
 * validó" (invariante 8). Antes un tope de 8 los ocultaba a TODOS en cuanto la capa tenía 9 checks.
 * Una suite cruda (71 tests de vitest, sin `plain`) sigue con tope: listarla entera sería ruido, y su
 * evidencia ya está en la redacción de la capa ("N pruebas en verde").
 * Compartida por HU/MD/HTML → una sola selección.
 */
export function evidenceItems(passed = []) {
  const declared = passed.filter((c) => c.plain);
  if (declared.length) return declared;
  return passed.length <= 8 ? passed : [];
}

/** Detalle técnico de un caso (texto crudo de la herramienta) normalizado a una línea legible. */
export function techDetail(m, maxLines = 3) {
  return String(m || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, maxLines).join(" ⏎ ");
}

/**
 * Casos OMITIDOS que traen su propia explicación → "no verificado". NO son hallazgos: o el criterio
 * no aplica al proyecto, o quedó como sugerencia, o no se pudo comprobar. El filtro por `plain` deja
 * fuera el ruido (advertencias del linter y tests saltados, que tienen su propia sección).
 * Compartido por HU/MD/HTML → el mismo ítem se ve en las 4 rutas (invariante 8).
 * @returns {Array<{c:object, r:object}>}
 */
export function notVerifiedCases(results = []) {
  const out = [];
  for (const r of results) {
    for (const c of Array.isArray(r.cases) ? r.cases : []) if (c.status === "skip" && c.plain) out.push({ c, r });
  }
  return out;
}

/** Qué significó el resultado, en lenguaje claro (findings/pass/fail/advertencias/fallo-sin-detalle). */
export function interpretLayer(r) {
  const layer = r.layer;
  const cases = Array.isArray(r.cases) ? r.cases : [];
  const p = cases.filter((c) => c.status === "pass").length;
  const f = cases.filter((c) => c.status === "fail").length;
  const other = cases.length - p - f; // advertencias (static) / saltados o pendientes (unit)

  if (r.status === "skip") {
    return `No se ejecutó: ${r.narrative || "no aplicaba o la herramienta no está en el proyecto"}.`;
  }
  // Falló pero sin desglose por caso (tsc, pytest, dotnet, redocly… no emiten JSON por caso).
  if (r.status === "fail" && cases.length === 0) {
    return "La herramienta terminó en ERROR (código ≠ 0) pero no listó las pruebas una por una. El motivo exacto está en «Capas con fallo (sin desglose)» y en el detalle técnico.";
  }
  if (layer === "static") {
    return f > 0
      ? `Encontró ${f} error(es) que hay que corregir${other ? ` y ${other} advertencia(s) menor(es)` : ""}.`
      : other > 0
        ? `PASÓ porque el linter NO encontró errores (los errores son lo único que bloquea). Lo que ves como “saltados” son ${other} ADVERTENCIA(s): avisos de estilo o buenas prácticas, de severidad baja (p. ej. usar el componente de imagen optimizado, o una variable declarada y no usada). No rompen ni bloquean la app, pero conviene revisarlas — están listadas abajo.`
        : "PASÓ: el linter no encontró ni errores ni advertencias. Código limpio.";
  }
  if (layer === "security") {
    return f > 0
      ? `Encontró ${f} posible(s) hallazgo(s) de seguridad — revisá el detalle.`
      : "No encontró patrones de vulnerabilidad conocidos. Es un escaneo automático: reduce riesgo, no garantiza seguridad total.";
  }
  if (cases.length) {
    return f > 0
      ? `De ${cases.length} caso(s): ${f} fallaron y ${p} pasaron${other ? `, ${other} saltado(s)` : ""}.`
      : `Los ${p} caso(s) ejecutados pasaron${other ? ` (${other} saltado[s]/pendiente[s])` : ""}.`;
  }
  return r.status === "pass"
    ? "Se ejecutó sin errores: la herramienta no reportó problemas."
    : "Falló — revisá el detalle / el reporte.";
}

export default { toolDescription, interpretLayer };
