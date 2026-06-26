import { Spinner } from "@/components/ui";
import type { TestState } from "./helpers";

/** Bloque con el resultado de «Probar conexión» (éxito/error/pista/objetivo). */
export function TestResult({ test }: { test: TestState }) {
  if (test.status === "idle") return null;
  return (
    <div
      className={`text-sm rounded-lg px-3 py-2 border ${
        test.status === "ok"
          ? "border-green-700 bg-green-900/30 text-green-300"
          : test.status === "err"
            ? "border-red-700 bg-red-900/30 text-red-300"
            : "border-border bg-panel2 text-muted"
      }`}
    >
      {test.status === "testing" ? (
        <span className="flex items-center gap-2">
          <Spinner /> Probando conexión…
        </span>
      ) : (
        <div className="space-y-1">
          <div>{test.message}</div>
          {test.target?.passwordHasEdgeSpaces && (
            <div className="text-xs text-warn">
              ⚠ La contraseña usada tiene espacios al inicio/final — probablemente sea un error de
              pegado. Reescríbela sin espacios.
            </div>
          )}
          {test.hint && <div className="text-xs opacity-90">💡 {test.hint}</div>}
          {test.target && (
            <div className="text-[11px] opacity-70 font-mono">
              Intento: {test.target.user}@{test.target.host}:{test.target.port}/
              {test.target.database || "—"} · SSL {test.target.ssl ? "on" : "off"} ·{" "}
              {test.target.hasPassword ? "con contraseña" : "SIN contraseña"}
              {test.target.viaSsh ? " · vía SSH" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
