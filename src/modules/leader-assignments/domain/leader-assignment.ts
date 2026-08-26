/**
 * Líder ECU ↔ asignación a un curso entero (todas sus asignaturas).
 * Espejo del módulo teachers/ pero a nivel Course. La tenancy viaja por
 * User.institutionId (la tabla NO duplica el institutionId).
 *
 * Flujo:
 * - ECU_MASTER crea asignaciones desde /admin/leader-assignments.
 * - ECU_LIDER ve en /coordinator y /coordinator/review solo las formulaciones
 *   de los cursos donde está asignado (filtro inyectado en ListEvaluations /
 *   ListBundles — ver §3.4 y §3.5 del plan feat/lider-ecu).
 *
 * Por qué curso y no cursoSubject: un líder pedagógico quiere "este grado
 * entero", no "esta asignatura de este grado".
 */
export interface LeaderAssignment {
  id: string;
  userId: string;
  courseId: string;
  /** Denormalizado para que la UI de admin no necesite un join extra. */
  courseName: string;
  /** Denormalizado para mostrar "¿quién lidera este curso?" en listados. */
  userName: string;
}

export interface LeaderAssignmentRepository {
  /** Asigna un líder a un curso. Si ya está asignado, no falla (idempotente). */
  assign(userId: string, courseId: string): Promise<void>;
  /** Quita la asignación. Idempotente. */
  unassign(userId: string, courseId: string): Promise<void>;
  /** ¿Está asignado este líder a este curso? */
  isAssigned(userId: string, courseId: string): Promise<boolean>;
  /** Lista todas las asignaciones de la institución. Si userId, filtra por líder. */
  listAssignments(institutionId: string, userId?: string): Promise<LeaderAssignment[]>;
  /** Lista solo los courseId asignados — útil para el `WHERE courseId IN (...)` del filtro de scope. */
  listAssignedCourseIds(institutionId: string, userId: string): Promise<string[]>;
}