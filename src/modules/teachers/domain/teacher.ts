/**
 * Docente = usuario (rol TEACHER) + perfil con documento y teléfono
 * (REQUERIMIENTOS_v2.md §3.2). El schema exige Teacher.userId, así que crear un
 * docente crea también su cuenta (invitada, inactiva hasta que ingrese).
 */
export interface Teacher {
  id: string;
  userId: string;
  institutionId: string;
  name: string; // del usuario
  email: string; // del usuario
  idType: string;
  idNumber: string;
  phone: string | null;
  isActive: boolean; // del usuario
}

export interface CreateTeacherData {
  name: string;
  email: string;
  idType: string;
  idNumber: string;
  phone?: string;
}

/** Asignación docente ↔ curso+asignatura, con nombres para listados. */
export interface TeacherAssignment {
  id: string;
  teacherId: string;
  courseSubjectId: string;
  courseName: string;
  subjectName: string;
}

export interface TeacherRepository {
  findAll(institutionId: string): Promise<Teacher[]>;
  findById(institutionId: string, id: string): Promise<Teacher | null>;
  /** Crea la cuenta (TEACHER, inactiva) + el perfil docente en una transacción. */
  createWithUser(institutionId: string, data: CreateTeacherData): Promise<Teacher>;
  /** Guarda el hash del token de invitación y su expiración en el usuario. */
  setInviteToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  assign(teacherId: string, courseSubjectId: string): Promise<void>;
  isAssigned(teacherId: string, courseSubjectId: string): Promise<boolean>;
  listAssignments(institutionId: string, teacherId?: string): Promise<TeacherAssignment[]>;
}

export const TEACHER_ID_TYPES = ["C.C.", "C.E.", "PPT", "PA"] as const;

export function isValidTeacherIdType(idType: string): boolean {
  return (TEACHER_ID_TYPES as readonly string[]).includes(idType);
}
