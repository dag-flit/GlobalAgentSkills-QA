// ado-teststeps.mjs — Parser PURO del campo `Microsoft.VSTS.TCM.Steps` de un Test Case de Azure Test
// Plans → [{action, expected}]. El campo es XML con <step> que contienen dos <parameterizedString>
// (acción y resultado esperado), cuyo contenido es HTML ESCAPADO (entidades). Se decodifica y se quita
// el HTML → texto plano. Sin dependencias (offline-testable). No inventa: un paso sin contenido se omite.

function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}
function stripHtml(s) {
  return decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function parseTestSteps(xml) {
  if (!xml || typeof xml !== "string") return [];
  const out = [];
  const stepRe = /<step\b[^>]*>([\s\S]*?)<\/step>/g;
  let m;
  while ((m = stepRe.exec(xml))) {
    const ps = [...m[1].matchAll(/<parameterizedString\b[^>]*>([\s\S]*?)<\/parameterizedString>/g)].map((x) => stripHtml(x[1]));
    const action = ps[0] || "";
    const expected = ps[1] || "";
    if (action || expected) out.push({ action, expected });
  }
  return out;
}

export default { parseTestSteps };
