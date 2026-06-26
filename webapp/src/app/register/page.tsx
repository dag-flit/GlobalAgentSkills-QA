"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthCard } from "@/components/AuthCard";

export default function RegisterPage() {
  const [tenantName, setTenantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantName, email, password }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.error || "No se pudo crear la organización.");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Error de red.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Crear organización"
      subtitle="Tu cuenta será la propietaria (owner) de la organización."
      footer={
        <>
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Iniciar sesión
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Nombre de la organización</label>
          <input
            className="input"
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Contraseña (mín. 8)</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn-primary w-full" type="submit" disabled={busy}>
          {busy ? "Creando…" : "Crear organización"}
        </button>
      </form>
    </AuthCard>
  );
}
