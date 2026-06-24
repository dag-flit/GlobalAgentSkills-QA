import { NextResponse } from "next/server";
import { loadConfig, saveConfig, redactConfig, applySecretPreserving } from "@/lib/config";
import type { AppConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = loadConfig();
  return NextResponse.json(redactConfig(cfg));
}

export async function PUT(req: Request) {
  let incoming: AppConfig;
  try {
    incoming = (await req.json()) as AppConfig;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const current = loadConfig();
  const merged = applySecretPreserving(current, incoming);
  saveConfig(merged);
  return NextResponse.json(redactConfig(merged));
}
