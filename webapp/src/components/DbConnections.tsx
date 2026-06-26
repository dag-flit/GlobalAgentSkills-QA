"use client";

import { Spinner } from "@/components/ui";
import { useDbConnections } from "@/components/db-connections/useDbConnections";
import { ConnectionList } from "@/components/db-connections/ConnectionList";
import { ConnectionEditor } from "@/components/db-connections/ConnectionEditor";

export function DbConnections() {
  const c = useDbConnections();

  if (!c.cfg) {
    return (
      <div className="flex items-center gap-2 text-muted">
        <Spinner /> Cargando conexiones…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <ConnectionList c={c} />
      <section className="card lg:col-span-2">
        {!c.selected ? (
          <p className="text-muted text-sm">Selecciona o añade una conexión.</p>
        ) : (
          <ConnectionEditor c={c} />
        )}
      </section>
    </div>
  );
}
