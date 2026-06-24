import { describe, test, expect } from "vitest";

// La suite declara su HU dueña con la etiqueta [HU-###] (convención de trazabilidad).
describe("[HU-201] Carrito de compras", () => {
  test("suma los totales correctamente", () => {
    expect(2 + 2).toBe(4);
  });

  test("aplica el descuento del 10% (falla a propósito)", () => {
    // total esperado 80, pero el cálculo da 90 → novedad de la HU-201
    expect(90).toBe(80);
  });
});

describe("[HU-202] Login", () => {
  test("redirige al dashboard tras autenticarse", () => {
    expect(true).toBe(true);
  });
});
