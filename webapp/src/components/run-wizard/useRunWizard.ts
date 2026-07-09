"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/ActionFeedback";
import type { TrackerName } from "@/lib/types";
import { buildSteps, type Mode, type CodeLayer } from "./types";
import { type FlowStep, type OpId, type DeclaredAc, OP_BY_ID, stepFilled, cleanStep } from "./steps-catalog";

// Estado + lógica del asistente de ejecución. El kit quedó acotado al modo "Explorar una URL"
// (pruebas E2E sobre una app viva): este hook concentra lo mutable y la acción de lanzar.
export function useRunWizard() {
  const router = useRouter();
  const action = useAction();
  const [mode, setMode] = useState<Mode | null>(null);
  const [idx, setIdx] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const [tracker, setTracker] = useState<TrackerName>("local");
  const [appUrl, setAppUrl] = useState("");
  const [workItem, setWorkItem] = useState(""); // WI destino (HU/Feature/Task) — solo Azure
  const [flow, setFlow] = useState<FlowStep[]>([]); // guion de pasos (opcional)
  const [vars, setVars] = useState<Record<string, string>>({}); // credenciales del guion (${VAR})
  const [acs, setAcs] = useState<DeclaredAc[]>([]); // AC declarados de la HU (los trae AcPanel)

  // Modo "QA del código": ruta del repo (relativa a CODE_QA_BASE_DIR) + capas a correr (vacío = detectadas).
  const [sourcePath, setSourcePath] = useState("");
  const [layers, setLayers] = useState<CodeLayer[]>([]);

  const steps = mode ? buildSteps(mode) : [];
  const safeIdx = Math.min(idx, Math.max(0, steps.length - 1));
  const key = steps[safeIdx]?.key;

  function back() {
    if (idx > 0) setIdx(idx - 1);
    else {
      setMode(null);
      setIdx(0);
    }
  }
  const next = () => setIdx((i) => i + 1);
  function chooseMode(m: Mode) {
    setMode(m);
    setIdx(0);
  }

  async function launch() {
    // Un solo clic: si ya se está lanzando, ignora el clic (evita disparar una 2ª corrida mientras
    // la 1ª navega — en dev la página /runs/[id] compila la 1ª vez y puede tardar minutos).
    if (!mode || launching) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const id = await action
        .run(
          { loading: "Iniciando el ciclo QA…", success: "Ciclo QA iniciado — abriendo la corrida", autoCloseMs: 1500 },
          async () => {
            // Modo "QA del código": ruta del repo + capas (subconjunto o detectadas). Sin URL/pasos.
            let body: Record<string, unknown>;
            if (mode === "code") {
              body = {
                mode,
                sourcePath: sourcePath.trim(),
                workItemId: workItem.trim() ? workItem.trim() : undefined,
                layers: layers.length ? layers : undefined,
              };
            } else {
              // Si hay pasos, se corre un GUION: la URL es el primer paso (ir_a) y luego los pasos
              // del constructor. Sin pasos → URL-smoke (comportamiento anterior). Los pasos vacíos
              // se descartan; las credenciales vacías no se envían.
              const filled = flow.filter(stepFilled);
              const appTrim = appUrl.trim();
              const steps = filled.length
                ? [{ op: "ir_a", url: appTrim }, ...filled.map(cleanStep)]
                : undefined;
              const varsClean = Object.fromEntries(
                Object.entries(vars).filter(([, v]) => v && v.trim() !== ""),
              );
              // AC declarados (títulos) → el backend arma la matriz de cobertura (detecta "sin cubrir").
              const declaredAcs = acs.map((a) => a.title).filter((t) => t && t.trim() !== "");
              body = {
                mode,
                appUrl: appTrim ? appTrim : undefined,
                workItemId: workItem.trim() ? workItem.trim() : undefined,
                steps,
                vars: Object.keys(varsClean).length ? varsClean : undefined,
                declaredAcs: declaredAcs.length ? declaredAcs : undefined,
              };
            }
            let res: any;
            try {
              const r = await fetch("/api/runs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              res = await r.json();
              if (!r.ok || !res.id) throw new Error(res.error || "No se pudo iniciar la corrida.");
            } catch (e: any) {
              const message = e?.message ?? "Error de red";
              setLaunchError(message);
              throw new Error(message);
            }
            return res.id as string;
          },
        );
      // Éxito: navego y DEJO `launching` en true a propósito → el botón queda deshabilitado hasta
      // que la navegación complete (en dev la 1ª compilación de /runs/[id] tarda). Así el usuario no
      // puede disparar una 2ª corrida con un segundo clic. Solo se re-habilita si hubo error.
      router.push(`/runs/${id}`);
    } catch {
      /* el error ya se mostró en la modal y en launchError */
      setLaunching(false);
    }
  }

  // Guarda el guion (URL inicial + pasos) EN la HU destino, para reusarlo y para el fan-out de
  // Feature. El guion queda auto-contenido: el `ir_a` de la URL es el primer paso. Sin credenciales.
  async function saveFlowToHu() {
    const wid = workItem.trim();
    if (!wid) return;
    const filled = flow.filter(stepFilled).map(cleanStep);
    const steps = appUrl.trim() ? [{ op: "ir_a", url: appUrl.trim() }, ...filled] : filled;
    await action
      .run({ loading: "Guardando guion en la HU…", success: "Guion guardado en la HU" }, async () => {
        const r = await fetch("/api/flows", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wid, steps }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "No se pudo guardar el guion");
      })
      .catch(() => {});
  }

  // Carga el guion guardado de la HU: separa el `ir_a` inicial → URL y el resto → pasos.
  async function loadFlowFromHu() {
    const wid = workItem.trim();
    if (!wid) return;
    await action
      .run({ loading: "Cargando guion de la HU…", success: "Guion cargado" }, async () => {
        const r = await fetch(`/api/flows?wid=${encodeURIComponent(wid)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "No se pudo cargar el guion");
        const loaded = (Array.isArray(j.steps) ? j.steps : []) as FlowStep[];
        if (loaded[0]?.op === "ir_a" && loaded[0].url) {
          setAppUrl(String(loaded[0].url));
          setFlow(loaded.slice(1));
        } else {
          setFlow(loaded);
        }
      })
      .catch(() => {});
  }

  // Importa un guion pegado como JSON (lo que produce un análisis externo/Claude). Acepta una
  // lista de pasos o { steps: [...] }. Separa el `ir_a` inicial → URL, igual que loadFlowFromHu.
  // Valida que cada paso tenga un `op` conocido del catálogo; nunca ejecuta el texto. Devuelve
  // un mensaje de error o null si cargó. NO importa credenciales (${VAR} viajan como referencia).
  function importFlowJson(text: string): string | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return "El JSON no es válido. Pegá una lista de pasos entre corchetes [ … ].";
    }
    const raw = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as any)?.steps)
        ? (parsed as any).steps
        : null;
    if (!raw) return "Se esperaba una lista de pasos (o un objeto { steps: [...] }).";
    const list = raw.filter((s: any) => s && typeof s.op === "string") as FlowStep[];
    if (!list.length) return "La lista no tiene pasos válidos (cada paso necesita \"op\").";
    const unknown = list.find((s) => !OP_BY_ID[s.op as OpId]);
    if (unknown) return `Operación desconocida: "${unknown.op}". Revisá el guion.`;
    if (list[0].op === "ir_a" && list[0].url) {
      setAppUrl(String(list[0].url));
      setFlow(list.slice(1));
    } else {
      setFlow(list);
    }
    return null;
  }

  // Exporta el guion armado (URL inicial + pasos) como JSON legible, para copiar/compartir.
  function exportFlowJson(): string {
    const filled = flow.filter(stepFilled).map(cleanStep);
    const list = appUrl.trim() ? [{ op: "ir_a", url: appUrl.trim() }, ...filled] : filled;
    return JSON.stringify(list, null, 2);
  }

  return {
    mode, setMode, idx, launching, launchError,
    tracker, setTracker, appUrl, setAppUrl,
    workItem, setWorkItem, flow, setFlow, vars, setVars, acs, setAcs,
    sourcePath, setSourcePath, layers, setLayers,
    steps, safeIdx, key, back, next, chooseMode, launch,
    saveFlowToHu, loadFlowFromHu, importFlowJson, exportFlowJson,
  };
}

export type RunWizardCtl = ReturnType<typeof useRunWizard>;
