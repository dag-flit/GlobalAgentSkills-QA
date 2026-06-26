type Coverage = {
  selectedHus: string[];
  showCoverage: boolean;
  coverageCount: Record<string, number>;
  totalCases: number;
  gaps: string[];
  extra: string[];
};

/** Cobertura de las HUs seleccionadas según las pruebas etiquetadas [HU-###]. */
export function CoverageCard({ cov }: { cov: Coverage }) {
  if (!cov.showCoverage) return null;
  return (
    <div className="card space-y-2">
      <h2 className="font-semibold text-sm">Cobertura de HUs seleccionadas</h2>
      {cov.totalCases === 0 ? (
        <p className="text-xs text-muted">
          No se detectaron casos individuales (la herramienta no expone reporte JSON), así que no se
          puede evaluar la cobertura por etiqueta <code>[HU-###]</code>.
        </p>
      ) : (
        <>
          <ul className="space-y-1 text-sm">
            {cov.selectedHus.map((id) => {
              const n = cov.coverageCount[id] || 0;
              return (
                <li key={id} className="flex items-center gap-2">
                  <span className={n > 0 ? "text-green-300" : "text-warn"}>{n > 0 ? "✓" : "⚠"}</span>
                  <span className="font-mono">#{id}</span>
                  <span className="text-muted text-xs">
                    {n > 0 ? `${n} prueba(s) etiquetada(s)` : `sin pruebas etiquetadas [HU-${id}]`}
                  </span>
                </li>
              );
            })}
          </ul>
          {cov.gaps.length > 0 && (
            <p className="text-xs text-warn">
              ⚠ {cov.gaps.length} HU(s) sin <b>pruebas asociadas a un criterio</b>. Cada HU igual recibió
              su comentario de ejecución y su TC (ver «Evidencia por HU»); esto solo indica que aún
              ninguna prueba está etiquetada <code>[HU-###]</code> para validar sus criterios individualmente.
            </p>
          )}
          {cov.extra.length > 0 && (
            <p className="text-xs text-muted">
              Pruebas que etiquetan HUs no seleccionadas: {cov.extra.map((h) => "#" + h).join(", ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
