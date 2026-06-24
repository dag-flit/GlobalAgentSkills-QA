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

  /**
   * Publica la evidencia de ejecución PARA UN REQUISITO (HU) concreto, ADEMÁS del resumen
   * que publishEvidence deja en el Feature paraguas. Hace dos cosas, idempotentes:
   *   1) asegura el TC del requisito (un work item hijo creado desde sus criterios de
   *      aceptación; el tipo lo decide el perfil — p.ej. `Task` si el proyecto no tiene
   *      el tipo "Test Case"), enlazado a la HU como padre;
   *   2) comenta en la HU el resultado de la corrida (resultado global + criterios + nota).
   * NO sustituye a publishEvidence: lo COMPLEMENTA por-HU. La ejecución generalizada y su
   * evidencia local quedan intactas. Trackers sin jerarquía nativa degradan a no-op (este
   * default) o a solo comentario en su override.
   * @param {string} requirementId  id de la HU
   * @param {{criteria?: string[], results?: EvidenceObject[], reportLink?: string|null,
   *          huTitle?: string}} info
   * @returns {Promise<{ok: boolean, requirementId: string, tcId?: string|null,
   *          tcCreated?: boolean, commentOk?: boolean, skipped?: string}>}
   */
  async publishRequirementEvidence(requirementId, info) {
    return { ok: true, requirementId: String(requirementId), tcId: null, skipped: "tracker sin jerarquía de TC" };
  }

  /**
   * Crea/actualiza el PLAN DE PRUEBAS del Feature (el papá mayor): un work item hijo del
   * Feature (p.ej. una Task "PLAN PRUEBAS FEATURE <nombre>") que AGREGA el entendimiento del
   * objetivo + el plan completo (sus HUs, los criterios y sus TC, y el alcance global de las
   * capas) + el resultado consolidado. NO deriva criterios ni TC del Feature: esos son de las
   * HUs. Idempotente (una sola Task de plan por Feature; se actualiza, no se duplica).
   * Trackers sin jerarquía nativa degradan a no-op (este default) o a su estructura propia.
   * @param {string} featureId
   * @param {{featureTitle?: string, objective?: string, hus?: Array<{id, title?, tcs?}>,
   *          results?: EvidenceObject[], reportLink?: string|null}} info
   * @returns {Promise<{ok: boolean, featureId: string, planId?: string|null,
   *          created?: boolean, skipped?: string}>}
   */
  async publishTestPlan(featureId, info) {
    return { ok: true, featureId: String(featureId), planId: null, skipped: "tracker sin jerarquía de plan" };
  }
}

export default TrackerAdapter;
