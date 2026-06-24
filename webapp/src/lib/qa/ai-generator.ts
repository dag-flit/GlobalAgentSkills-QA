import { importKit } from "./kit";
import { loadConfig } from "@/lib/config";
import type { AiProvider } from "@/lib/types";

// Generador de pruebas con IA (Fase B). AGNÓSTICO del proveedor: hoy soporta Google Gemini
// (capa gratis en AI Studio) y Anthropic Claude, vía HTTP directo (sin SDKs ni deps nuevas).
// Es una capa de la WEBAPP (no del core del kit): el core sigue offline/determinista y este
// generador se INYECTA. Si no hay proveedor/key configurados, cae a los esqueletos de Fase A.

const DEFAULT_MODELS: Record<AiProvider, string> = {
  none: "",
  google: "gemini-2.0-flash",
  anthropic: "claude-opus-4-8",
};

interface ResolvedAi {
  provider: AiProvider;
  apiKey: string;
  model: string;
}

/** Resuelve proveedor + key + modelo desde la config guardada, con fallback a variables de entorno. */
export function resolveAi(): ResolvedAi {
  const cfg = loadConfig().ai;
  let provider: AiProvider = cfg?.provider ?? "none";
  let apiKey = cfg?.apiKey ?? "";

  // Fallback / autodetección por variable de entorno (no hace falta pegar la key en la UI).
  if (!apiKey) {
    const g = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
    const a = process.env.ANTHROPIC_API_KEY || "";
    if (provider === "google") apiKey = g;
    else if (provider === "anthropic") apiKey = a;
    else if (g) { provider = "google"; apiKey = g; }
    else if (a) { provider = "anthropic"; apiKey = a; }
  }

  const model = (cfg?.model && cfg.model.trim()) || DEFAULT_MODELS[provider] || "";
  return { provider, apiKey, model };
}

export function aiStatus(): { enabled: boolean; provider: AiProvider; model: string } {
  const ai = resolveAi();
  return { enabled: ai.provider !== "none" && !!ai.apiKey, provider: ai.provider, model: ai.model };
}

// ── Llamadas a los proveedores (HTTP directo) ────────────────────────────────

function parseJson(text: string): any {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  const slice = start >= 0 && end > start ? t.slice(start, end + 1) : t;
  return JSON.parse(slice);
}

async function callGoogle(ai: ResolvedAi, prompt: string): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent?key=${encodeURIComponent(ai.apiKey)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json", maxOutputTokens: 8192 },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("");
  return parseJson(text);
}

async function callAnthropic(ai: ResolvedAi, prompt: string): Promise<any> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ai.apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: ai.model, max_tokens: 8192, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = (j?.content || []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
  return parseJson(text);
}

async function callLLM(ai: ResolvedAi, prompt: string): Promise<any> {
  if (ai.provider === "google") return callGoogle(ai, prompt);
  if (ai.provider === "anthropic") return callAnthropic(ai, prompt);
  throw new Error(`proveedor IA no soportado: ${ai.provider}`);
}

// ── Prompt ───────────────────────────────────────────────────────────────────

function buildPrompt(requirement: any, tcs: any[], framework: string): string {
  const huId = String(requirement?.id || "");
  const huTitle = requirement?.title || "";
  const criteria = tcs
    .map((t) => `AC${t.acIndex}: ${t.criterion}${t.detail ? `\n${t.detail}` : ""}`)
    .join("\n\n");
  return [
    `Eres un ingeniero de QA senior. Escribe pruebas automatizadas en ${framework} (TypeScript) para la Historia de Usuario ${huId}${huTitle ? ` ("${huTitle}")` : ""}.`,
    `Por CADA criterio de aceptación de abajo, escribe UN test real y ejecutable que valide ese criterio.`,
    ``,
    `Reglas:`,
    `- Usa ${framework}; importa lo necesario desde "${framework}".`,
    `- Etiqueta el describe con [HU-${huId}] en su nombre (para trazabilidad por HU).`,
    `- Cada "code" debe ser un archivo de prueba COMPLETO y autocontenido (imports incluidos).`,
    `- Si un criterio NO se puede automatizar con la información dada (falta una API, una URL, datos), escribe el test con it.todo y un comentario explicando qué falta. NO inventes funciones, módulos ni endpoints que no conoces.`,
    `- "summary": en español y en lenguaje de negocio (no técnico), describe en 1-2 frases QUÉ valida esa prueba.`,
    ``,
    `Criterios de aceptación:`,
    criteria,
    ``,
    `Responde EXCLUSIVAMENTE con un JSON válido de esta forma (sin texto antes ni después, sin markdown):`,
    `{"tests":[{"acIndex":1,"code":"...código del test...","summary":"...qué valida, en español..."}]}`,
  ].join("\n");
}

// ── Generador combinado: IA con fallback a esqueleto ─────────────────────────

/**
 * Genera los TC de una HU. Intenta la IA (proveedor configurado); si no hay key, el stack no
 * es soportado, o la IA falla, cae al esqueleto determinista de Fase A (nunca rompe).
 * Cada TC lleva `source: "ai" | "skeleton"` para distinguirlo en la revisión.
 */
export async function generateForRequirement(args: any): Promise<any[]> {
  const { generateTestsForRequirement } = await importKit("runtime/generate/skeleton-generator.mjs");
  const base: any[] = generateTestsForRequirement(args);
  const ai = resolveAi();
  if (ai.provider === "none" || !ai.apiKey) return base.map((t) => ({ ...t, source: "skeleton" }));

  const supported = base.filter((t) => t.supported);
  if (!supported.length) return base.map((t) => ({ ...t, source: "skeleton" }));
  const framework = supported[0].framework || "vitest";

  try {
    const out = await callLLM(ai, buildPrompt(args.requirement, supported, framework));
    const tests: any[] = Array.isArray(out?.tests) ? out.tests : [];
    return base.map((t) => {
      const got = tests.find((x) => Number(x.acIndex) === t.acIndex);
      if (t.supported && got && typeof got.code === "string" && got.code.trim()) {
        return { ...t, code: got.code, summary: got.summary || t.summary, source: "ai" };
      }
      return { ...t, source: "skeleton" };
    });
  } catch (e: any) {
    return base.map((t) => ({ ...t, source: "skeleton", aiError: e?.message ?? String(e) }));
  }
}

/** Generador (async) compatible con `runQaCycle.generateTests`: IA con fallback a esqueleto. */
export function makeGenerator() {
  return (args: any) => generateForRequirement(args);
}

/** Prueba la conexión con el proveedor de IA configurado (llamada mínima). */
export async function testAi(): Promise<{ ok: boolean; provider: AiProvider; model: string; error?: string }> {
  const ai = resolveAi();
  if (ai.provider === "none" || !ai.apiKey) {
    return { ok: false, provider: ai.provider, model: ai.model, error: "No hay proveedor o API key de IA configurados." };
  }
  try {
    const out = await callLLM(ai, `Responde SOLO con este JSON exacto, sin texto adicional: {"tests":[{"acIndex":1,"code":"ok","summary":"prueba de conexión"}]}`);
    if (!out || !Array.isArray(out.tests)) throw new Error("respuesta inesperada del modelo");
    return { ok: true, provider: ai.provider, model: ai.model };
  } catch (e: any) {
    return { ok: false, provider: ai.provider, model: ai.model, error: e?.message ?? String(e) };
  }
}
