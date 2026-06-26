"use client";

import { useEffect, useState } from "react";

interface Me {
  user: { email: string };
  tenantId: string | null;
  role: string | null;
  tenants: { id: string; name: string; role: string }[];
}

// Pie del sidebar: usuario + tenant activo + cambio de tenant + logout. Lee /api/auth/me;
// si la sesión no es válida (401, p.ej. cookie vencida) manda a /login.
export function SessionBadge({ collapsed }: { collapsed: boolean }) {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return null;
        }
        const d = await r.json().catch(() => null);
        return d?.ok ? (d as Me) : null;
      })
      .then(setMe)
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  async function switchTenant(id: string) {
    await fetch("/api/auth/switch-tenant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: id }),
    }).catch(() => {});
    window.location.reload();
  }

  if (!me) return null;
  const initial = (me.user.email[0] || "?").toUpperCase();
  const active = me.tenants.find((t) => t.id === me.tenantId);

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
      {me.tenants.length > 1 ? (
        <select
          className="input py-1 text-xs"
          value={me.tenantId ?? ""}
          onChange={(e) => switchTenant(e.target.value)}
        >
          {me.tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} · {t.role}
            </option>
          ))}
        </select>
      ) : (
        active && (
          <p className="px-1 text-[11px] text-muted truncate">
            {active.name} · {active.role}
          </p>
        )
      )}
      <button onClick={logout} className="btn-ghost w-full py-1 text-xs">
        Cerrar sesión
      </button>
    </div>
  );
}
