import { NextResponse } from "next/server";
import { loadConfig, getDbConnection, applySecretPreserving } from "@/lib/config";
import { testDbConnection } from "@/lib/db/dbClient";
import type { DbConnection } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Body: { id }            → prueba una conexión guardada
 *    o: { db: DbConnection } → prueba una conexión del formulario
 *       (si la contraseña llega enmascarada, se resuelve contra la guardada del mismo id)
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  let db: DbConnection | undefined;

  if (body.db) {
    const incoming: DbConnection = body.db;
    const current = loadConfig();
    const exists = current.databases.some((d) => d.id === incoming.id);
    if (exists) {
      const tmp = applySecretPreserving(current, {
        ...current,
        databases: [incoming],
      });
      db = tmp.databases[0];
    } else {
      db = incoming;
    }
  } else {
    db = getDbConnection(body.id);
  }

  if (!db) return NextResponse.json({ error: "Conexión no encontrada" }, { status: 404 });

  const result = await testDbConnection(db);
  return NextResponse.json(result);
}
