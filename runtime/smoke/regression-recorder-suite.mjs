// runtime/smoke/regression-recorder-suite.mjs — GRABADOR semi-automático (núcleo PURO). Verifica que
// una interacción grabada se traduzca al paso correcto resolviendo el ALIAS del catálogo de la pantalla,
// que no se graben secretos, y que el ensamblado de pantallas grabadas produzca un recorrido + catálogo
// coherentes (cada elemento accionado queda en el catálogo con alias). Todo offline (sin navegador).
import assert from "node:assert";
import { describeToStep, buildRecordedRecorrido, strategyKey, RECORDER_SCRIPT } from "../regression/recorder.mjs";
import { pickStrategy } from "../regression/harvest.mjs";

export async function run(ctx) {
  console.log("\n-- regression-recorder-suite (grabador semi-automático) --");

  // Mapa clave→alias como el que arma buildRecordedRecorrido para una pantalla.
  const keyToAlias = new Map([
    [strategyKey(pickStrategy({ role: "button", name: "Consultar" })), "consultar"],
    [strategyKey(pickStrategy({ role: "textbox", field: true, label: "Documento" })), "documento"],
    [strategyKey(pickStrategy({ role: "combobox", field: true, label: "Organismo" })), "organismo"],
    [strategyKey(pickStrategy({ role: "checkbox", field: true, nameAttr: "acepta" })), "acepta"],
  ]);

  // 1) clic en un botón → op clic con su alias.
  assert.deepStrictEqual(describeToStep({ kind: "click", role: "button", name: "Consultar" }, keyToAlias), { op: "clic", alias: "consultar" });
  // escritura en un campo → op escribir con el valor.
  assert.deepStrictEqual(describeToStep({ kind: "change", role: "textbox", field: true, label: "Documento", value: "ABC123" }, keyToAlias), { op: "escribir", alias: "documento", valor: "ABC123" });
  // cambio en un select → op seleccionar.
  assert.deepStrictEqual(describeToStep({ kind: "change", role: "combobox", field: true, label: "Organismo", tag: "select", value: "Bogotá" }, keyToAlias), { op: "seleccionar", alias: "organismo", valor: "Bogotá" });
  // input file → subir_archivo (ruta la completa el usuario luego).
  assert.deepStrictEqual(describeToStep({ kind: "change", role: "textbox", field: true, label: "Documento", inputType: "file" }, keyToAlias), { op: "subir_archivo", alias: "documento", ruta: "" });
  ctx.ok("recorder.describeToStep: clic/escribir/seleccionar/subir_archivo con alias del catálogo");

  // 2) NO se graban secretos (campo password) ni acciones sin ancla estable.
  assert.strictEqual(describeToStep({ kind: "change", role: "textbox", field: true, label: "Clave", inputType: "password", value: "hunter2" }, keyToAlias), null);
  assert.strictEqual(describeToStep({ kind: "click", role: "button", name: "Inexistente" }, keyToAlias), null);
  ctx.ok("recorder.describeToStep: no graba password ni pasos sin ancla (devuelve null)");

  // 3) Ensamblado: 2 pantallas grabadas → recorrido con etapas+avances y catálogo por pantalla; cada
  // elemento ACCIONADO queda en el catálogo con alias (aunque no estuviera en la cosecha inicial).
  const built = buildRecordedRecorrido({
    name: "Matrícula Inicial", entryRoute: "/mi",
    screens: [
      { name: "Consulta RUNT",
        nodes: [{ role: "textbox", field: true, label: "Documento", visible: true }],
        actions: [
          { kind: "change", role: "textbox", field: true, label: "Documento", value: "X1" },
          { kind: "click", role: "button", name: "Consultar", visible: true }, // no estaba en nodes → igual se cataloga
        ] },
      { name: "Organismo",
        nodes: [{ role: "combobox", field: true, label: "Organismo", visible: true }],
        actions: [{ kind: "change", role: "combobox", field: true, label: "Organismo", tag: "select", value: "Bogotá" }] },
    ],
  });
  assert.strictEqual(built.recorrido.name, "Matrícula Inicial");
  assert.strictEqual(built.recorrido.stages.length, 2);
  assert.strictEqual(built.recorrido.stages[0].name, "Consulta RUNT");
  assert.deepStrictEqual(built.recorrido.stages[0].advance, [
    { op: "escribir", alias: "documento", valor: "X1" },
    { op: "clic", alias: "consultar" },
  ]);
  assert.strictEqual(built.catalogPages[0].name, "Matrícula Inicial › Consulta RUNT");
  // El botón «Consultar» (accionado, no cosechado) quedó en el catálogo de esa pantalla.
  assert.ok(built.catalogPages[0].elements.some((e) => e.alias === "consultar"), "el elemento accionado se cataloga");
  assert.ok(built.catalogPages[1].elements.some((e) => e.alias === "organismo"));
  ctx.ok("recorder.buildRecordedRecorrido: pantallas grabadas → recorrido + catálogo (nada suelto)");

  // 4) El script inyectado es un string autoinstalable (idempotente) que reporta por __qaRecord.
  assert.match(RECORDER_SCRIPT, /__qaRecorderInstalled/);
  assert.match(RECORDER_SCRIPT, /__qaRecord/);
  assert.match(RECORDER_SCRIPT, /addEventListener\('click'/);
  assert.match(RECORDER_SCRIPT, /password/); // enmascara el valor de campos password en el origen
  ctx.ok("recorder.RECORDER_SCRIPT: script inyectable idempotente que reporta interacciones");
}

export default { run };
