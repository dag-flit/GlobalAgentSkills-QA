// azure-devops-adapter.mjs — STUB de F0. Implementa el contrato TrackerAdapter
// pero aún NO porta la lógica REST/MCP existente (eso es F2). Aquí solo:
//   - declara capabilities() de ADO
//   - preflight() verifica presencia de variables .env (sin llamar a la red todavía)
//   - los métodos de escritura lanzan "pendiente F2" para no fingir paridad.
// Sirve para que la factory ya pueda seleccionar este adapter y para fijar la forma.

import { TrackerAdapter } from "../../../core/tracker-adapter/tracker-adapter.mjs";

const REQUIRED = ["AZURE_ORG_URL", "AZURE_PROJECT_NAME", "AZURE_PAT", "USER_REAL_EMAIL"];

export class AzureDevOpsAdapter extends TrackerAdapter {
  get name() {
    return "azure-devops";
  }

  async preflight() {
    const missing = REQUIRED.filter((k) => !this.env[k]);
    if (missing.length) {
      return { ok: false, mode: "azure-devops", detail: `Faltan variables: ${missing.join(", ")}` };
    }
    // F2: ejecutar validate-qa-env (REST proyecto + adjuntos). Por ahora solo presencia.
    return { ok: true, mode: "azure-devops", detail: "Variables presentes (validación REST pendiente F2)." };
  }

  capabilities() {
    return { attachments: true, custom_fields: true, comments: true, states: true, network: true };
  }

  async getWorkItem(id) {
    throw new Error("azure-devops.getWorkItem: pendiente F2 (portar MCP/REST)");
  }
  async resolveRequirements(ref) {
    throw new Error("azure-devops.resolveRequirements: pendiente F2");
  }
  async publishEvidence(target, payload) {
    throw new Error("azure-devops.publishEvidence: pendiente F2 (política dual)");
  }
  async createDefect(defect) {
    throw new Error("azure-devops.createDefect: pendiente F2");
  }
  async updateCycle(id, fields) {
    throw new Error("azure-devops.updateCycle: pendiente F2");
  }
  async closeArtifact(id, result) {
    throw new Error("azure-devops.closeArtifact: pendiente F2");
  }
}

export default AzureDevOpsAdapter;
