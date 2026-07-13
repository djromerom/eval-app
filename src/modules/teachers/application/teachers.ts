import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { EmailService } from "@/shared/domain/email";
import { sendUserInvitation } from "@/shared/application/user-invitation";
import { logger } from "@/shared/infrastructure/logger";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import { isValidEmail } from "@/modules/users/domain/user";
import type { CourseSubjectRepository } from "@/modules/academic/domain/types";
import {
  type CreateTeacherData,
  type Teacher,
  type TeacherAssignment,
  type TeacherRepository,
  isValidTeacherIdType,
} from "../domain/teacher";

export interface EnsureTeacherProfileInput {
  actor: AuthenticatedUser;
  userId: string;
}

/**
 * Garantiza que un usuario con rol Profesor tenga perfil docente. Se invoca al
 * asignar el rol desde el módulo Usuarios; crea un perfil incompleto (sin
 * documento) que luego se completa en Docentes. Idempotente. §3.1/§3.2
 */
export class EnsureTeacherProfile implements UseCase<EnsureTeacherProfileInput, Teacher> {
  constructor(private readonly teachers: TeacherRepository) {}

  async execute({ actor, userId }: EnsureTeacherProfileInput): Promise<Result<Teacher>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    const existing = await this.teachers.findByUserId(actor.institutionId, userId);
    if (existing) return ok(existing);

    return ok(
      await this.teachers.createProfileForUser(userId, { idType: "", idNumber: "", phone: null }),
    );
  }
}

export interface CompleteTeacherProfileInput {
  actor: AuthenticatedUser;
  teacherId: string;
  idType: string;
  idNumber: string;
  phone?: string;
}

/** Completa el documento/teléfono de un perfil docente incompleto. §3.2 */
export class CompleteTeacherProfile implements UseCase<CompleteTeacherProfileInput, Teacher> {
  constructor(private readonly teachers: TeacherRepository) {}

  async execute({
    actor,
    teacherId,
    idType,
    idNumber,
    phone,
  }: CompleteTeacherProfileInput): Promise<Result<Teacher>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    if (!isValidTeacherIdType(idType)) {
      return fail(new ValidationError(`Tipo de documento inválido: "${idType}".`));
    }
    if (!idNumber.trim()) {
      return fail(new ValidationError("El número de documento es obligatorio."));
    }

    const teacher = await this.teachers.findById(actor.institutionId, teacherId);
    if (!teacher) return fail(new ValidationError("El docente no existe en tu institución."));

    return ok(
      await this.teachers.updateProfile(teacherId, {
        idType,
        idNumber: idNumber.trim(),
        phone: phone?.trim() || null,
      }),
    );
  }
}

export interface CreateTeacherInput {
  actor: AuthenticatedUser;
  data: CreateTeacherData;
  institutionName: string;
}

/** Alta de docente: crea la cuenta (TEACHER, inactiva) + perfil (ADMIN). §3.2 */
export class CreateTeacher implements UseCase<CreateTeacherInput, Teacher> {
  constructor(
    private readonly teachers: TeacherRepository,
    private readonly email?: EmailService,
  ) {}

  async execute({ actor, data, institutionName }: CreateTeacherInput): Promise<Result<Teacher>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    if (!data.name.trim()) return fail(new ValidationError("El nombre es obligatorio."));
    if (!isValidEmail(data.email)) return fail(new ValidationError("Correo electrónico inválido."));
    if (!isValidTeacherIdType(data.idType)) {
      return fail(new ValidationError(`Tipo de documento inválido: "${data.idType}".`));
    }
    if (!data.idNumber.trim())
      return fail(new ValidationError("El número de documento es obligatorio."));

    const email = data.email.trim().toLowerCase();
    if (await this.teachers.emailTaken(email)) {
      return fail(new ValidationError(`Ya existe un usuario con el correo "${email}".`));
    }

    const teacher = await this.teachers.createWithUser(actor.institutionId, {
      ...data,
      email,
      name: data.name.trim(),
    });

    if (this.email) {
      try {
        await sendTeacherInvitation(this.teachers, this.email, teacher, institutionName);
      } catch (error) {
        // El docente se creó igual; el envío se puede reintentar desde el panel.
        logger.error(
          { err: error, teacherId: teacher.userId, to: teacher.email },
          "No se pudo enviar el correo de invitación al docente",
        );
      }
    }

    return ok(teacher);
  }
}

export interface ResendTeacherInvitationInput {
  actor: AuthenticatedUser;
  teacherId: string;
  institutionName: string;
}

/** Reenvía el correo de invitación a un docente que aún no ha activado su cuenta. §3.2 */
export class ResendTeacherInvitation implements UseCase<ResendTeacherInvitationInput, void> {
  constructor(
    private readonly teachers: TeacherRepository,
    private readonly email?: EmailService,
  ) {}

  async execute({
    actor,
    teacherId,
    institutionName,
  }: ResendTeacherInvitationInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    if (!this.email) {
      return fail(new ValidationError("El envío de correos no está configurado (SMTP)."));
    }

    const teacher = await this.teachers.findById(actor.institutionId, teacherId);
    if (!teacher) return fail(new ValidationError("El docente no existe en tu institución."));
    if (teacher.isActive) {
      return fail(new ValidationError("El docente ya activó su cuenta; no requiere invitación."));
    }

    try {
      await sendTeacherInvitation(this.teachers, this.email, teacher, institutionName);
    } catch (error) {
      // A diferencia del alta, aquí el envío es el objetivo: se surfacea el fallo.
      logger.error(
        { err: error, teacherId: teacher.userId, to: teacher.email },
        "No se pudo reenviar el correo de invitación al docente",
      );
      return fail(
        new ValidationError(
          "No se pudo enviar el correo. Verifica la configuración SMTP e inténtalo de nuevo.",
        ),
      );
    }

    return ok(undefined);
  }
}

/** Envía el correo de invitación al docente reutilizando el helper compartido. */
async function sendTeacherInvitation(
  teachers: TeacherRepository,
  email: EmailService,
  teacher: Pick<Teacher, "userId" | "email" | "name">,
  institutionName: string,
): Promise<void> {
  await sendUserInvitation(
    email,
    (userId, tokenHash, expiresAt) => teachers.setInviteToken(userId, tokenHash, expiresAt),
    { userId: teacher.userId, email: teacher.email, name: teacher.name, institutionName },
  );
}

export interface ListTeachersInput {
  actor: AuthenticatedUser;
}

export class ListTeachers implements UseCase<ListTeachersInput, Teacher[]> {
  constructor(private readonly teachers: TeacherRepository) {}

  async execute({ actor }: ListTeachersInput): Promise<Result<Teacher[]>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;
    return ok(await this.teachers.findAll(actor.institutionId));
  }
}

export interface AssignTeacherInput {
  actor: AuthenticatedUser;
  teacherId: string;
  courseSubjectId: string;
}

/** Asigna un docente a una asignatura-curso de la institución (ADMIN). §3.2 */
export class AssignTeacher implements UseCase<AssignTeacherInput, void> {
  constructor(
    private readonly teachers: TeacherRepository,
    private readonly courseSubjects: CourseSubjectRepository,
  ) {}

  async execute({ actor, teacherId, courseSubjectId }: AssignTeacherInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "ADMIN");
    if (!authorized.ok) return authorized;

    const teacher = await this.teachers.findById(actor.institutionId, teacherId);
    if (!teacher) return fail(new ValidationError("El docente no existe en tu institución."));

    const courseSubject = await this.courseSubjects.findById(actor.institutionId, courseSubjectId);
    if (!courseSubject) {
      return fail(new ValidationError("La asignatura-curso no existe en tu institución."));
    }

    if (await this.teachers.isAssigned(teacherId, courseSubjectId)) {
      return fail(new ValidationError("El docente ya está asignado a esa asignatura-curso."));
    }

    await this.teachers.assign(teacherId, courseSubjectId);
    return ok(undefined);
  }
}

export interface ListTeacherAssignmentsInput {
  actor: AuthenticatedUser;
  teacherId?: string;
}

export class ListTeacherAssignments implements UseCase<
  ListTeacherAssignmentsInput,
  TeacherAssignment[]
> {
  constructor(private readonly teachers: TeacherRepository) {}

  async execute({
    actor,
    teacherId,
  }: ListTeacherAssignmentsInput): Promise<Result<TeacherAssignment[]>> {
    const authorized = requireRole(actor, "ADMIN", "TEACHER");
    if (!authorized.ok) return authorized;
    return ok(await this.teachers.listAssignments(actor.institutionId, teacherId));
  }
}
