/** Plan de Pruebas del Feature + evidencia por HU (TC y comentario por criterio). */
export function EvidenceSection({ testPlan, huEvidence }: { testPlan: any; huEvidence: any[] }) {
  return (
    <>
      {testPlan && (testPlan.planId || testPlan.error) && (
        <div className="card space-y-1">
          <h2 className="font-semibold text-sm">Plan de Pruebas del Feature</h2>
          {testPlan.planId ? (
            <p className="text-sm text-green-300">
              ✓ Task del plan <span className="font-mono">#{testPlan.planId}</span>{" "}
              <span className="text-muted text-xs">
                {testPlan.created ? "creada" : "actualizada"} bajo el Feature (objetivo + HUs/TC + alcance global).
              </span>
            </p>
          ) : (
            <p className="text-sm text-warn">⚠ No se pudo registrar el plan: {testPlan.error}</p>
          )}
        </div>
      )}

      {huEvidence.length > 0 && (
        <div className="card space-y-2">
          <h2 className="font-semibold text-sm">Evidencia por HU</h2>
          <p className="text-xs text-muted">
            Además del resumen en el Feature, cada HU seleccionada recibió su comentario de ejecución y su{" "}
            <b>TC</b> (Task creado/actualizado desde sus criterios de aceptación).
          </p>
          <ul className="space-y-1 text-sm">
            {huEvidence.map((h) => {
              const okAll = h.ok !== false && h.commentOk !== false && !h.error;
              return (
                <li key={h.work_item_id} className="flex flex-wrap items-center gap-2">
                  <span className={okAll ? "text-green-300" : "text-warn"}>{okAll ? "✓" : "⚠"}</span>
                  <span className="font-mono">HU #{h.work_item_id}</span>
                  <span className="text-muted text-xs">
                    {Array.isArray(h.tcs) && h.tcs.length ? (
                      <>
                        {h.tcs.filter((t: any) => t.tcId).length}/{h.tcs.length} TC por criterio
                      </>
                    ) : h.tcId ? (
                      <>
                        TC #{h.tcId} {h.tcCreated ? "creado" : "reusado"}
                      </>
                    ) : (
                      <>sin TC{h.tcError ? ` (${h.tcError})` : ""}</>
                    )}
                    {h.commentOk === false ? " · comentario falló" : h.commentId ? " · comentario publicado" : ""}
                    {h.error ? ` · ${h.error}` : ""}
                    {h.skipped ? ` · ${h.skipped}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
}
