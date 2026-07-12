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

export interface StudentRepository {
  findByCode(institutionId: string, code: string): Promise<Student | null>;
  /** Busca también en el historial de códigos: los QR viejos deben funcionar. */
  findByCodeIncludingHistory(institutionId: string, code: string): Promise<Student | null>;
  findByGroup(institutionId: string, groupId: string): Promise<Student[]>;
  changeCode(institutionId: string, studentId: string, newCode: string): Promise<void>;
}
