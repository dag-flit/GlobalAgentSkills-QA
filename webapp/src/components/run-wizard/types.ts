import type { TrackerName } from "@/lib/types";

// Tipos y constantes del asistente de ejecución (RunWizard). Extraídos para que el
// componente principal y sus pasos compartan las mismas definiciones.

export type LayerInfo = {
  enabled: boolean;
  tool: string | null;
  reason?: string | null;
  cwd?: string;
  targets?: { tool: string; cwd: string }[];
};

export type Detection = {
  stack: { backend: string; frontend: string; db: string };
  architecture: string;
  layers: Record<string, LayerInfo>;
  enabled: string[];
  skipped: { layer: string; reason: string }[];
};

export type Mode = "code" | "explore";

export const LAYER_META: Record<string, { label: string; desc: string }> = {
  static: { label: "Análisis estático", desc: "Linter y tipos (eslint, tsc, ruff, mypy)" },
  unit: { label: "Pruebas unitarias", desc: "vitest, jest, pytest, dotnet test" },
  api: { label: "Contrato de API", desc: "OpenAPI o colección Postman" },
  e2e: { label: "Pruebas E2E", desc: "Playwright o Cypress" },
  db: { label: "Base de datos", desc: "Migraciones, pgtap, prisma" },
  security: { label: "Seguridad", desc: "semgrep o bandit" },
};

export const LAYER_ORDER = ["static", "unit", "api", "e2e", "db", "security"];

export const MODES: { id: Mode; icon: string; label: string; desc: string }[] = [
  {
    id: "code",
    icon: "🧪",
    label: "QA del código",
    desc: "Corre las capas del proyecto: estático, unit, API, base de datos, seguridad y E2E. Trazabilidad opcional a un Feature/HUs y URL base para E2E.",
  },
  {
    id: "explore",
    icon: "🔎",
    label: "Explorar una URL",
    desc: "Smoke + capturas de una app viva en una URL, sin necesitar el código.",
  },
];

// Pasos dinámicos: en modo código, el paso Feature aparece solo con tracker remoto y el paso
// URL (base para E2E) solo si la capa e2e quedó activa en la detección.
export function buildSteps(
  mode: Mode,
  tracker: TrackerName,
  e2eOn: boolean,
): { key: string; label: string }[] {
  if (mode === "explore") {
    return [
      { key: "tracker", label: "Tracker" },
      { key: "url", label: "URL" },
      { key: "run", label: "Ejecutar" },
    ];
  }
  return [
    { key: "source", label: "Código" },
    { key: "detect", label: "Detección" },
    { key: "tracker", label: "Tracker" },
    ...(tracker !== "local"
      ? [
          { key: "feature", label: "Feature/HUs" },
          { key: "review", label: "Revisión" },
        ]
      : []),
    ...(e2eOn ? [{ key: "url", label: "URL (E2E)" }] : []),
    { key: "run", label: "Ejecutar" },
  ];
}
