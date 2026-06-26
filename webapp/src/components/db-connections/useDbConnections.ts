"use client";

import { useEffect, useState } from "react";
import type { AppConfig, DbConnection, SshConfig } from "@/lib/types";
import { useAction } from "@/components/ActionFeedback";
import { defaultSsh, hintFor, newConnection, type TestState } from "./helpers";

// Estado + lógica del gestor de conexiones de BD. Carga la config, edita la conexión
// seleccionada, prueba y guarda. Comportamiento idéntico al componente original.
export function useDbConnections() {
  const action = useAction();
  const [cfg, setCfg] = useState<AppConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: AppConfig) => {
        setCfg(c);
        setSelectedId(c.databases.find((d) => d.isDefault)?.id ?? c.databases[0]?.id ?? null);
      })
      .catch(() =>
        setCfg({
          databases: [],
          tracker: {
            selected: "local",
            azure: { orgUrl: "", project: "", pat: "", userEmail: "" },
            github: { repository: "", token: "" },
            jira: { baseUrl: "", email: "", token: "", projectKey: "" },
          },
        }),
      );
  }, []);

  const selected = cfg?.databases.find((d) => d.id === selectedId) ?? null;

  function patchSelected(patch: Partial<DbConnection>) {
    if (!selected) return;
    setCfg((c) => ({
      ...c!,
      databases: c!.databases.map((d) => (d.id === selected.id ? { ...d, ...patch } : d)),
    }));
    setTest({ status: "idle" });
    setSavedMsg(null);
  }

  function patchSsh(patch: Partial<SshConfig>) {
    if (!selected) return;
    const base = selected.ssh ?? defaultSsh();
    patchSelected({ ssh: { ...base, ...patch } });
  }

  function addConnection() {
    const conn = newConnection();
    if (cfg!.databases.length === 0) conn.isDefault = true;
    setCfg((c) => ({ ...c!, databases: [...c!.databases, conn] }));
    setSelectedId(conn.id);
    setSavedMsg(null);
    action.notify("Conexión añadida — recuerda Guardar para conservarla");
  }

  function deleteSelected() {
    if (!selected) return;
    const name = selected.name || "(sin nombre)";
    const rest = cfg!.databases.filter((d) => d.id !== selected.id);
    if (selected.isDefault && rest.length) rest[0].isDefault = true;
    setCfg((c) => ({ ...c!, databases: rest }));
    setSelectedId(rest[0]?.id ?? null);
    setSavedMsg(null);
    action.notify(`Conexión «${name}» eliminada — recuerda Guardar`);
  }

  function makeDefault() {
    if (!selected) return;
    setCfg((c) => ({
      ...c!,
      databases: c!.databases.map((d) => ({ ...d, isDefault: d.id === selected.id })),
    }));
    setSavedMsg(null);
    action.notify(`«${selected.name || "(sin nombre)"}» marcada como default — recuerda Guardar`);
  }

  async function save() {
    setSaving(true);
    setSavedMsg(null);
    await action
      .run({ loading: "Guardando conexiones…", success: "Conexiones guardadas correctamente" }, async () => {
        const r = await fetch("/api/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(cfg),
        });
        if (!r.ok) throw new Error("No se pudo guardar la configuración");
        const updated: AppConfig = await r.json();
        setCfg(updated);
        setSavedMsg("Guardado ✓");
      })
      .catch(() => setSavedMsg("No se pudo guardar"))
      .finally(() => setSaving(false));
  }

  async function runTest() {
    if (!selected) return;
    setTest({ status: "testing" });
    await action
      .run({ loading: "Probando conexión a la base de datos…", success: (m) => String(m) }, async () => {
        let res: any;
        try {
          const r = await fetch("/api/db/test", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ db: selected }),
          });
          res = await r.json();
        } catch (e: any) {
          const message = e?.message ?? "Error de red";
          setTest({ status: "err", message });
          throw new Error(message);
        }
        if (res.ok) {
          const message = `${res.message} · ${res.serverVersion ?? ""}`.trim();
          setTest({ status: "ok", message, target: res.target });
          return `Conexión exitosa${res.serverVersion ? ` · ${res.serverVersion}` : ""}`;
        }
        const message = res.message || res.error || "Falló la conexión";
        setTest({ status: "err", message, hint: hintFor(message, res.target), target: res.target });
        throw new Error(hintFor(message, res.target) || message);
      })
      .catch(() => {});
  }

  return {
    cfg, selected, selectedId, setSelectedId, saving, savedMsg, test, setTest,
    patchSelected, patchSsh, addConnection, deleteSelected, makeDefault, save, runTest,
  };
}

export type DbConnectionsCtl = ReturnType<typeof useDbConnections>;
