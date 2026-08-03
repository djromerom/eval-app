// Estructura académica por institución (REQUERIMIENTOS_v2.md §3.2).
// Todas las entidades (salvo Subject global) están acotadas por institutionId.

export interface AcademicYear {
  id: string;
  institutionId: string;
  year: number;
  startDate: Date;
  endDate: Date;
  isCurrent: boolean;
}

export interface Course {
  id: string;
  institutionId: string;
  academicYearId: string;
  name: string; // "8°", "11°"
  code: string;
}

export interface Subject {
  id: string;
  institutionId: string | null; // null = catálogo global compartido
  name: string;
  code: string;
}

export interface Group {
  id: string;
  institutionId: string;
  courseId: string;
  name: string; // "11-03"
}

export interface Period {
  id: string;
  institutionId: string;
  academicYearId: string;
  name: string; // "I Periodo"
  order: number;
  startDate: Date;
  endDate: Date;
  /** Marca la Prueba "en curso" dentro de su año académico. Una sola Prueba
   *  por año académico puede tener `isCurrent=true` (constraint enforced en
   *  el use case, no en BD). */
  isCurrent: boolean;
}

/** Enlace asignatura ↔ curso (un curso tiene N asignaturas). §3.2 */
export interface CourseSubject {
  id: string;
  courseId: string;
  subjectId: string;
}

/** Vista enriquecida con nombres, para listados. */
export interface CourseSubjectView extends CourseSubject {
  courseName: string;
  subjectName: string;
}

// ===== Datos de creación =====

export interface CreateAcademicYearData {
  year: number;
  startDate: Date;
  endDate: Date;
  isCurrent?: boolean;
}

export interface CreateCourseData {
  academicYearId: string;
  name: string;
  code: string;
}

export interface CreateSubjectData {
  name: string;
  code: string;
  /** true = catálogo global (institutionId null); solo SUPER_ADMIN debería crearlas. */
  global?: boolean;
}

export interface CreateGroupData {
  courseId: string;
  name: string;
}

export interface CreateCourseSubjectData {
  courseId: string;
  subjectId: string;
}

export interface CreatePeriodData {
  academicYearId: string;
  name: string;
  order: number;
  startDate: Date;
  endDate: Date;
}

// ===== Puertos de persistencia (acotados por institución) =====

export interface AcademicYearRepository {
  findAll(institutionId: string): Promise<AcademicYear[]>;
  findById(institutionId: string, id: string): Promise<AcademicYear | null>;
  findByYear(institutionId: string, year: number): Promise<AcademicYear | null>;
  create(institutionId: string, data: CreateAcademicYearData): Promise<AcademicYear>;
  /** Marca uno como actual y desmarca el resto de la institución. */
  setCurrent(institutionId: string, id: string): Promise<void>;
}

export interface CourseRepository {
  findAll(institutionId: string, academicYearId?: string): Promise<Course[]>;
  findById(institutionId: string, id: string): Promise<Course | null>;
  create(institutionId: string, data: CreateCourseData): Promise<Course>;
}

export interface SubjectRepository {
  /** Catálogo visible para la institución: sus asignaturas + las globales. */
  findAllForInstitution(institutionId: string): Promise<Subject[]>;
  findById(id: string): Promise<Subject | null>;
  create(institutionId: string | null, data: CreateSubjectData): Promise<Subject>;
}

export interface GroupRepository {
  findAll(institutionId: string, courseId?: string): Promise<Group[]>;
  findById(institutionId: string, id: string): Promise<Group | null>;
  create(institutionId: string, data: CreateGroupData): Promise<Group>;
  delete(institutionId: string, id: string): Promise<void>;
}

export interface PeriodRepository {
  findAll(institutionId: string, academicYearId?: string): Promise<Period[]>;
  findById(institutionId: string, id: string): Promise<Period | null>;
  create(institutionId: string, data: CreatePeriodData): Promise<Period>;
  update(institutionId: string, id: string, data: UpdatePeriodData): Promise<Period | null>;
  delete(institutionId: string, id: string): Promise<void>;
  /** Marca una Prueba como "actual" dentro de su año académico y desmarca
   *  las demás del mismo año. Atómico: `prisma.$transaction` para evitar
   *  que dos pruebas terminen marcadas. `isCurrent=false` solo desmarca
   *  la indicada sin tocar las demás. */
  setCurrent(
    institutionId: string,
    academicYearId: string,
    periodId: string,
    isCurrent: boolean,
  ): Promise<void>;
}

export interface UpdatePeriodData {
  name?: string;
  order?: number;
  startDate?: Date;
  endDate?: Date;
}

export interface CourseSubjectRepository {
  /** Enlaces de la institución (vía course.institutionId), con nombres. */
  findAll(institutionId: string): Promise<CourseSubjectView[]>;
  findById(institutionId: string, id: string): Promise<CourseSubject | null>;
  exists(courseId: string, subjectId: string): Promise<boolean>;
  create(data: CreateCourseSubjectData): Promise<CourseSubject>;
  delete(courseId: string, subjectId: string): Promise<void>;
}

// ===== Validación de dominio =====

/** Un código académico corto: 1-20 caracteres visibles, sin espacios en los bordes. */
export function isValidCode(code: string): boolean {
  return code.trim().length >= 1 && code.trim().length <= 20;
}

export function isValidDateRange(start: Date, end: Date): boolean {
  return start.getTime() < end.getTime();
}
