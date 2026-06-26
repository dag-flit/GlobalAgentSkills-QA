import type { DbConnectionsCtl } from "./useDbConnections";

/** Barra lateral: lista de conexiones guardadas + botón para añadir. */
export function ConnectionList({ c }: { c: DbConnectionsCtl }) {
  const cfg = c.cfg!;
  return (
    <aside className="card h-fit">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-sm">Conexiones</h2>
        <button className="btn-ghost text-xs px-2 py-1" onClick={c.addConnection}>
          + Añadir
        </button>
      </div>
      <ul className="space-y-1">
        {cfg.databases.length === 0 && (
          <li className="text-xs text-muted">Aún no hay conexiones. Añade una.</li>
        )}
        {cfg.databases.map((d) => (
          <li key={d.id}>
            <button
              onClick={() => {
                c.setSelectedId(d.id);
                c.setTest({ status: "idle" });
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                d.id === c.selectedId ? "bg-accent text-white" : "hover:bg-panel2 text-gray-200"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{d.name || "(sin nombre)"}</span>
                {d.isDefault && (
                  <span className="badge bg-green-900 text-green-300 text-[10px]">default</span>
                )}
              </div>
              <div className="text-[11px] opacity-70 truncate">
                {d.engine} · {d.host}:{d.port}/{d.database || "—"}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
