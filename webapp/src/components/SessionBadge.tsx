"use client";

import { useEffect, useState } from "react";

interface Me {
  user: { email: string };
  tenantId: string | null;
  role: string | null;
  tenants: { id: string; name: string; role: string }[];
}

// Pie del sidebar: usuario + PROYECTO activo + acceso a «Proyectos» (crear/cambiar/gestionar) + logout.
// Lee /api/auth/me; si la sesión no es válida (401, p.ej. cookie vencida) limpia la cookie y va a /login.
export function SessionBadge({ collapsed }: { collapsed: boolean }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then(async (r) => {
        if (r.status === 401) {
          // Cookie de sesión HUÉRFANA (presente en el navegador pero inválida en BD): hay que
          // LIMPIARLA antes de ir a /login. Si no, el middleware —que solo mira si la cookie
          // existe, no puede validar en Edge— rebota /login→/ y se arma un ciclo de recargas
          // full-page ("se queda cargando") en cualquier módulo, porque este badge es global.
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
          window.location.href = "/login";
          return null;
        }
        const d = await r.json().catch(() => null);
        return d?.ok ? (d as Me) : null;
      })
      .then((m) => {
        if (alive) setMe(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  if (!me) return null;
  const initial = (me.user.email[0] || "?").toUpperCase();

  if (collapsed) {
    return (
      <button
        onClick={logout}
        title={`${me.user.email} · cerrar sesión`}
        className="mx-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-accent text-sm font-semibold hover:bg-accent/30"
      >
        {initial}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent text-sm font-semibold">
          {initial}
        </span>
        <span className="flex-1 min-w-0 truncate text-xs text-gray-300" title={me.user.email}>
          {me.user.email}
        </span>
      </div>
      <button onClick={logout} className="btn-ghost w-full py-1 text-xs">
        Cerrar sesión
      </button>
    </div>
  );
}
