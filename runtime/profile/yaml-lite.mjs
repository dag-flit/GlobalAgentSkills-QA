// yaml-lite.mjs — cargador YAML mínimo y SIN dependencias para el subconjunto
// que usan los perfiles del kit: comentarios, mapas anidados por indentación,
// listas en bloque (- item), flow inline ([a, b] y {k: v}) y escalares
// (string, number, boolean, null). No soporta anchors, multiline ni tags.
// Suficiente para profiles/*.yaml; si se necesita YAML completo, sustituir por js-yaml.

function parseScalar(raw) {
  const s = raw.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  // flow list [a, b, c]
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    return splitFlow(inner).map(parseScalar);
  }
  // flow map {k: v, k2: v2}
  if (s.startsWith("{") && s.endsWith("}")) {
    const inner = s.slice(1, -1).trim();
    const obj = {};
    if (inner === "") return obj;
    for (const part of splitFlow(inner)) {
      const idx = part.indexOf(":");
      const k = part.slice(0, idx).trim().replace(/^["']|["']$/g, "");
      obj[k] = parseScalar(part.slice(idx + 1));
    }
    return obj;
  }
  // quoted string
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s; // bare string
}

// divide por comas respetando [] y {} anidados
function splitFlow(str) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of str) {
    if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

function stripComment(line) {
  // quita # de comentario salvo dentro de comillas
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === "#" && !inS && !inD && (i === 0 || line[i - 1] === " ")) {
      return line.slice(0, i);
    }
  }
  return line;
}

export function parseYaml(text) {
  const rawLines = text.split(/\r?\n/);
  const lines = [];
  for (const l of rawLines) {
    const noComment = stripComment(l);
    if (noComment.trim() === "") continue;
    const indent = noComment.length - noComment.trimStart().length;
    lines.push({ indent, content: noComment.trim() });
  }
  let pos = 0;

  function parseBlock(minIndent) {
    // decide si el bloque es lista o mapa por el primer elemento
    if (pos >= lines.length) return null;
    const first = lines[pos];
    if (first.indent < minIndent) return null;
    const isList = first.content.startsWith("- ") || first.content === "-";
    return isList ? parseList(first.indent) : parseMap(first.indent);
  }

  function parseMap(indent) {
    const obj = {};
    while (pos < lines.length && lines[pos].indent === indent && !lines[pos].content.startsWith("- ")) {
      const { content } = lines[pos];
      const idx = content.indexOf(":");
      const key = content.slice(0, idx).trim().replace(/^["']|["']$/g, "");
      const rest = content.slice(idx + 1).trim();
      pos++;
      if (rest === "") {
        // valor en bloque hijo (mapa o lista) con mayor indent
        if (pos < lines.length && lines[pos].indent > indent) {
          obj[key] = parseBlock(indent + 1);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    while (pos < lines.length && lines[pos].indent === indent && lines[pos].content.startsWith("- ")) {
      const item = lines[pos].content.slice(2).trim();
      pos++;
      arr.push(parseScalar(item));
    }
    return arr;
  }

  const result = parseBlock(0);
  return result === null ? {} : result;
}

export default { parseYaml };
