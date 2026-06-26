"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "@/components/ActionFeedback";
import type { WorkItemLite } from "@/components/FeatureStep";
import type { TrackerName } from "@/lib/types";
import { LAYER_ORDER, buildSteps, type Detection, type Mode } from "./types";

// Estado + lógica del asistente de ejecución. El JSX vive en RunWizard y sus pasos; este
// hook concentra todo lo mutable y las acciones (detectar, lanzar) para mantener los
// componentes de presentación delgados. Comportamiento idéntico al original.
export function useRunWizard() {
  const router = useRouter();
  const action = useAction();
  const [mode, setMode] = useState<Mode | null>(null);
  const [idx, setIdx] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const [tracker, setTracker] = useState<TrackerName>("local");
  const [featureId, setFeatureId] = useState("");
  const [hus, setHus] = useState<WorkItemLite[]>([]);
  const [approvedTcKeys, setApprovedTcKeys] = useState<string[]>([]);
  const [templateCases, setTemplateCases] = useState<
    { template: string; params: Record<string, string>; huId: string }[]
  >([]);
  const [generate, setGenerate] = useState(false);

  const [sourceKind, setSourceKind] = useState<"git" | "local">("local");
  const [gitUrl, setGitUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [localPath, setLocalPath] = useState("");

  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [layerOn, setLayerOn] = useState<Record<string, boolean>>({});

  const [appUrl, setAppUrl] = useState("");

  const steps = mode ? buildSteps(mode, tracker, !!layerOn.e2e) : [];
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

  async function runDetect(): Promise<boolean> {
    setDetecting(true);
    setDetectError(null);
    try {
      await action.run(
        {
          loading: sourceKind === "git" ? "Clonando y detectando el proyecto…" : "Detectando capas del proyecto…",
          success: (m) => String(m),
        },
        async () => {
          const body = sourceKind === "git" ? { kind: "git", gitUrl, branch } : { kind: "local", localPath };
          let res: any;
          try {
            const r = await fetch("/api/detect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            res = await r.json();
          } catch (e: any) {
            const message = e?.message ?? "Error de red";
            setDetectError(message);
            throw new Error(message);
          }
          if (!res.ok) {
            const message = res.error || "No se pudo detectar el proyecto.";
            setDetectError(message);
            throw new Error(message);
          }
          const det: Detection = res.detection;
          setRepoRoot(res.repoRoot);
          setDetection(det);
          const on: Record<string, boolean> = {};
          for (const l of LAYER_ORDER) on[l] = det.enabled.includes(l);
          setLayerOn(on);
          return `Detección lista · ${det.enabled.length} capa(s) disponible(s)`;
        },
      );
      return true;
    } catch {
      return false;
    } finally {
      setDetecting(false);
    }
  }

  const canDetect = sourceKind === "git" ? gitUrl.trim().length > 0 : localPath.trim().length > 0;

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
              repoRoot: mode === "code" ? repoRoot || undefined : undefined,
              layers: mode === "code" ? LAYER_ORDER.filter((l) => layerOn[l]) : [],
              appUrl: appUrl.trim() ? appUrl.trim() : undefined,
              featureId: mode === "code" && featureId.trim() ? featureId.trim() : undefined,
              huIds: mode === "code" && hus.length ? hus.map((h) => h.id) : undefined,
              generate: mode === "code" && generate ? true : undefined,
              approvedTcKeys: mode === "code" && generate && approvedTcKeys.length ? approvedTcKeys : undefined,
              templateCases: mode === "code" && templateCases.length ? templateCases : undefined,
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
    tracker, setTracker, featureId, setFeatureId, hus, setHus,
    approvedTcKeys, setApprovedTcKeys, templateCases, setTemplateCases, generate, setGenerate,
    sourceKind, setSourceKind, gitUrl, setGitUrl, branch, setBranch, localPath, setLocalPath,
    detecting, detectError, repoRoot, detection, layerOn, setLayerOn, appUrl, setAppUrl,
    steps, safeIdx, key, back, next, chooseMode, runDetect, canDetect, launch,
  };
}

export type RunWizardCtl = ReturnType<typeof useRunWizard>;
