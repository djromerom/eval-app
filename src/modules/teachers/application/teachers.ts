import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { EmailService } from "@/shared/domain/email";
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

    const teacher = await this.teachers.createWithUser(actor.institutionId, {
      ...data,
      email: data.email.toLowerCase(),
      name: data.name.trim(),
    });

    if (this.email) {
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = await bcrypt.hash(rawToken, 10);
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h
      await this.teachers.setInviteToken(teacher.userId, tokenHash, expiresAt);

      const inviteUrl = `${process.env.AUTH_URL ?? "http://localhost:3000"}/auth/accept-invite?token=${rawToken}&email=${encodeURIComponent(teacher.email)}`;

      try {
        await this.email.send({
          to: teacher.email,
          subject: `Has sido invitado a ${institutionName} — Eval`,
          html: buildInvitationHtml({
            institutionName,
            teacherName: teacher.name,
            inviteUrl,
          }),
        });
      } catch {
        // Si falla el envío, el docente se creó igual. Se puede reintentar desde el panel.
      }
    }

    return ok(teacher);
  }
}

function buildInvitationHtml(params: {
  institutionName: string;
  teacherName: string;
  inviteUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
        <tr>
          <td style="background:#2563eb;padding:24px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:20px;font-weight:600">${params.institutionName}</h1>
          </td>
        </tr>
        <tr><td style="padding:32px 24px">
          <p style="margin:0 0 16px;font-size:16px;color:#18181b">Hola <strong>${params.teacherName}</strong>,</p>
          <p style="margin:0 0 16px;font-size:14px;color:#52525b;line-height:1.6">
            Has sido invitado a la plataforma <strong>Eval</strong> de
            <strong>${params.institutionName}</strong>.
            Haz clic en el siguiente botón para establecer tu contraseña y acceder:
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:24px 0">
            <tr>
              <td align="center" style="background:#2563eb;border-radius:8px;padding:12px 32px">
                <a href="${params.inviteUrl}" style="color:#fff;text-decoration:none;font-size:15px;font-weight:500;display:block">Aceptar invitación</a>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:13px;color:#a1a1aa;line-height:1.4">
            Si no esperabas esta invitación, ignora este correo.<br>
            Este enlace expira en 48 horas.
          </p>
        </td></tr>
        <tr><td style="background:#f4f4f5;padding:16px 24px;text-align:center;font-size:12px;color:#a1a1aa">Eval — Plataforma de evaluaciones tipo ICFES</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
