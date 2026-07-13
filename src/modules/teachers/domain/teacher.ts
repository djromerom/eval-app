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

/** Datos del perfil docente (documento y teléfono), sin la cuenta de usuario. */
export interface TeacherProfileData {
  idType: string;
  idNumber: string;
  phone: string | null;
}

/**
 * Un perfil está completo cuando tiene número de documento. Los docentes creados
 * al asignar el rol Profesor desde el módulo Usuarios nacen sin documento y se
 * completan después desde el módulo Docentes.
 */
export function isProfileComplete(teacher: Pick<Teacher, "idNumber">): boolean {
  return teacher.idNumber.trim().length > 0;
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
  /** Busca el perfil docente por el usuario dueño (dentro de la institución). */
  findByUserId(institutionId: string, userId: string): Promise<Teacher | null>;
  /** ¿Ya existe un usuario (cualquiera) con este correo? El email es único global. */
  emailTaken(email: string): Promise<boolean>;
  /** Crea la cuenta (TEACHER, inactiva) + el perfil docente en una transacción. */
  createWithUser(institutionId: string, data: CreateTeacherData): Promise<Teacher>;
  /** Crea el perfil docente para un usuario ya existente (rol Profesor asignado
   * desde Usuarios). El documento puede ir vacío y completarse después. */
  createProfileForUser(userId: string, data: TeacherProfileData): Promise<Teacher>;
  /** Actualiza documento/teléfono del perfil (completar perfil incompleto). */
  updateProfile(teacherId: string, data: TeacherProfileData): Promise<Teacher>;
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
