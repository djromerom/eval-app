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

/**
 * Asignación docente ↔ curso+asignatura, con nombres para listados.
 *
 * `bookletTypeId` es el tipo de cuadernillo al que aplica la asignación.
 * `null` = aplica a cualquier tipo de esa asignatura-grado (filas creadas
 * antes del sprint de tipos, y alta en la UI sin marcar un tipo).
 */
export interface TeacherAssignment {
  id: string;
  teacherId: string;
  courseSubjectId: string;
  courseName: string;
  subjectName: string;
  bookletTypeId: string | null;
  /** Nombre del tipo de cuadernillo; null si la asignación aplica a todos. */
  bookletTypeName: string | null;
  /** Prueba (Period) a la que pertenece el tipo de cuadernillo, para que la
   *  UI pueda mostrar "Estándar (I Periodo)". Null si la asignación no tiene
   *  tipo. */
  periodName: string | null;
}

export interface TeacherRepository {
  findAll(institutionId: string): Promise<Teacher[]>;
  findById(institutionId: string, id: string): Promise<Teacher | null>;
  /** Busca el perfil docente por el usuario dueño (dentro de la institución). */
  findByUserId(institutionId: string, userId: string): Promise<Teacher | null>;
  /** ¿Ya existe un usuario (cualquiera) con este correo? El email es único global. */
  emailTaken(email: string): Promise<boolean>;
  /** ¿Ya existe un docente con este (idType, idNumber) en la institución?
   *  Como Teacher no tiene institutionId directo, cruzar por user. */
  idNumberTakenInInstitution(
    institutionId: string,
    idType: string,
    idNumber: string,
  ): Promise<boolean>;
  /** Crea la cuenta (TEACHER, inactiva) + el perfil docente en una transacción. */
  createWithUser(institutionId: string, data: CreateTeacherData): Promise<Teacher>;
  /** Crea el perfil docente para un usuario ya existente (rol Profesor asignado
   * desde Usuarios). El documento puede ir vacío y completarse después. */
  createProfileForUser(userId: string, data: TeacherProfileData): Promise<Teacher>;
  /** Actualiza documento/teléfono del perfil (completar perfil incompleto). */
  updateProfile(teacherId: string, data: TeacherProfileData): Promise<Teacher>;
  /** Guarda el hash del token de invitación y su expiración en el usuario. */
  setInviteToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** Asigna el docente a la asignatura-grado para el tipo de cuadernillo dado.
   *  `bookletTypeId = null` = la asignación aplica a cualquier tipo. */
  assign(teacherId: string, courseSubjectId: string, bookletTypeId: string | null): Promise<void>;
  /** ¿El docente ya está asignado a esa asignatura-grado para ese tipo?
   *  `bookletTypeId = null` busca la asignación "para cualquier tipo". */
  isAssigned(
    teacherId: string,
    courseSubjectId: string,
    bookletTypeId: string | null,
  ): Promise<boolean>;
  listAssignments(institutionId: string, teacherId?: string): Promise<TeacherAssignment[]>;
}

export const TEACHER_ID_TYPES = ["C.C.", "C.E.", "PPT", "PA"] as const;

export function isValidTeacherIdType(idType: string): boolean {
  return (TEACHER_ID_TYPES as readonly string[]).includes(idType);
}
