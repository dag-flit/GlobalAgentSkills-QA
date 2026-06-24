// tracker-adapter.mjs — contrato ÚNICO que toda implementación de tracker cumple.
// El orquestador y las skills hablan SOLO con esta interfaz, nunca con un tracker concreto.
// Ver CONTRACT.md para la especificación completa y capabilities().

/**
 * @typedef {Object} Capabilities
 * @property {boolean} attachments    soporta adjuntar binarios (png/webm)
 * @property {boolean} custom_fields  soporta campos custom (TestStartDate, ReTest, …)
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
 * @property {string} layer          static | unit | api | e2e | db | security | regression
 * @property {string} [tc_id]
 * @property {"pass"|"fail"|"skip"} status
 * @property {string[]} [files]      rutas locales de png/webm
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

  /** Nombre lógico del tracker (local | azure-devops | github | jira). */
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

  /** @param {string} ref @returns {Promise<string[]>} criterios de aceptación */
  async resolveRequirements(ref) {
    throw new Error("resolveRequirements() no implementado");
  }

  /**
   * Lista los hijos jerárquicos de un work item (p.ej. las HUs de un Feature).
   * Trackers sin jerarquía nativa devuelven []. No requiere red en `local`.
   * @param {string} id  id del work item padre (Feature/Epic)
   * @returns {Promise<Array<{id: string, title?: string, state?: string, type?: string}>>}
   */
  async listChildren(id) {
    return [];
  }

  /** Entrega la evidencia normalizada al destino del tracker (o al sink local). */
  async publishEvidence(target, payload) {
    throw new Error("publishEvidence() no implementado");
  }

  /** @param {object} defect @returns {Promise<string>} id del defecto creado */
  async createDefect(defect) {
    throw new Error("createDefect() no implementado");
  }

  /** Actualiza campos de ciclo (TestStartDate, ReTest, Testing…). */
  async updateCycle(id, fields) {
    throw new Error("updateCycle() no implementado");
  }

  /** Cierra un artefacto (Task-TC, Bug). Nunca el requisito padre. */
  async closeArtifact(id, result) {
    throw new Error("closeArtifact() no implementado");
  }

  /**
   * Reactiva el requisito (HU) que tiene una novedad y deja la TRAZABILIDAD del
   * defecto en un comentario de la misma HU. A diferencia de closeArtifact (que cierra
   * Task/Bug y nunca toca el padre), este método SÍ opera sobre el requisito padre,
   * pero solo lo REACTIVA al estado de novedad del perfil — nunca lo cierra.
   * @param {string} id  id del requisito (HU) con la novedad
   * @param {{bugId?: string|null, items?: EvidenceObject[], reason?: string}} info
   * @returns {Promise<{ok: boolean, id: string, state?: string, commentOk?: boolean}>}
   */
  async reactivateRequirement(id, info) {
    throw new Error("reactivateRequirement() no implementado");
  }
}

export default TrackerAdapter;
