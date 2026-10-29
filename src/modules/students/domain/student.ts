export interface Student {
  id: string;
  institutionId: string;
  groupId: string;
  // Nombre partido en 4 campos según convención colombiana. APELLIDO1 +
  // NOMBRE1 obligatorios (validados en use case); APELLIDO2 + NOMBRE2
  // opcionales — caso real: muchos estudiantes tienen solo 1 apellido o 1
  // nombre.
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  idType: string; // T.I., C.C., NUI, R.C., NES, etc.
  idNumber: string;
  code: string; // único por institución, embebido en el QR
  enrollmentYear: number;
  isActive: boolean;
  /** Grado como texto libre (ej. "11", "2"). Nullable: filas existentes
   *  quedan null hasta que el docente las rellene vía import o edición.
   *  NO es FK — el course ya está implícito en `group.courseId`. */
  grade?: string | null;
  /** Cuadernillo por defecto del estudiante al armar hojas de respuesta.
   *  Nullable para mantener compat con filas existentes. Resuelto por
   *  nombre desde \`StudentImportRow.bookletTypeName\` durante el import. */
  bookletTypeId?: string | null;
}

export interface CreateStudentData {
  groupId: string;
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  idType: string;
  idNumber: string;
  code: string;
  enrollmentYear: number;
  grade?: string | null;
  bookletTypeId?: string | null;
}

/** Campos editables desde el drawer de edición. NO incluye `code` — el
 *  cambio de código tiene su propio caso de uso (`ChangeStudentCode`) que
 *  preserva el historial de QR. */
export interface UpdateStudentData {
  groupId: string;
  lastName1: string;
  lastName2: string;
  firstName1: string;
  firstName2: string;
  idType: string;
  idNumber: string;
  enrollmentYear: number;
  isActive: boolean;
  grade?: string | null;
  bookletTypeId?: string | null;
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

export const ID_TYPES = ["T.I.", "C.C.", "C.E.", "NUI", "R.C.", "NES", "PPT"] as const;

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

/** Entrada mínima para calcular la posición en la lista del grupo. Acepta un
 *  subset del `Student` para no obligar a la UI a cargar campos irrelevantes
 *  (código, enrollmentYear, etc.). */
export interface ListEntry extends StudentNameParts {
  id: string;
}

/** "Número de lista" estilo colegio colombiano: la posición 1-based del
 *  estudiante dentro de su grupo, ordenado por apellido1 → apellido2 →
 *  nombre1 → nombre2 con collation `es`. Si hay empate en las 4 partes se
 *  desempata por `id` para que el orden sea estable (importante cuando dos
 *  hermanos comparten nombre y apellido).
 *
 *  Devuelve `null` si el estudiante no está en la lista — distinto de "está
 *  en la posición 0", que no existe. La página renderiza el número solo
 *  cuando hay valor. */
export function listPositionByName(
  students: readonly ListEntry[],
  studentId: string,
): number | null {
  const ordenados = [...students].sort((a, b) => {
    const cmp =
      a.lastName1.localeCompare(b.lastName1, "es") ||
      a.lastName2.localeCompare(b.lastName2, "es") ||
      a.firstName1.localeCompare(b.firstName1, "es") ||
      a.firstName2.localeCompare(b.firstName2, "es");
    // Desempate estable por id para que el orden NO dependa del orden de
    // llegada de la BD. Sin esto, dos gemelos con idéntico nombre pueden
    // intercambiar posición entre renders.
    return cmp || a.id.localeCompare(b.id);
  });
  const idx = ordenados.findIndex((s) => s.id === studentId);
  return idx === -1 ? null : idx + 1;
}
