"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";

// Panel de TOKENS de servicio del scheduler. El token se muestra EN CLARO una única vez (al crearlo);
// después solo se ve la etiqueta y cuándo se usó. El disparador externo (cron VPS / GitHub Actions)
// manda {tenantId, token} a POST /api/schedule/tick. El tenantId (estable) se muestra para configurarlo.

interface TokenRow { id: string; label: string; created_at: string; last_used_at: string | null }

export function TokenPanel({ tenantId }: { tenantId: string | null }) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null); // token recién creado (una sola vez)
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/schedule/tokens");
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudieron cargar los tokens.");
      setTokens(j.tokens ?? []);
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setBusy(true); setError(null); setFresh(null);
    try {
      const r = await fetch("/api/schedule/tokens", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo crear el token.");
      setFresh(j.token); setLabel(""); await load();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/schedule/tokens", {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "No se pudo revocar.");
      await load();
    } catch (e: any) { setError(e?.message ?? "Error de red."); }
    finally { setBusy(false); }
  }

  return (
    <section className="card">
      <h2 className="text-base font-semibold text-white">Token de servicio</h2>
      <p className="mt-1 text-sm text-muted">
        Lo usa el disparador externo (cron o GitHub Actions) para lanzar las corridas sin sesión. Se muestra
        una sola vez: copialo al crearlo. Revocable en cualquier momento.
      </p>

      {tenantId && (
        <div className="mt-3 rounded-lg bg-panel2 p-3 text-xs text-muted">
          <span className="font-medium">tenantId</span> (para el cron):{" "}
          <code className="select-all break-all text-gray-100">{tenantId}</code>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <input
          value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Etiqueta (ej: cron nocturno)"
          className="input flex-1"
        />
        <button onClick={create} disabled={busy} className="btn-primary shrink-0">
          Generar token
        </button>
      </div>

      {fresh && (
        <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3">
          <p className="text-xs font-medium text-warn">Copialo ahora — no se vuelve a mostrar:</p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 select-all break-all rounded bg-panel2 px-2 py-1 text-xs text-gray-100">{fresh}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(fresh)}
              className="rounded-lg border border-warn/40 px-2 py-1 text-xs text-warn hover:bg-warn/10"
            >
              Copiar
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      <div className="mt-4">
        {loading ? (
          <Spinner />
        ) : tokens.length === 0 ? (
          <p className="text-sm text-muted">Todavía no hay tokens.</p>
        ) : (
          <ul className="divide-y divide-border">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="font-medium text-gray-100">{t.label || "(sin etiqueta)"}</span>
                  <span className="ml-2 text-xs text-muted">
                    {t.last_used_at ? `usado ${new Date(t.last_used_at).toLocaleString()}` : "nunca usado"}
                  </span>
                </div>
                <button
                  onClick={() => revoke(t.id)} disabled={busy}
                  className="rounded-lg border border-border px-2 py-1 text-xs text-red-300 hover:bg-panel2 disabled:opacity-50"
                >
                  Revocar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
