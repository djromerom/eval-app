/**
 * Matrícula del estudiante en un año académico concreto. Permite conservar
 * el histórico (un estudiante pasa por varios grupos / grados / cuadernillos
 * a lo largo de su vida escolar). Solo una fila por estudiante tiene
 * `isCurrent=true` (la del año académico vigente).
 *
 * Tenancy: viaja por FK transitiva `student.institutionId`. El repositorio
 * filtra siempre con `student: { institutionId }` — no se duplica acá.
 *
 * El constraint "una fila vigente por estudiante" lo enforza el repositorio
 * con transacción (mismo patrón que `Period.setCurrent`); el índice parcial
 * `WHERE "isCurrent" = true` actúa como red de seguridad a nivel BD.
 */
export interface StudentEnrollment {
  id: string;
  studentId: string;
  academicYearId: string;
  groupId: string;
  grade: string | null;
  bookletTypeId: string | null;
  isCurrent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStudentEnrollmentData {
  studentId: string;
  academicYearId: string;
  groupId: string;
  grade?: string | null;
  bookletTypeId?: string | null;
}

export interface UpdateStudentEnrollmentData {
  groupId?: string;
  grade?: string | null;
  bookletTypeId?: string | null;
}

export interface StudentEnrollmentRepository {
  findById(institutionId: string, id: string): Promise<StudentEnrollment | null>;
  /** Matrícula vigente del estudiante (la única con `isCurrent=true`). */
  findCurrentByStudent(institutionId: string, studentId: string): Promise<StudentEnrollment | null>;
  findByStudentAndYear(
    institutionId: string,
    studentId: string,
    academicYearId: string,
  ): Promise<StudentEnrollment | null>;
  /** Estudiantes matriculados en un grupo del año académico indicado
   *  (default: año vigente del grupo). */
  findCurrentByGroup(
    institutionId: string,
    groupId: string,
    academicYearId?: string,
  ): Promise<StudentEnrollment[]>;
  /** Histórico completo de un estudiante (todos los años cursados). */
  findHistoryByStudent(institutionId: string, studentId: string): Promise<StudentEnrollment[]>;
  create(institutionId: string, data: CreateStudentEnrollmentData): Promise<StudentEnrollment>;
  /** Alta masiva atómica (una transacción por lote). Marca los nuevos como
   *  `isCurrent=true` y desmarca los previos del mismo estudiante. */
  createMany(institutionId: string, data: CreateStudentEnrollmentData[]): Promise<number>;
  update(
    institutionId: string,
    id: string,
    data: UpdateStudentEnrollmentData,
  ): Promise<StudentEnrollment>;
  /** Marca este enrollment como `isCurrent=true`, desmarca el resto del
   *  mismo estudiante (transacción atómica — una sola fila vigente). */
  setCurrent(institutionId: string, id: string): Promise<void>;
}
