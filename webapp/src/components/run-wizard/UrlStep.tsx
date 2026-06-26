import { Field } from "@/components/ui";
import type { RunWizardCtl } from "./useRunWizard";

/** Paso «URL»: baseURL para E2E (modo código) o URL viva a explorar (modo explore). */
export function UrlStep({ w }: { w: RunWizardCtl }) {
  return (
    <div className="space-y-4">
      <div className="card space-y-4 max-w-2xl">
        <div>
          <h2 className="font-semibold">URL de la app</h2>
          <p className="text-sm text-muted mt-1">
            {w.mode === "code"
              ? "Opcional: los E2E del repo se ejecutarán apuntando a esta URL (baseURL de la app corriendo). Puedes dejarla vacía si los tests ya traen su baseURL."
              : "Exploraré esta URL viva (smoke + capturas), sin necesitar el código."}
          </p>
        </div>
        <Field label="URL" hint="ej. https://qa.miapp.com">
          <input
            className="input font-mono"
            placeholder="https://qa.miapp.com"
            value={w.appUrl}
            onChange={(e) => w.setAppUrl(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={w.back}>
          ← Atrás
        </button>
        <button className="btn-primary" onClick={w.next} disabled={w.mode === "explore" && !w.appUrl.trim()}>
          Continuar →
        </button>
      </div>
    </div>
  );
}
