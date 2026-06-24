import { RunsList } from "@/components/RunsList";

export default function RunsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-white">Historial</h1>
      <RunsList />
    </div>
  );
}
