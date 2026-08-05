import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { saveFile, listFiles, deleteFile } from "@/lib/qa/regressionFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Archivos de PRUEBA para el paso «subir archivo» (documentos obligatorios). Por tenant, en disco.
// GET → lista los nombres ya subidos. POST (multipart, campo «file») → guarda uno y devuelve su
// nombre. DELETE ?name= → elimina uno. Todo bajo withTenantScope (aislado por tenant).

// GET /api/regression/files → { files: [nombre…] }
export async function GET() {
  return withTenantScope(async (auth) => NextResponse.json({ ok: true, files: listFiles(auth.tenantId) }));
}

// POST /api/regression/files (multipart/form-data, campo «file») → { ok, name }
export async function POST(req: Request) {
  return withTenantScope(async (auth) => {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ ok: false, error: "Se esperaba un formulario con un archivo." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File) || !file.name) return NextResponse.json({ ok: false, error: "Falta el archivo («file»)." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const res = saveFile(auth.tenantId, file.name, bytes);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    return NextResponse.json({ ok: true, name: res.name });
  });
}

// DELETE /api/regression/files?name=<archivo> → elimina un archivo de prueba.
export async function DELETE(req: Request) {
  const name = new URL(req.url).searchParams.get("name")?.trim() || "";
  if (!name) return NextResponse.json({ ok: false, error: "Falta «name»." }, { status: 400 });
  return withTenantScope(async (auth) => {
    deleteFile(auth.tenantId, name);
    return NextResponse.json({ ok: true });
  });
}
