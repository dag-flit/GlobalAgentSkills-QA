# Plan — Generación de tests con IA: sin costos, con contexto, y "de lo que yo quiera"

> Plan de trabajo acordado para evolucionar el módulo de generación de tests con IA de la webapp.
> **No toca el core** (sigue offline/determinista). La IA vive solo en `webapp/` y se inyecta.
> Estado: aprobado, construyendo en orden 1 → 2 → 3 (todas las fuentes, sin excluir nada).

## Objetivo general

Llevar la generación de tests de "convierte un criterio en un borrador" a un módulo que:
1. **No cueste** (opción 100% local, sin key, sin enviar código afuera) → Fase 1.
2. **Genere tests de mejor calidad** (que conozca el código real, no solo el texto del criterio) → Fase 2.
3. **Acepte cualquier intención de prueba**, no solo los criterios de la HU → Fase 3.

## Invariantes (no romper)

1. El **core sigue offline y determinista**. La IA solo vive en `webapp/`.
2. **Siempre hay fallback a esqueleto.** Si la IA falla/no está → no rompe.
3. **Revisión humana obligatoria** antes de aprobar un test generado (son borradores).
4. **Smoke test verde** tras cada fase (se agregan casos nuevos).
5. Evidencias y tests generados **nunca se suben al repo** (ya en `.gitignore`).

## Punto de partida (cómo está hoy)

- Feature → HUs → cada HU tiene criterios de aceptación (AC).
- `webapp/src/lib/qa/ai-generator.ts` toma el **texto de cada criterio** y pide al modelo
  (Gemini o Anthropic, vía `fetch` directo) **un test por criterio**. Sin key/falla → esqueleto.
- Limitación 1: solo proveedores de nube (suben el código a un servidor externo).
- Limitación 2: al modelo solo se le pasa el texto del criterio → a veces **inventa** funciones/selectores.
- Limitación 3: solo sabe "1 test por criterio de AC"; no acepta intenciones libres.

---

## Fase 1 — Proveedor Ollama (IA local, $0, sin key)

**Qué es:** Ollama corre modelos de IA en la propia máquina (`http://localhost:11434`), sin internet,
sin key, sin costo, sin que el código salga del equipo. Es un **programa aparte** (no dependencia del
kit); se instala UNA vez por máquina/servidor y sirve para cualquier repo. Es **opcional**.

**Por qué:** argumento comercial fuerte (código sensible nunca sale de la red) + $0 perpetuo.

**Qué se construye:**
- `callOllama()` en `ai-generator.ts` junto a Gemini/Anthropic.
- `"ollama"` agregado al enum de proveedores (tipos + Ajustes UI: pide URL local + nombre de modelo,
  no API key).
- "Probar IA" funciona igual con Ollama.

**No cambia:** lógica de generación, fallback a esqueleto, core. Es un proveedor más en el switch.

**Riesgo:** bajo (aditivo). Sin Ollama instalado → error claro + fallback a esqueleto.

**Prueba:** caso de smoke con proveedor mockeado + prueba real con Ollama instalado.

---

## Fase 2 — Grounding: que la IA vea el código real

**Qué es:** hoy la IA escribe el test mirando solo la descripción del criterio. "Grounding" =
darle el material real: el archivo/función que va a probar + 1-2 tests **ya existentes** en el
proyecto como muestra de estilo. (Los tests de ejemplo NO se crean: se aprovechan los que ya hay;
si no hay, genera sin ellos.)

**Por qué:** mayor impacto y menor costo. Reduce alucinaciones (el error más peligroso en QA) y hace
que los tests copien las convenciones del proyecto. Sube calidad más que cambiar a un modelo caro.

**Qué se construye:**
- Paso que arma "contexto" antes de llamar a la IA: usa `qa-detect` (ya conoce stack/rutas) para
  ubicar código relacionado + tests de ejemplo.
- Ese contexto se inyecta en `buildPrompt`, con límites de tamaño y truncado seguro.

**No cambia:** sigue siendo webapp; el core no se entera. Sin contexto → genera como hoy.

**Riesgo:** bajo-medio (cuidar tamaño del prompt y repos atípicos).

**Prueba:** el prompt incluye contexto cuando existe; sin contexto sigue funcionando.

---

## Fase 3 — Test Intents: generar "lo que yo quiera"

**Qué es:** introducir el concepto de "intención de prueba" (`intent = { source, text, context }`)
como fuente genérica del test. El criterio de AC pasa a ser UNA fuente más.

| Fuente | Ejemplo | Dueño del insumo |
|---|---|---|
| (a) Criterios de la HU | lo de hoy (no se pierde) | el tracker |
| (b) Prompt libre | "tests de carga del login: sin red, token expirado, doble submit" | el QA, en la webapp |
| (c) Brief del proyecto `qa-intent.md` | "siempre prueba accesibilidad y estados de error" | el QA, archivo OPCIONAL en el repo |
| (d) Plantillas reutilizables | "smoke de CRUD", "validación de formularios" | base las dejo yo; el QA las amplía en Ajustes |

**Por qué:** es el producto a futuro — generador de tests dirigido por el QA, reutilizable entre
proyectos y empresas.

**Qué se construye:**
- Desacoplar el generador del AC: recibe `intent` en vez de asumir "criterio".
- Webapp: campo de **prompt libre** en Revisión + lectura opcional de `qa-intent.md` del repo.
- **Plantillas** guardadas en Ajustes (`webapp/data/`), reutilizables; con plantillas de arranque.
- Trazabilidad: los tests por intent se publican como TC (Task) igual que hoy (online + offline).

**No cambia:** el flujo de criterios sigue idéntico; el intent libre es adicional. Core intacto.

**Riesgo:** medio (cambio de diseño más grande). Por eso va al final.

**Prueba:** casos de smoke (intent libre genera TC; plantilla aplica; criterio sigue funcionando).

---

## Orden y razón

```
Fase 1 (Ollama)  →  Fase 2 (Grounding)  →  Fase 3 (Test Intents)
  $0 / privado        calidad gratis          la expansión grande
  pequeño, aislado    foundational            construye sobre 1 y 2
```

1. Ollama primero: chico, aislado, responde ya a "sin costos".
2. Grounding segundo: mejora la calidad de todo lo que venga después (incluidos los intents).
3. Test Intents al final: cambio de diseño más grande; se beneficia de 1 y 2 firmes.

Cada fase es independiente y entregable.

## Decisiones tomadas

- Construir **las tres fases en orden, completas** (todas las fuentes de Fase 3, sin excluir nada).
- Ollama: se construye el enchufe aunque no esté instalado; "Probar IA" lo valida cuando exista.
- Brief (`qa-intent.md`) lo escribe el QA en el repo; plantillas las dejo de base y el QA las amplía.
