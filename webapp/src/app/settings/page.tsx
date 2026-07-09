import Link from "next/link";
import { TrackerStep } from "@/components/TrackerStep";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Ajustes</h1>
        <p className="text-sm text-muted mt-1">
          Configura aquí el destino de reportes (tracker) y sus credenciales. Las conexiones de
          base de datos se gestionan en{" "}
          <Link href="/databases" className="text-accent">
            Bases de datos
          </Link>
          . Todo se guarda localmente con los secretos enmascarados.
        </p>
      </div>

      {/* Editor de tracker (sin navegación de wizard: solo Probar + Guardar) */}
      <TrackerStep />

      <div className="card">
        <h2 className="font-semibold text-sm">Base de datos</h2>
        <p className="text-sm text-muted mt-1">
          El gestor de conexiones (estilo pgAdmin, con túnel SSH) vive en su propia sección.
        </p>
        <Link href="/databases" className="btn-ghost mt-3 w-fit">
          🗄️ Ir a Bases de datos
        </Link>
      </div>
    </div>
  );
}
