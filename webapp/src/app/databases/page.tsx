import { DbConnections } from "@/components/DbConnections";

export default function DatabasesPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Bases de datos</h1>
        <p className="text-sm text-muted mt-1">
          Configura tus conexiones (estilo pgAdmin). Al ejecutar el ciclo QA, la capa de
          pruebas de base de datos usará la conexión que marques como <b>default</b> (o la que
          elijas en la corrida). Pruébala aquí antes de correr.
        </p>
      </div>
      <DbConnections />
    </div>
  );
}
