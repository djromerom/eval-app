/**
 * Sprint Preguntas inhabitadas del Cuadernillo (sep 2026).
 *
 * Una pregunta "inhabilitada" dentro de un Cuadernillo es aquella que el
 * docente decide explícitamente que NO cuente para la calificación
 * (clave mal impresa, pregunta retirada post-print, redacción ambigua).
 *
 * Modelo de datos:
 *   - `DisabledBundleQuestion (bundleId, questionId)` con flag `disabled`
 *     para distinguir activa/inactiva. Re-habilitar baja el flag a false
 *     en vez de borrar la fila → conservamos la auditoría de qué preguntas
 *     fueron inhabitadas en algún momento (consultable, no visible al usuario).
 *   - NO se persiste `StudentAnswer.notCounted`. El efecto sobre la hoja
 *     escaneada se computa en query-time con join a esta tabla. Esto evita
 *     tener que re-procesar hojas viejas cuando el flag cambia.
 *   - El cómputo del puntaje EFFECTIVO (= puntaje SIN contar inhabitadas)
 *     lo hacen 3 lugares: motor OMR (PR #2), reporte de calificaciones
 *     (PR #4) y posiblemente la matriz del detalle (PR #3). Todos usan
 *     `preguntasEfectivas` para mantener la regla en un único sitio.
 */

export interface DisabledBundleQuestion {
  id: string;
  bundleId: string;
  questionId: string;
  disabledAt: Date;
  disabledByUserId: string;
  /** Si está `false`, la pregunta vuelve a contar (fila se conserva para
   *  auditoría). Útil para que `preguntasEfectivas` filtre por `disabled = true`. */
  disabled: boolean;
}

/** Puerto de persistencia. Implementado por PrismaDisabledBundleQuestionRepository. */
export interface DisabledBundleQuestionRepository {
  /** Lista las filas activas (`disabled = true`) para un bundle. Es lo que
   *  consume `preguntasEfectivas` y lo que muestra la UI. */
  listActiveByBundle(bundleId: string): Promise<DisabledBundleQuestion[]>;

  /**
   * Crea la fila si no existe, o actualiza el flag si ya existe. Idempotente:
   * re-toggling al mismo estado no crea duplicados ni errores.
   *
   * Decisión deliberada: re-habilitar baja `disabled` a false en vez de
   * borrar — preserva el historial.
   */
  setDisabled(args: {
    bundleId: string;
    questionId: string;
    /** `true` = inhabitar; `false` = re-habilitar. */
    disabled: boolean;
    actorUserId: string;
  }): Promise<DisabledBundleQuestion>;

  /**
   * Devuelve los IDs de las preguntas que actualmente cuentan para el bundle
   * (todas las del bundle menos las inhabitadas). Se computa en SQL con
   * LEFT JOIN + NOT IN para no traer las preguntas hidratadas — el worker
   * OMR (PR #2) y el reporte (PR #4) lo invocan con sets grandes.
   *
   * Devuelve `null` si el bundle no existe — el caller lo trata como 404,
   * distinto de `[]` que sería "bundle existe pero sin preguntas efectivas".
   */
  effectiveQuestionIds(bundleId: string): Promise<string[] | null>;

  /**
   * Lock check para `ToggleDisabledBundleQuestion`: ¿ya hay al menos un
   * `ScanBatch` apuntando al bundle? Si sí, toggling inhabitaciones se
   * bloquea (decisión deliberada sep 2026: no re-procesar hojas viejas).
   */
  bundleHasAnyScanBatch(bundleId: string): Promise<boolean>;

  /**
   * Devuelve TODOS los IDs de las preguntas que pertenecen al bundle (sin
   * filtrar por inhabitadas). Lo usa el use case `ToggleDisabledBundleQuestion`
   * para validar "¿esta pregunta existe dentro del bundle?" antes de togglear.
   * Devuelve `null` si el bundle no existe.
   */
  listAllQuestionIdsForBundle(bundleId: string): Promise<string[] | null>;

  /**
   * Lista las preguntas del bundle en orden de impresión
   * (item.order → section.order → question.number), con datos suficientes
   * para que la UI muestre enunciado y permita togglear. NO hidrata las
   * inhabitaciones — eso lo hace el caller con `listActiveByBundle` (1 query
   * barato, indexado por bundleId).
   *
   * Devuelve `null` si el bundle no existe (para distinguir 404 de bundle
   * con 0 preguntas, que es un caso degenerado).
   *
   * Usado por el use case `GetBundleQuestionsForToggle` (PR #3 de este sprint).
   */
  listQuestionsForBundle(bundleId: string): Promise<
    | {
        questionId: string;
        evaluationId: string;
        evaluationTitle: string;
        evaluationOrder: number;
        sectionId: string;
        sectionOrder: number;
        sectionTitle: string | null;
        questionNumber: number;
        /** TipTap JSON crudo del enunciado. El caller (use case o cliente) lo
         *  convierte a texto plano; vive aquí sin transformación para que la
         *  capa de presentación decida cómo mostrarlo (preview, full, etc.). */
        statementJson: unknown;
      }[]
    | null
  >;
}

// ============================================================================
// Helpers puros (sin Prisma, sin repo). Usados por use cases + (futuro) worker.
// ============================================================================

/** Pregunta cruda del bundle, justo lo que necesita `filtrarPreguntasEfectivas`. */
export interface BundleQuestionRef {
  questionId: string;
}

/**
 * Devuelve las preguntas del bundle que NO están inhabitadas. Pura — el caller
 * decide de dónde saca los inputs.
 *
 * Contrato:
 *   - Si `total = 0` devuelve `[]` (no se inhabita nada, no quedan efectivas).
 *   - Si `disabled = total`, devolver `[]` indica "se inhabitaron todas" pero
 *     el caller (use case) debe detectar esto ANTES de persistir; ver
 *     `assertDejaAlMenosUnaEfectiva` más abajo.
 *   - Orden estable: preserva el orden de entrada. Importa si el caller es
 *     el worker OMR y necesita reproducir numeración humana.
 */
export function filtrarPreguntasEfectivas<T extends BundleQuestionRef>(
  preguntas: readonly T[],
  disabledIds: ReadonlySet<string>,
): T[] {
  return preguntas.filter((p) => !disabledIds.has(p.questionId));
}

/**
 * ¿La operación propuesta deja al bundle con ≥1 pregunta efectiva?
 * `delta` representa la intención: +1 inhabitar, -1 re-habilitar.
 *
 * Decisión UX (sep 2026): la UI bloquea al docente si intenta inhabitarlas
 * TODAS. El dominio enforcea esto — no es solo una restricción de UI — porque
 * un cuadernillo con 0 preguntas efectivas es inutilizable para calificación.
 */
export function assertDejaAlMenosUnaEfectiva(args: {
  totalPreguntasBundle: number;
  idsYaInhabilitados: ReadonlySet<string>;
  /** `true` si esta invocación intenta inhabitar; `false` si re-habilita. */
  intentaInhabilitar: boolean;
  /** ID que se intenta inhabitar/re-habilitar. */
  questionId: string;
}): { ok: true } | { ok: false; reason: "WOULD_LEAVE_EMPTY" } {
  if (!args.intentaInhabilitar) {
    // Re-habilitar nunca deja al bundle vacío.
    return { ok: true };
  }
  const yaEstaba = args.idsYaInhabilitados.has(args.questionId);
  const effectiveActuales = args.totalPreguntasBundle - args.idsYaInhabilitados.size;
  const effectiveDespues = yaEstaba ? effectiveActuales : effectiveActuales - 1;
  if (effectiveDespues < 1) {
    return { ok: false, reason: "WOULD_LEAVE_EMPTY" };
  }
  return { ok: true };
}
