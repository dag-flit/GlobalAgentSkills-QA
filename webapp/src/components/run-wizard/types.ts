// Tipos y constantes del asistente de ejecución (RunWizard). Dos modos:
//  • "explore" — pruebas E2E sobre una app viva (Tracker → URL → Ejecutar).
//  • "code"    — QA del código: capas deterministas static/unit/api/db/security sobre un repo
//                local confinado (Tracker → Código → Ejecutar). Sin navegador, sin IA.

export type Mode = "explore" | "code";

// Capas del modo "QA del código" (subconjunto ejecutable determinista).
export type CodeLayer = "static" | "unit" | "api" | "db" | "security";

export const CODE_LAYERS: { id: CodeLayer; label: string; desc: string }[] = [
  { id: "static", label: "Análisis estático", desc: "Linter / type-checker (eslint, tsc, ruff, mypy)" },
  { id: "unit", label: "Pruebas unitarias", desc: "vitest, jest, pytest, dotnet test" },
  { id: "api", label: "Contrato de API", desc: "OpenAPI (redocly) / colecciones Postman (newman)" },
  { id: "db", label: "Base de datos", desc: "pgTAP / prisma (conexión desde env)" },
  { id: "security", label: "Seguridad", desc: "Escáner SAST (semgrep / bandit)" },
];

export const MODES: { id: Mode; icon: string; label: string; desc: string }[] = [
  {
    id: "explore",
    icon: "🔎",
    label: "Explorar una URL",
    desc: "Smoke + capturas de una app viva en una URL, sin necesitar el código.",
  },
  {
    id: "code",
    icon: "🧪",
    label: "QA del código",
    desc: "Corre capas static/unit/api/db/security sobre un repo local. Determinista, sin IA.",
  },
];

// Pasos por modo. `code` tiene su propio flujo (Tracker → Código → Ejecutar); `explore` conserva
// el flujo E2E intacto (Tracker → PR → URL → Pasos → Ejecutar).
export function buildSteps(mode: Mode): { key: string; label: string }[] {
  if (mode === "code") {
    return [
      { key: "tracker", label: "Tracker" },
      { key: "code", label: "Código" },
      { key: "run", label: "Ejecutar" },
    ];
  }
  return [
    { key: "tracker", label: "Tracker" },
    { key: "pr", label: "Desde un PR" },
    { key: "url", label: "URL" },
    { key: "pasos", label: "Pasos" },
    { key: "run", label: "Ejecutar" },
  ];
}
