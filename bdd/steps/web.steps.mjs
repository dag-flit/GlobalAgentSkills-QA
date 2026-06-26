// web.steps.mjs — steps de UI (Playwright) reutilizables. Frases en español, tolerantes a variantes
// (con/sin tilde). El proyecto puede AÑADIR sus propios steps en bdd/steps/ (se cargan junto a estos).
// Las frases coinciden con el TEXTO del paso, sin importar el keyword (Given/Dado/When/Cuando…).

import { Given, When, Then } from "@cucumber/cucumber";
import { strict as assert } from "node:assert";

Given(/^(?:que )?estoy en "([^"]*)"$/i, async function (ruta) {
  const page = await this.openBrowser();
  await page.goto(this.webUrl(ruta));
});

When(/^hago clic en "([^"]*)"$/i, async function (texto) {
  const page = await this.openBrowser();
  await page.getByText(texto, { exact: false }).first().click();
});

When(/^(?:escribo|ingreso) "([^"]*)" en (?:el campo )?"([^"]*)"$/i, async function (valor, campo) {
  const page = await this.openBrowser();
  const byLabel = page.getByLabel(campo);
  if (await byLabel.count()) await byLabel.first().fill(valor);
  else await page.getByPlaceholder(campo).first().fill(valor);
});

Then(/^deber[ií]a ver "([^"]*)"$/i, async function (texto) {
  const page = await this.openBrowser();
  await page.getByText(texto, { exact: false }).first().waitFor({ state: "visible" });
});

Then(/^no deber[ií]a ver "([^"]*)"$/i, async function (texto) {
  const page = await this.openBrowser();
  assert.equal(await page.getByText(texto, { exact: false }).count(), 0, `no debería verse "${texto}"`);
});

Then(/^la URL deber[ií]a contener "([^"]*)"$/i, async function (frag) {
  const page = await this.openBrowser();
  assert.ok(page.url().includes(frag), `la URL ${page.url()} no contiene "${frag}"`);
});
