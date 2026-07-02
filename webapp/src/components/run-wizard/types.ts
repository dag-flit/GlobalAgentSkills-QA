// Tipos y constantes del asistente de ejecución (RunWizard). El kit quedó acotado al modo
// "Explorar una URL" (pruebas E2E sobre una app viva): Tracker → URL → Ejecutar.

export type Mode = "explore";

export const MODES: { id: Mode; icon: string; label: string; desc: string }[] = [
  {
    id: "explore",
    icon: "🔎",
    label: "Explorar una URL",
    desc: "Smoke + capturas de una app viva en una URL, sin necesitar el código.",
  },
];

export function buildSteps(): { key: string; label: string }[] {
  return [
    { key: "tracker", label: "Tracker" },
    { key: "url", label: "URL" },
    { key: "run", label: "Ejecutar" },
  ];
}
