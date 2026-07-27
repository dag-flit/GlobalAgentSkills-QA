// report.mjs — reporte AUTOCONTENIDO de una corrida de regresión: HTML con las capturas por paso
// embebidas como data-URI + una REPRODUCCIÓN paso a paso (slideshow) construida con esas mismas
// capturas. Se dejó de grabar video: en headless salía en blanco de forma intermitente (el compositor
// no pinta el dashboard post-login); las capturas por paso SIEMPRE funcionan, así que la reproducción
// se arma con ellas → nunca sale en blanco, es autocontenida y muestra exactamente qué se hizo.
// Puro salvo la LECTURA de archivos, que llega INYECTADA (`reader`) → offline-testable.

import fs from "node:fs";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function dataUri(reader, file) {
  if (!file) return "";
  try {
    const buf = reader(file);
    if (!buf || !buf.length) return "";
    const mime = /\.jpe?g$/i.test(file) ? "image/jpeg" : "image/png";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return ""; // best-effort: un archivo ilegible no rompe el reporte
  }
}

function stepRow(c) {
  const ok = c.status === "pass";
  return `<div class="step ${ok ? "ok" : "bad"}" data-cap="${esc(c.name)}"><div class="sl"><b>${ok ? "✓" : "✗"}</b> ${esc(c.name)}${c.message ? ` <span class="msg">— ${esc(c.message)}</span>` : ""}</div>${c.shot ? `<img loading="lazy" src="${c.shot}" alt="captura del paso"/>` : ""}</div>`;
}

function testCard(t, reader) {
  const ok = t.status === "pass";
  const cases = (t.cases || []).map((c) => ({ ...c, shot: dataUri(reader, c.file) }));
  const warns = (t.warnings || []).map((w) => `<p class="warn">⚠ ${esc(w)}</p>`).join("");
  const steps = cases.map((c) => stepRow(c)).join("");
  const hasShots = cases.some((c) => c.shot);
  const player = hasShots
    ? `<div class="player"><div class="film-wrap"><img class="film" alt="reproducción del paso"/></div><div class="cap"></div><div class="ctrls"><button data-a="first" title="Volver al primer paso">⏮</button><button data-a="prev" title="Paso anterior">◀</button><button data-a="play">▶ Reproducir</button><button data-a="next" title="Paso siguiente">⏭</button><span class="pos"></span></div></div>`
    : `<p class="novideo">(sin capturas para reproducir)</p>`;
  return `<section class="test ${ok ? "ok" : "bad"}"><h3>${ok ? "✓" : "✗"} ${esc(t.name)}</h3>${warns}${player}<div class="steps">${steps}</div></section>`;
}

// Script (inline, sin dependencias) que anima cada reproductor: toma las capturas ya embebidas en su
// prueba (no duplica el base64) y las recorre con controles primero/anterior/reproducir/siguiente.
const PLAYER_JS = `<script>
(function(){
  document.querySelectorAll('.player').forEach(function(p){
    var sec=p.closest('.test'); if(!sec) return;
    var frames=[];
    sec.querySelectorAll('.steps .step').forEach(function(s){
      var im=s.querySelector('img');
      if(im) frames.push({src:im.getAttribute('src'),cap:s.getAttribute('data-cap')||''});
    });
    if(!frames.length) return;
    var film=p.querySelector('.film'),cap=p.querySelector('.cap'),pos=p.querySelector('.pos');
    var playBtn=p.querySelector('[data-a=play]'),i=0,timer=null;
    function show(k){i=(k+frames.length)%frames.length;film.src=frames[i].src;cap.textContent=frames[i].cap;pos.textContent=(i+1)+'/'+frames.length;}
    function stop(){if(timer){clearInterval(timer);timer=null;}playBtn.textContent='▶ Reproducir';}
    function play(){if(timer){stop();return;}playBtn.textContent='⏸ Pausar';timer=setInterval(function(){show(i+1);},1200);}
    p.querySelector('[data-a=first]').onclick=function(){stop();show(0);};
    p.querySelector('[data-a=prev]').onclick=function(){stop();show(i-1);};
    p.querySelector('[data-a=next]').onclick=function(){stop();show(i+1);};
    playBtn.onclick=play;
    show(0);
  });
})();
</script>`;

/**
 * @param {object} o
 * @param {string} o.system  nombre del sistema
 * @param {string} o.suite   nombre de la suite
 * @param {Array<{name:string,status:string,warnings?:string[],cases?:Array}>} o.tests
 * @param {string} [o.stamp] marca de tiempo legible
 * @param {(file:string)=>Buffer} [o.reader] lector de archivos (inyectable → offline-testable)
 * @returns {string} HTML autocontenido
 */
export function buildRegressionReport({ system = "", suite = "", tests = [], stamp = "", reader = (f) => fs.readFileSync(f) } = {}) {
  const passed = tests.filter((t) => t.status === "pass").length;
  const allOk = tests.length > 0 && passed === tests.length;
  const verdict = allOk ? `✓ Todo verde (${passed}/${tests.length})` : `✗ ${tests.length - passed} en rojo · ${passed}/${tests.length} OK`;
  const cards = tests.map((t) => testCard(t, reader)).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Regresión — ${esc(suite)}</title><style>
    body{font-family:system-ui,'Segoe UI',Arial,sans-serif;margin:0;padding:16px;background:#0b0e14;color:#e6e6e6}
    h1{font-size:18px;margin:0 0 4px}.meta{color:#9aa4b2;font-size:12px;margin-bottom:12px}
    .verdict{display:inline-block;padding:5px 12px;border-radius:8px;font-weight:600;margin-bottom:14px;color:#fff}
    .test{border:1px solid #22304a;border-radius:10px;padding:12px;margin-bottom:12px;background:#111722}
    .test.bad{border-color:#7f1d1d}.test.ok{border-color:#14532d}.test h3{margin:0 0 8px;font-size:14px}
    .player{border:1px solid #22304a;border-radius:10px;background:#0d1420;padding:10px;margin:8px 0}
    .film-wrap{background:#000;border-radius:8px;overflow:hidden;text-align:center}
    .film{max-width:100%;max-height:60vh;display:block;margin:0 auto;background:#000}
    .cap{font-size:12px;color:#cdd6e4;padding:6px 2px}
    .ctrls{display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap}
    .ctrls button{background:#1b2740;color:#e6e6e6;border:1px solid #33415c;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}
    .ctrls button:hover{background:#243352}.pos{font-size:12px;color:#9aa4b2;margin-left:4px}
    .novideo{color:#667;font-size:11px;margin:2px 0}
    .step{border-left:3px solid #33415c;padding:4px 8px;margin:6px 0}
    .step.bad{border-color:#ef4444}.step.ok{border-color:#22c55e}
    .step img{display:block;max-width:520px;width:100%;border:1px solid #22304a;border-radius:6px;margin-top:6px}
    .sl{font-size:12px}.msg{color:#f88}.warn{color:#fbbf24;font-size:12px;margin:2px 0}
  </style></head><body><h1>Regresión — ${esc(suite)}</h1><div class="meta">Sistema: ${esc(system)}${stamp ? ` · ${esc(stamp)}` : ""}</div><div class="verdict" style="background:${allOk ? "#14532d" : "#7f1d1d"}">${esc(verdict)}</div>${cards}${PLAYER_JS}</body></html>`;
}

export default { buildRegressionReport };
