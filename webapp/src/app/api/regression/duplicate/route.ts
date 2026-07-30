import { NextResponse } from "next/server";
import { withTenantScope } from "@/lib/auth/route";
import { parseJson } from "@/lib/validation/parse";
import { regressionDuplicateSchema } from "@/lib/validation/schemas";
import { getTarget, saveTarget, saveCatalog } from "@/lib/db/regressionTargetsRepo";
import { listSuites, saveSuite } from "@/lib/db/regressionSuitesRepo";
import type { RegressionTarget } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function slugId(name: string): string {
  return (
    name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "sys"
  );
}

// POST /api/regression/duplicate → clona un sistema a OTRO AMBIENTE: crea un sistema nuevo con el
// MISMO catálogo de selectores y COPIA todas sus suites (pruebas), cambiando solo URL + credenciales.
// Así se reutilizan las pruebas en QA/PDN sin volver a escanear (los alias siguen resolviendo, porque
// el catálogo es el mismo). Si la UI del otro ambiente difiere, se puede re-escanear ese sistema luego.
export async function POST(req: Request) {
  const parsed = await parseJson(req, regressionDuplicateSchema, "plain");
  if (!parsed.ok) return parsed.response;
  const { sourceId, name, baseUrl, authMode, username, password } = parsed.data;
  return withTenantScope(async () => {
    const source = await getTarget(sourceId);
    if (!source) return NextResponse.json({ ok: false, error: `No existe el sistema origen «${sourceId}».` }, { status: 404 });

    const newId = slugId(name);
    if (newId === sourceId) {
      return NextResponse.json({ ok: false, error: "El nuevo sistema debe tener un nombre distinto al origen." }, { status: 400 });
    }
    if (await getTarget(newId)) {
      return NextResponse.json({ ok: false, error: `Ya existe un sistema «${newId}». Elegí otro nombre.` }, { status: 409 });
    }

    const newTarget: RegressionTarget = {
      id: newId,
      name,
      baseUrl,
      authMode,
      username: authMode === "login" ? username : "",
      password: authMode === "login" ? password : "",
      catalog: null,
      updatedAt: "",
    };
    await saveTarget(newTarget);
    // Copiar el catálogo (mismos selectores) y las suites (mismas pruebas).
    if (source.catalog?.pages?.length) await saveCatalog(newId, source.catalog);
    const suites = await listSuites(sourceId);
    for (const s of suites) await saveSuite({ ...s, targetId: newId });

    return NextResponse.json({ ok: true, id: newId, copiedSuites: suites.length, hasCatalog: !!source.catalog?.pages?.length });
  });
}
