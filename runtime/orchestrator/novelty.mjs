// orchestrator/novelty.mjs — manejo de NOVEDADES (fallas) del ciclo QA.
// Por cada HU con al menos una falla: crear un Bug enlazado a ESA HU + reactivar la HU.
// Lógica pura + orquestación del adapter; extraído de orchestrator.mjs (F1) sin cambiar
// comportamiento. El orquestador solo invoca handleNovelties().

// Extrae el id de HU de una etiqueta de convención: "[HU-103]" / "HU-103" / "HU 103".
// Las pruebas declaran su HU dueña en el título/nombre; lo no etiquetado cae a la HU del ciclo.
export function extractHuTag(text) {
  if (!text) return null;
  const m = String(text).match(/\bHU[-\s]?(\d+)\b/i);
  return m ? m[1] : null;
}

// Agrupa las fallas por la HU EFECTIVA, a nivel de CASO (una capa puede tener pruebas de varias
// HUs). Por convención, cada prueba etiqueta su HU dueña en el nombre ("[HU-103] ..."): así la
// novedad se registra en ESA HU, no en el Feature paraguas. Resolución por caso, en orden:
//   etiqueta [HU-###] del caso → work_item_id declarado por el resultado → HU del ciclo (-w).
// Casos sin etiqueta (y capas transversales sin casos: lint/seguridad) caen a la HU del ciclo
// (p.ej. el Feature). Sin una HU real (local / remoto sin -w) la falla se descarta.
export function groupFailuresByRequirement(results, cycleWi) {
  const cycle = cycleWi ? String(cycleWi) : null;
  const groups = new Map();
  const push = (huId, fragment) => {
    if (!huId || huId === "local") return; // sin HU real → no hay dónde crear el Bug
    if (!groups.has(huId)) groups.set(huId, []);
    groups.get(huId).push(fragment);
  };
  for (const r of results) {
    if (r.status !== "fail") continue;
    const resultHu = r.work_item_id ? String(r.work_item_id) : null;
    const failingCases = Array.isArray(r.cases) ? r.cases.filter((c) => c.status === "fail") : [];
    if (failingCases.length) {
      // agrupa los casos fallidos por su etiqueta de HU; un mismo resultado puede repartirse
      // entre varias HUs (un fragmento por HU, conservando solo sus casos).
      const byHu = new Map();
      for (const c of failingCases) {
        const hu = extractHuTag(c.name) || resultHu || cycle;
        if (!byHu.has(hu)) byHu.set(hu, []);
        byHu.get(hu).push(c);
      }
      for (const [hu, cases] of byHu) {
        push(hu, { layer: r.layer, tc_id: r.tc_id, narrative: r.narrative, metrics: r.metrics, cases });
      }
    } else {
      const hu = resultHu || extractHuTag(r.tc_id) || extractHuTag(r.narrative) || cycle;
      push(hu, { layer: r.layer, tc_id: r.tc_id, narrative: r.narrative, metrics: r.metrics, cases: [] });
    }
  }
  return [...groups.entries()].map(([id, items]) => ({ id, items }));
}

// Compone el Bug a partir de las capas/casos fallidos de una HU (texto neutro de tracker;
// cada adapter lo renderiza a su formato).
export function buildDefectPayload(usId, items) {
  const bullet = (r) => {
    const tc = r.tc_id ? `${r.tc_id} ` : "";
    const tool = r.metrics && r.metrics.tool ? ` [${r.metrics.tool}]` : "";
    return `- ${r.layer}${tool} ${tc}— ${r.narrative || "falla"}`;
  };
  const failedCases = [];
  for (const r of items) {
    if (!Array.isArray(r.cases)) continue;
    for (const c of r.cases) {
      if (c.status !== "fail") continue;
      const msg = c.message ? `: ${String(c.message).split(/\r?\n/)[0]}` : "";
      failedCases.push(`- (${r.layer}) ${c.name}${msg}`);
    }
  }
  const title = `[QA] Novedad en HU ${usId} — ${items.length} capa(s) con fallas`;
  const description = [
    `Novedades detectadas por el ciclo QA local-first en la HU ${usId}.`,
    "",
    "Capas/pruebas con falla:",
    ...items.map(bullet),
    ...(failedCases.length ? ["", "Casos fallidos:", ...failedCases] : []),
  ].join("\n");
  return { title, description };
}

// Por cada HU con novedad: createDefect (Bug enlazado a la HU) → reactivateRequirement
// (reactiva la HU + comentario de trazabilidad). Degrada con aviso: un fallo de red en un
// paso se registra en el resumen pero no aborta el ciclo ni el resto de HUs.
export async function handleNovelties({ adapter, results, workItemId }) {
  const groups = groupFailuresByRequirement(results, workItemId);
  const out = [];
  for (const g of groups) {
    const entry = { work_item_id: g.id, fails: g.items.length, bugId: null };
    try {
      entry.bugId = await adapter.createDefect({ ...buildDefectPayload(g.id, g.items), parent_id: g.id });
    } catch (e) {
      entry.bugError = e.message;
    }
    if (typeof adapter.reactivateRequirement === "function") {
      try {
        entry.reactivation = await adapter.reactivateRequirement(g.id, { bugId: entry.bugId, items: g.items });
      } catch (e) {
        entry.reactivationError = e.message;
      }
    }
    out.push(entry);
  }
  return out;
}
