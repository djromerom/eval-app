export interface Student {
  id: string;
  institutionId: string;
  groupId: string;
  name: string;
  idType: string; // T.I., C.C., NUI, R.C.
  idNumber: string;
  code: string; // único por institución, embebido en el QR
  enrollmentYear: number;
  isActive: boolean;
}

export interface CreateStudentData {
  groupId: string;
  name: string;
  idType: string;
  idNumber: string;
  code: string;
  enrollmentYear: number;
}

/** Fila cruda de una importación masiva (Excel/CSV) antes de validar. */
export interface StudentImportRow {
  name: string;
  idType: string;
  idNumber: string;
  code: string;
  /** Nombre del grupo (ej. "11-03"); se resuelve a groupId al importar. */
  groupName: string;
  enrollmentYear: number;
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
