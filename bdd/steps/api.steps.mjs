// api.steps.mjs — steps de API (HTTP) reutilizables con `fetch` (Node 18+, sin deps). Frases en
// español. El proyecto puede añadir los suyos en bdd/steps/. La baseURL de API sale del World
// (API_BASE_URL / BASE_URL).

import { When, Then } from "@cucumber/cucumber";
import { strict as assert } from "node:assert";

When(/^hago (GET|POST|PUT|DELETE|PATCH) (?:a )?"([^"]*)"$/i, async function (metodo, ruta) {
  this.response = await fetch(this.apiUrl(ruta), { method: metodo.toUpperCase() });
  this.responseText = await this.response.text();
});

Then(/^el estado(?: de la respuesta)? (?:es|deber[ií]a ser) (\d{3})$/i, function (code) {
  assert.equal(
    this.response && this.response.status,
    Number(code),
    `el estado fue ${this.response && this.response.status}, se esperaba ${code}`
  );
});

Then(/^la respuesta deber[ií]a contener "([^"]*)"$/i, function (texto) {
  assert.ok((this.responseText || "").includes(texto), `la respuesta no contiene "${texto}"`);
});
