import { NextResponse } from "next/server";
import type { ZodType } from "zod";

// Valida el body de una Request contra un esquema zod. Devuelve los datos tipados o una
// respuesta 400 lista con el detalle del error. `shape` adapta el cuerpo del error al estilo
// de cada ruta: "ok" → { ok:false, error }, "plain" → { error }.
export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

export async function parseJson<T>(
  req: Request,
  schema: ZodType<T>,
  shape: "ok" | "plain" = "plain",
): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: badRequest("JSON inválido", shape) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join("; ");
    return { ok: false, response: badRequest(`Datos inválidos — ${detail}`, shape) };
  }
  return { ok: true, data: parsed.data };
}

function badRequest(error: string, shape: "ok" | "plain"): NextResponse {
  const body = shape === "ok" ? { ok: false, error } : { error };
  return NextResponse.json(body, { status: 400 });
}
