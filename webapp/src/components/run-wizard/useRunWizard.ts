"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/ActionFeedback";
import type { TrackerName } from "@/lib/types";
import { buildSteps, type Mode } from "./types";

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

  const steps = mode ? buildSteps() : [];
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
    if (!mode) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      await action
        .run(
          { loading: "Iniciando el ciclo QA…", success: "Ciclo QA iniciado — abriendo la corrida" },
          async () => {
            const body = {
              mode,
              appUrl: appUrl.trim() ? appUrl.trim() : undefined,
            };
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
        )
        .then((id) => router.push(`/runs/${id}`));
    } catch {
      /* el error ya se mostró en la modal y en launchError */
    } finally {
      setLaunching(false);
    }
  }

  return {
    mode, setMode, idx, launching, launchError,
    tracker, setTracker, appUrl, setAppUrl,
    steps, safeIdx, key, back, next, chooseMode, launch,
  };
}

export type RunWizardCtl = ReturnType<typeof useRunWizard>;
