import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liveness check: confirma SOLO que el proceso está vivo y responde. No toca la BD ni
// pide auth (público, exento en el middleware) → nunca da falso negativo por una BD lenta.
// El proxy/monitor lo consulta. Una prueba de "readiness" (BD conectable) sería una ruta
// aparte si se necesita; a propósito NO se mezcla aquí.
export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      status: "ok",
      service: "qa-kit-studio",
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
