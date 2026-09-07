"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { DeleteProjectModal } from "@/components/projects/DeleteProjectModal";

// Página «Proyectos»: hub para gestionar los proyectos (espacios aislados) del usuario. Crear, entrar
// (cambiar el activo), renombrar, marcar terminado / reactivar y eliminar (con confirmación tipeada).
// Las mutaciones exigen ser owner (validado en la API). Cada proyecto conserva su RLS.

interface Project { id: string; name: string; role: string; archived: boolean; active: boolean }
const ROLE_LABEL: Record<string, string> = { owner: "Propietario", admin: "Administrador", member: "Miembro", viewer: "Lector" };

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [deleting, setDeleting] = useState<Project | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/projects");
      if (!r.ok) throw new Error(`No se pudieron cargar los proyectos (HTTP ${r.status}).`);
      const j = await r.json();
      setProjects(j.projects ?? []);
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function call(method: string, body: unknown, okMsg?: () => void) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/projects", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ ok: false, error: "Respuesta inválida." }));
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo completar la acción.");
      okMsg?.(); return j;
    } catch (e: any) { setError(e?.message ?? "Error de red."); return null; }
    finally { setBusy(false); }
  }

  async function create() {
    const name = newName.trim(); if (!name) return;
    const j = await call("POST", { name });
    if (j) window.location.href = "/"; // el nuevo proyecto queda activo
  }
  async function enter(id: string) {
    setBusy(true); setError(null);
    await fetch("/api/auth/switch-tenant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: id }) }).catch(() => {});
    window.location.href = "/";
  }
  async function rename(id: string) {
    const name = renameText.trim(); if (!name) return;
    const j = await call("PATCH", { tenantId: id, action: "rename", name });
    if (j) { setRenaming(null); await load(); }
  }
  async function setArchived(id: string, archived: boolean) {
    const j = await call("PATCH", { tenantId: id, action: archived ? "archive" : "unarchive" });
    if (j) await load();
  }
  async function doDelete(confirmName: string) {
    if (!deleting) return;
    const j = await call("DELETE", { tenantId: deleting.id, confirmName });
    if (j) { setDeleting(null); if (deleting.active) { window.location.href = "/"; return; } await load(); }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-bold text-white">Proyectos</h1>
        <p className="mt-1 text-sm text-muted">
          Cada proyecto es un espacio aislado (su propia configuración, regresión y seguimiento). Entrá a uno para
          trabajar en él, o creá uno nuevo.
        </p>
      </header>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <section className="card">
        <h2 className="text-base font-semibold text-white">Nuevo proyecto</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre del proyecto"
            className="input flex-1 min-w-[14rem]" onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
          <button onClick={create} disabled={busy || !newName.trim()} className="btn-primary">Crear proyecto</button>
        </div>
      </section>

      {loading ? (
        <div className="pt-6"><Spinner /></div>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id} className="card flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                {renaming === p.id ? (
                  <div className="flex flex-wrap gap-2">
                    <input value={renameText} onChange={(e) => setRenameText(e.target.value)} className="input flex-1 min-w-[12rem]" autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") rename(p.id); }} />
                    <button onClick={() => rename(p.id)} disabled={busy} className="btn-primary text-xs">Guardar</button>
                    <button onClick={() => setRenaming(null)} className="btn-ghost text-xs">Cancelar</button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white truncate">{p.name}</span>
                    <span className="badge bg-panel2 text-muted">{ROLE_LABEL[p.role] ?? p.role}</span>
                    {p.active && <span className="badge bg-accent/15 text-accent">Activo</span>}
                    {p.archived && <span className="badge bg-warn/15 text-warn">Terminado</span>}
                  </div>
                )}
              </div>
              {renaming !== p.id && (
                <div className="flex flex-wrap items-center gap-2">
                  {!p.active && <button onClick={() => enter(p.id)} disabled={busy} className="btn-ghost text-xs">Entrar</button>}
                  {p.role === "owner" && <button onClick={() => { setRenaming(p.id); setRenameText(p.name); }} className="btn-ghost text-xs">Renombrar</button>}
                  {p.role === "owner" && (
                    <button onClick={() => setArchived(p.id, !p.archived)} disabled={busy} className="btn-ghost text-xs">
                      {p.archived ? "Reactivar" : "Marcar terminado"}
                    </button>
                  )}
                  {p.role === "owner" && <button onClick={() => setDeleting(p)} className="rounded-lg border border-border px-2 py-1 text-xs text-red-300 hover:bg-panel2">Eliminar</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {deleting && <DeleteProjectModal name={deleting.name} busy={busy} onConfirm={doDelete} onCancel={() => setDeleting(null)} />}
    </div>
  );
}
