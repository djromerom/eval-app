/**
 * DTO de una fila del listado "Formulaciones". Deliberadamente **NO**
 * extiende `EvaluationListItem` (de `src/modules/evaluations/domain/evaluation`)
 * porque queremos un shape "listo para la UI" con dos campos adicionales que el
 * DTO base no carga: `assignedTeachers[]` y `itemsExpected` + `itemsBadge`.
 *
 * Si el día de mañana el listado quiere ordenarse por `bookletNumber`, por
 * ejemplo, se añade el campo aquí y se hidrata en el fetcher. Mantener el
 * DTO independiente evita acoplarnos a cambios del módulo evaluations.
 */
import type { EvaluationStatus } from "@/modules/evaluations/domain/evaluation-status";
import type { ItemsBadge } from "../../shared/items-badge";

export interface FormulacionRow {
  id: string;
  title: string;
  /** Nombre de la asignatura (Subject.name vía courseSubject.subject). */
  subjectName: string;
  /** Nombre del grado (Course.name vía courseSubject.course). */
  courseName: string;
  /** Año académico al que pertenece (AcademicYear.year). */
  academicYearYear: number;
  /** Prueba/periodo académico (Period.name). Nullable: diagnósticas sin periodo. */
  periodId: string | null;
  periodName: string | null;
  /** Tipo de cuadernillo (BookletType.name). Nullable. */
  bookletTypeId: string | null;
  bookletTypeName: string | null;
  /** Estado del workflow. */
  status: EvaluationStatus;
  /** Docente autor de la formulación (User.name vía Evaluation.teacherId). */
  authorName: string;
  /** Docentes que dictan el mismo courseSubject (vía TeacherSubjectAssignment).
   *  Puede ser [] si no hay docentes asignados a la materia-grado.
   *  Excluye al autor de forma NO implícita — si el autor también está asignado
   *  aparece en esta lista; si quieres excluido, filtrar en la UI. */
  assignedTeachers: string[];
  /** Total real de ítems (Evaluation.totalQuestions). */
  itemsTotal: number;
  /** Esperado por la regla EvaluationRule.exactQuestions de la tupla. `null`
   *  si no hay regla configurada para la tupla (modo libre). */
  itemsExpected: number | null;
  /** Estado del badge precomputado en el fetcher. "none" = sin regla. */
  itemsBadge: ItemsBadge;
  /** Última modificación del evaluation. */
  updatedAt: Date;
}
