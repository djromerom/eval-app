/**
 * Reglas institucionales que exigen un número EXACTO de ítems por
 * evaluación, condicionadas a la tupla
 * (Prueba × Grado × Asignatura × Tipo de cuadernillo).
 *
 * Sprint ago 2026 — introducido para que el admin (ECU_MASTER) pueda fijar
 * conteos inmutables por combinación. Sin regla → modo libre (comportamiento
 * histórico). Ver src/app/(dashboard)/admin/academic/periods/[id]/edit/
 * para el panel de configuración.
 *
 * Reglas de la capa de dominio (no se importa @prisma/client):
 * - Todas las entidades llevan `institutionId` (multi-tenancy).
 * - Las FK se validan en el use case contra los repositorios (no en BD).
 * - Errores legibles: `ValidationError`, `ConflictError`, `NotFoundError`.
 *
 * Edge cases intencionales:
 * - `bookletTypeId` es OBLIGATORIO: no existen evaluaciones sin tipo de
 *   cuadernillo, por lo que toda regla debe apuntar a un BookletType
 *   específico de su Prueba.
 * - `periodId = null` en la evaluation → no hay match → no hay enforcement.
 * - Cambio de regla con evaluación en DRAFT: la próxima transición usa el
 *   nuevo valor; no se mutan preguntas existentes (el docente ve el delta
 *   en el banner y ajusta manualmente).
 */

export interface EvaluationRule {
  id: string;
  institutionId: string;
  periodId: string;
  courseId: string;
  subjectId: string;
  bookletTypeId: string;
  exactQuestions: number;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEvaluationRuleData {
  periodId: string;
  courseId: string;
  subjectId: string;
  bookletTypeId: string;
  exactQuestions: number;
  createdById: string;
}

export interface UpdateEvaluationRuleData {
  exactQuestions?: number;
}

export interface EvaluationRuleRepository {
  findById(institutionId: string, id: string): Promise<EvaluationRule | null>;
  listByPeriod(institutionId: string, periodId: string): Promise<EvaluationRule[]>;
  /** Trae todas las de la institución para que el cliente filtre por
   *  `periodId`. Tabla chica (decenas/centenas de filas por institución). */
  listByInstitution(institutionId: string): Promise<EvaluationRule[]>;
  create(institutionId: string, data: CreateEvaluationRuleData): Promise<EvaluationRule>;
  update(
    institutionId: string,
    id: string,
    data: UpdateEvaluationRuleData,
  ): Promise<EvaluationRule | null>;
  delete(institutionId: string, id: string): Promise<void>;
  /**
   * Resuelve `courseSubjectId` → {courseId, subjectId} y devuelve la regla
   * que matchea (institutionId, periodId?, courseId, subjectId, bookletTypeId).
   *
   * Semántica de match:
   * - `bookletTypeId = null` (en la evaluation) solo matchea reglas con
   *   `bookletTypeId = null` (regla sin tipo).
   * - `periodId = null` (en la evaluation) → no matchea nada → no hay
   *   enforcement (intencional: evaluaciones diagnósticas sin periodo).
   *
   * Si no hay regla → retorna `null` (modo libre).
   */
  findForEvaluation(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
    bookletTypeId: string | null,
  ): Promise<EvaluationRule | null>;
}

/** Tope defensivo anti-errores (500 ítems cubre cualquier prueba real). */
export const MIN_EXACT_QUESTIONS = 1;
export const MAX_EXACT_QUESTIONS = 500;

export function isValidExactQuestions(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_EXACT_QUESTIONS && n <= MAX_EXACT_QUESTIONS;
}
