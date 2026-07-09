// failure-explain.mjs — traduce el fallo TÉCNICO de una prueba a lenguaje LLANO para no técnicos.
// PURO / offline / SIN IA: reconoce patrones comunes en el nombre + mensaje del caso y devuelve
// { category, plain, action }. Si no reconoce el patrón devuelve null → la superficie muestra el
// texto crudo tal cual (nunca se oculta información). El texto técnico se conserva como "detalle".
//
// La lista está espejada en la webapp (webapp/src/components/run-detail/failureExplain.ts): si
// agregás/ajustás un patrón acá, replicalo allá para que el reporte y la UX digan lo mismo.

// Primer renglón útil de un mensaje (sin ANSI, recortado) — para citar el detalle en la acción.
function firstLine(s) {
  return String(s || "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)[0] || "";
}

/**
 * @param {{name?:string, message?:string}} tc  caso fallido
 * @param {{layer?:string, tool?:string}} [ctx]
 * @returns {{category:string, plain:string, action?:string}|null}
 */
export function explainFailure(tc = {}, ctx = {}) {
  const name = String(tc.name || "");
  const msg = String(tc.message || "");
  const hay = `${name}\n${msg}`;
  const layer = ctx.layer || "";

  // 1) Dependencia/módulo que no se puede importar (falta instalar o ruta rota). Cubre también
  //    la "suite que no se ejecutó" (nuestro caso sintético trae el error de import en el mensaje).
  let m = hay.match(/(?:Failed to resolve import|Cannot find module|Cannot find package|Module not found)[^"'`]*["'`]([^"'`]+)["'`]/i);
  if (m) {
    const dep = m[1];
    const local = /^[./\\]/.test(dep); // ruta relativa vs paquete de npm
    return {
      category: "missing-import",
      plain: local
        ? `El código intenta importar el archivo «${dep}» pero no existe en esa ruta, así que el archivo de pruebas ni siquiera cargó.`
        : `El código intenta usar la librería «${dep}» pero no está instalada en el repositorio, así que el archivo de pruebas ni siquiera cargó.`,
      action: local
        ? `Corregir la ruta del import o crear el archivo que falta en el repo probado.`
        : `Instalar la dependencia «${dep}» en el repo probado (p. ej. npm install ${dep} / pnpm add ${dep}). Es un arreglo del equipo de desarrollo, no de QA.`,
    };
  }

  // 1b) Fallo por BASE DE DATOS / conexión no disponible (típico en pruebas de integración .NET/otras).
  if (/Npgsql|PostgresException|SqlException|Mongo|Redis|ECONNREFUSED|could not connect|connection refused|password authentication failed|no se pudo conectar|autentificaci.n .*fall|database .* does not exist|no such host|getaddrinfo|28P01|28000|08006|3D000/i.test(hay)) {
    return {
      category: "infra-db",
      plain: `La prueba no logró conectarse a la base de datos (o la autenticación/credenciales fallaron). Es una prueba de INTEGRACIÓN: necesita una base de datos real, levantada y con usuario/clave válidos. No es un error de la lógica del código, sino del ENTORNO donde corre el QA.`,
      action: `Levantá la base de datos de pruebas y cargá su cadena de conexión y credenciales en el entorno del kit (o dejá las pruebas de integración fuera de esta corrida). Si la BD ya existe, revisá usuario/clave/host (el código 28P01 significa "contraseña incorrecta").`,
    };
  }

  // 2) Suite/archivo de prueba que no cargó por otra razón (no un import concreto).
  if (/la suite no se ejecut|error al cargar|SyntaxError|Transform failed|Failed to load/i.test(hay)) {
    return {
      category: "suite-load",
      plain: `El archivo de pruebas no pudo cargarse (un error de código o de compilación), así que ninguna de sus pruebas llegó a correr.`,
      action: `Abrir ese archivo en el repo probado y resolver el error de carga; luego vuelve a correr. Es del equipo de desarrollo.`,
    };
  }

  // 3) Elemento de la interfaz que la prueba no encontró (Testing Library / DOM).
  if (/Unable to find|TestingLibraryElementError|not found in the document|Found multiple elements/i.test(hay)) {
    // El nombre buscado viene como regex literal (name `/texto/i`) o entre comillas (name "texto").
    const nm = msg.match(/name[:\s]+[`'"]?\/\^?(.+?)\$?\/[a-z]*[`'"]?/i) || msg.match(/name[:\s]+["'`](.+?)["'`]/i);
    const target = nm ? `«${nm[1].replace(/[\\^$]/g, "").trim()}»` : "un elemento (botón, campo o enlace)";
    return {
      category: "element-not-found",
      plain: `La prueba buscó ${target} en la pantalla y no lo encontró.`,
      action: `Suele ser un cambio de interfaz: el componente cambió de texto o de estructura y la prueba quedó desalineada, o un cambio ocultó ese elemento. Revisar el componente y/o actualizar la prueba.`,
    };
  }

  // 4) La prueba esperaba un valor y obtuvo otro (aserción).
  if (/AssertionError|expected .+ (?:to (?:deeply )?equal|to be|toEqual|toBe|toMatch|toContain|toHaveBeenCalled)/i.test(hay)) {
    return {
      category: "assertion",
      plain: `La prueba esperaba un resultado y obtuvo otro: lo real no coincide con lo esperado.`,
      action: `Si el comportamiento cambió a propósito, hay que actualizar la prueba; si no, es un posible bug del código. Lo decide el equipo de desarrollo.`,
    };
  }

  // 5) La prueba superó el tiempo límite.
  if (/timed out|timeout|exceeded .* ms|Test timed/i.test(hay)) {
    return {
      category: "timeout",
      plain: `La prueba tardó más del tiempo límite y se cortó antes de terminar.`,
      action: `Puede ser lentitud, una espera mal puesta o algo que nunca llega a ocurrir. Revisar la operación que quedó colgada.`,
    };
  }

  // 6) Hallazgos de SEGURIDAD (bandit/semgrep) — son riesgos, no "tests" rotos.
  if (layer === "security") {
    if (/sql injection/i.test(hay)) {
      return {
        category: "security-sqli",
        plain: `Posible inyección SQL: se arma una consulta a la base de datos pegando texto, lo que permitiría a un atacante manipular esa consulta.`,
        action: `Usar consultas parametrizadas (placeholders) en vez de concatenar texto. Prioridad según dónde corra el código (un script de datos es menos crítico que el API en producción).`,
      };
    }
    if (/format[\s-]?string|non-literal (?:variable|string).*(?:util\.format|console\.log|format)|util\.format/i.test(hay)) {
      return {
        category: "security-format-string",
        plain: `Riesgo de "format string": se arma un mensaje o log pegando una variable; si un atacante mete un especificador de formato, puede alterar el mensaje.`,
        action: `Usar un formato constante y pasar la variable como argumento (p. ej. console.log("%s", valor)).`,
      };
    }
    if (/hard[\s-]?coded|hardcoded (?:password|secret|token|credential)/i.test(hay)) {
      return {
        category: "security-secret",
        plain: `Se detectó una credencial o secreto escrito directamente en el código.`,
        action: `Mover el secreto a variables de entorno o a un gestor de secretos; nunca dejarlo en el código fuente.`,
      };
    }
    return {
      category: "security-generic",
      plain: `El escáner de seguridad marcó un riesgo en este punto del código.`,
      action: firstLine(msg) ? `Detalle del escáner: ${firstLine(msg)}` : `Revisar el detalle técnico del hallazgo.`,
    };
  }

  return null; // patrón no reconocido → la superficie muestra el texto crudo
}

/**
 * Explicación a NIVEL DE CAPA para un resultado con fallo (útil sobre todo cuando la herramienta
 * NO entrega desglose por caso — p.ej. dotnet-test/tsc/redocly salen ≠0 sin JSON por prueba, así
 * que no hay TC que humanizar). Intenta reconocer un patrón en la narrativa; si no, da un texto
 * genérico honesto. Devuelve null si el resultado no es un fallo.
 * @param {{layer?:string, status?:string, narrative?:string, metrics?:object}} r
 * @returns {{category:string, plain:string, action?:string}|null}
 */
export function explainLayerFailure(r = {}) {
  if (r.status !== "fail") return null;
  const tool = (r.metrics && r.metrics.tool) || r.layer || "la herramienta";
  const ex = explainFailure({ name: r.layer, message: r.narrative || "" }, { layer: r.layer, tool: r.metrics && r.metrics.tool });
  if (ex) return ex;
  const isDotnet = /dotnet/i.test(tool);
  const isTypecheck = /tsc|mypy/i.test(tool);
  if (isDotnet) {
    return {
      category: "layer-caseless",
      plain: `Las pruebas de .NET del backend (${tool}) se lanzaron pero la corrida terminó en ERROR, y .NET no dejó en la salida un desglose prueba-por-prueba. Por eso acá no puedo decirte cuál prueba puntual falló (ni, en consecuencia, quién la tocó por última vez): solo se sabe que la capa terminó en rojo. Las dos causas típicas son: (1) una o más pruebas fallaron, o (2) algún proyecto del backend NO compiló — y si no compila, las pruebas ni siquiera llegan a ejecutarse.`,
      action: `Abrí el «Detalle técnico» de esta capa (o corré «dotnet test» en el repo) y buscá la PRIMERA línea con «error CS…» (indica que no compila y qué archivo) o con «Failed …» (indica la prueba en rojo). Con eso ubicás el archivo y ya sabés a quién preguntar. Nota: para que el kit muestre el detalle prueba-por-prueba de .NET habría que enseñarle a leer el reporte TRX/JSON (mejora pendiente).`,
    };
  }
  if (isTypecheck) {
    return {
      category: "layer-caseless",
      plain: `El chequeo de tipos (${tool}) encontró errores y terminó en rojo, pero no emite un desglose “caso por caso” como una suite de pruebas: reporta una lista de errores de tipos en archivos y líneas concretos.`,
      action: `Mirá el «Detalle técnico»: cada error trae su archivo:línea. El primero suele ser la causa raíz (los demás a veces son consecuencia). Ese archivo/línea es el que hay que corregir.`,
    };
  }
  return {
    category: "layer-caseless",
    plain: `La herramienta «${tool}» corrió pero terminó con error (código de salida ≠ 0) y NO entregó un desglose prueba-por-prueba, así que no puedo señalar un caso ni un archivo concretos automáticamente. Suele ser un fallo de compilación, de configuración, o una prueba que no se pudo listar.`,
    action: `Revisá el «Detalle técnico» de abajo o el log completo de ${tool} para ubicar la causa exacta y el archivo afectado.`,
  };
}

export default { explainFailure, explainLayerFailure };
