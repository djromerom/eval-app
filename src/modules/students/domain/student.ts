import type { StudentEnrollment } from "./student-enrollment";

export interface Student {
  id: string;
  institutionId: string;
  // Nombre partido en 4 campos según convención colombiana. APELLIDO1 +
  // NOMBRE1 obligatorios (validados en use case); APELLIDO2 + NOMBRE2
  // opcionales — caso real: muchos estudiantes tienen solo 1 apellido o 1
  // nombre.
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  idType: string; // T.I., C.C., NUI, R.C.
  idNumber: string;
  code: string; // único por institución, embebido en el QR
  enrollmentYear: number;
  isActive: boolean;
  /** Matrícula vigente del estudiante en el año académico actual (la única
   *  con `isCurrent=true`). Contiene grupo/grado/cuadernillo. Hidratada por
   *  el repo al hacer `findById`/`findByCode`/`findAll`/etc.
   *  `null` si el estudiante no tiene enrollment en el año actual (caso
   *  borde post-migración — UI muestra "—"). */
  currentEnrollment: StudentEnrollment | null;
}

/** Datos de la matrícula vigente del estudiante. Usado en create + update
 *  para mover el grupo/grado/cuadernillo.
 *
 *  `academicYearId` es OPCIONAL en el input porque los use cases
 *  (`CreateStudent`/`UpdateStudent`/`ImportStudents`) lo inyectan desde
 *  el año académico actual de la institución — la UI nunca lo envía.
 *  El repositorio requiere que venga presente en el momento del insert. */
export interface StudentEnrollmentInput {
  academicYearId?: string;
  groupId: string;
  grade?: string | null;
  bookletTypeId?: string | null;
}

export interface CreateStudentData {
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  idType: string;
  idNumber: string;
  code: string;
  enrollmentYear: number;
  enrollment: StudentEnrollmentInput;
}

/** Campos editables desde el drawer de edición. NO incluye `code` — el
 *  cambio de código tiene su propio caso de uso (`ChangeStudentCode`) que
 *  preserva el historial de QR.
 *  `enrollment` es opcional: si no viene, solo se actualizan datos personales. */
export interface UpdateStudentData {
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  idType: string;
  idNumber: string;
  enrollmentYear: number;
  isActive: boolean;
  enrollment?: StudentEnrollmentInput;
}

/** Fila cruda de una importación masiva (Excel/CSV) antes de validar. */
export interface StudentImportRow {
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  idType: string;
  idNumber: string;
  code: string;
  /** Nombre del grupo (ej. "11-03"); se resuelve a groupId al importar. */
  groupName: string;
  enrollmentYear: number;
  /** Grado del estudiante (texto libre). Opcional: no todas las planillas
   *  lo incluyen. */
  grade: string;
  /** Nombre del BookletType (ej. "ESTANDAR"). Vacío = sin cuadernillo por
   *  defecto. Si viene, debe acompañarse de `periodName` para identificar
   *  el cuadernillo dentro de la Prueba correcta. */
  bookletTypeName: string;
  /** Nombre de la Prueba (Periodo) donde está definido el BookletType. El
   *  docente lo escribe en la columna PRUEBA del Excel — REQUERIDO si
   *  `bookletTypeName` viene, porque el mismo nombre puede existir en
   *  varias Pruebas. Vacío = bookletTypeName también vacío. */
  periodName: string;
}

export interface ImportError {
  row: number; // 1-based, referido al archivo original
  message: string;
}

export interface ImportResult {
  created: number;
  errors: ImportError[];
}

export interface StudentRepository {
  findById(institutionId: string, id: string): Promise<Student | null>;
  findByCode(institutionId: string, code: string): Promise<Student | null>;
  /** Busca también en el historial de códigos: los QR viejos deben funcionar. */
  findByCodeIncludingHistory(institutionId: string, code: string): Promise<Student | null>;
  findByGroup(institutionId: string, groupId: string): Promise<Student[]>;
  findAll(institutionId: string): Promise<Student[]>;
  create(institutionId: string, data: CreateStudentData): Promise<Student>;
  /** Alta masiva atómica (una transacción) de estudiantes ya validados. */
  createMany(institutionId: string, data: CreateStudentData[]): Promise<number>;
  /** Cambia el código dejando registro en el historial (§3.2). */
  changeCode(institutionId: string, studentId: string, newCode: string): Promise<void>;
  /** Edita los campos NO relacionados al código. Devuelve el estudiante
   *  actualizado. Lanza si la fila no existe o pertenece a otra institución. */
  update(institutionId: string, id: string, data: UpdateStudentData): Promise<Student>;
  /** Soft-delete: marca `deletedAt` y `isActive=false`. Preserva el historial
   *  de códigos (los QR viejos siguen funcionando). */
  softDelete(institutionId: string, id: string): Promise<void>;
}

const CODE_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

/** El código estudiantil va en el QR: alfanumérico, sin espacios. */
export function isValidStudentCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export const ID_TYPES = ["T.I.", "C.C.", "C.E.", "NUI", "R.C.", "PPT"] as const;

export function isValidIdType(idType: string): boolean {
  return (ID_TYPES as readonly string[]).includes(idType);
}

/** Las 4 partes que componen el nombre del estudiante. Usado como input de
 *  `formatStudentFullName` para que la UI/print/reportes no tengan que
 *  conocer la forma exacta — solo pasar las 4 strings. */
export interface StudentNameParts {
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
}

/** Concatena las 4 partes en MAYÚSCULA para display estilo lista ICFES
 *  colombiano: "PÉREZ GARCÍA JUAN CARLOS". Las partes vacías se omiten
 *  (un estudiante con solo APELLIDO1 + NOMBRE1 sale como "PÉREZ ANA"). */
export function formatStudentFullName(s: StudentNameParts): string {
  return [s.lastName1, s.lastName2, s.firstName1, s.firstName2]
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean)
    .join(" ");
}
