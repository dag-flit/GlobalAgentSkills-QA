// tracker-adapter.mjs — contrato ÚNICO que toda implementación de tracker cumple.
// El orquestador y las skills hablan SOLO con esta interfaz, nunca con un tracker concreto.
// Kit acotado a EXPLORACIÓN de URL (E2E): el contrato es mínimo (preflight, capabilities,
// getWorkItem, publishEvidence). Ver CONTRACT.md.

/**
 * @typedef {Object} Capabilities
 * @property {boolean} attachments    soporta adjuntar binarios (png/webm)
 * @property {boolean} custom_fields  soporta campos custom
 * @property {boolean} comments       soporta comentarios/discussion
 * @property {boolean} states         soporta transiciones de estado de work items
 * @property {boolean} network        requiere red para operar
 */

/**
 * @typedef {Object} WorkItem
 * @property {string} id
 * @property {string} [title]
 * @property {string} [state]
 * @property {string[]} [acceptance_criteria]
 * @property {boolean} [stub]   true si es un placeholder local (no vino de un tracker real)
 */

/**
 * @typedef {Object} EvidenceObject
 * @property {string} layer          explore
 * @property {string} [tc_id]
 * @property {"pass"|"fail"|"skip"} status
 * @property {string[]} [files]      rutas locales de png/webm (capturas)
 * @property {string} [narrative]
 * @property {object} [metrics]
 * @property {string} [work_item_id]
 */

export class TrackerAdapter {
  /** @param {object} ctx  { profile, env, repoRoot } */
  constructor(ctx = {}) {
    this.ctx = ctx;
    this.profile = ctx.profile || {};
    this.env = ctx.env || {};
    this.repoRoot = ctx.repoRoot || process.cwd();
  }

  /** Nombre lógico del tracker (local | azure-devops). */
  get name() {
    return "abstract";
  }

  /** @returns {Promise<{ok: boolean, mode: string, detail?: string}>} */
  async preflight() {
    throw new Error("preflight() no implementado");
  }

  /** @returns {Capabilities} */
  capabilities() {
    throw new Error("capabilities() no implementado");
  }

  /** @param {string} id @returns {Promise<WorkItem|null>} */
  async getWorkItem(id) {
    throw new Error("getWorkItem() no implementado");
  }

  /** Entrega la evidencia normalizada al destino del tracker (o al sink local). */
  async publishEvidence(target, payload) {
    throw new Error("publishEvidence() no implementado");
  }
}

export default TrackerAdapter;
