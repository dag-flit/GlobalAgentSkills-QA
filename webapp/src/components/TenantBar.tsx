"use client";

import { useEffect, useState } from "react";
import { NotificationBell } from "./NotificationBell";

interface Me {
  ok?: boolean;
  user: { email: string };
  tenantId: string | null;
  role: string | null;
  tenants: { id: string; name: string; role: string }[];
}

// Barra superior: muestra de forma prominente el PROYECTO activo del usuario logueado, visible en
// todos los módulos. Lee /api/auth/me (misma fuente que SessionBadge, acotada por sesión → RLS). El
// cambio/creación de proyecto vive en el pie del sidebar; acá es informativo para que el usuario
// SIEMPRE sepa en qué proyecto está trabajando. Un proyecto es un espacio aislado (su propia config,
// regresión y Seguimiento); en FLIT hay varios (distintos productos), cada uno con RLS propio.
export function TenantBar() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => (r.ok ? r.json().catch(() => null) : null))
      .then((d) => setMe(d?.ok ? (d as Me) : null))
      .catch(() => {});
  }, []);

  const active = me?.tenants.find((t) => t.id === me.tenantId) ?? null;

  return (
    <header className="sticky top-0 z-10 h-14 border-b border-border bg-panel/70 backdrop-blur">
      <div className="h-full w-full max-w-[1400px] mx-auto px-6 flex items-center gap-3">
        <span className="min-w-0 truncate font-semibold text-white" title={active?.name}>
          {active ? active.name : me ? "Sin proyecto activo" : "Cargando…"}
        </span>
        <div className="ml-auto">
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
