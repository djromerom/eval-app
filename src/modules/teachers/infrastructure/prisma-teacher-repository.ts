import { Prisma, RoleType } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CreateTeacherData,
  Teacher,
  TeacherAssignment,
  TeacherProfileData,
  TeacherRepository,
} from "../domain/teacher";

type TeacherWithUser = {
  id: string;
  userId: string;
  idType: string;
  idNumber: string;
  phone: string | null;
  user: { name: string; email: string; institutionId: string; isActive: boolean };
};

function toTeacher(r: TeacherWithUser): Teacher {
  return {
    id: r.id,
    userId: r.userId,
    institutionId: r.user.institutionId,
    name: r.user.name,
    email: r.user.email,
    idType: r.idType,
    idNumber: r.idNumber,
    phone: r.phone,
    isActive: r.user.isActive,
  };
}

const withUser = {
  user: { select: { name: true, email: true, institutionId: true, isActive: true } },
} as const;

/** Relaciones que trae una asignación: grado (con su año académico),
 *  asignatura y el tipo de cuadernillo con su Prueba. */
const assignmentInclude = {
  courseSubject: {
    include: {
      course: { select: { name: true, academicYearId: true } },
      subject: { select: { name: true } },
    },
  },
  bookletType: { include: { period: { select: { name: true } } } },
} as const;

type AssignmentWithRelations = Prisma.TeacherSubjectAssignmentGetPayload<{
  include: typeof assignmentInclude;
}>;

function toTeacherAssignment(r: AssignmentWithRelations): TeacherAssignment {
  return {
    id: r.id,
    teacherId: r.teacherId,
    courseSubjectId: r.courseSubjectId,
    courseName: r.courseSubject.course.name,
    subjectName: r.courseSubject.subject.name,
    bookletTypeId: r.bookletTypeId,
    bookletTypeName: r.bookletType?.name ?? null,
    periodName: r.bookletType?.period.name ?? null,
    academicYearId: r.courseSubject.course.academicYearId,
  };
}

export class PrismaTeacherRepository implements TeacherRepository {
  async findAll(institutionId: string): Promise<Teacher[]> {
    const rows = await prisma.teacher.findMany({
      where: { user: { institutionId, deletedAt: null } },
      include: withUser,
      orderBy: { user: { name: "asc" } },
    });
    return rows.map(toTeacher);
  }

  async findById(institutionId: string, id: string): Promise<Teacher | null> {
    const row = await prisma.teacher.findFirst({
      where: { id, user: { institutionId, deletedAt: null } },
      include: withUser,
    });
    return row && toTeacher(row);
  }

  async findByUserId(institutionId: string, userId: string): Promise<Teacher | null> {
    const row = await prisma.teacher.findFirst({
      where: { userId, user: { institutionId, deletedAt: null } },
      include: withUser,
    });
    return row && toTeacher(row);
  }

  async emailTaken(email: string): Promise<boolean> {
    const row = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    return row !== null;
  }

  async idNumberTakenInInstitution(
    institutionId: string,
    idType: string,
    idNumber: string,
  ): Promise<boolean> {
    const row = await prisma.teacher.findFirst({
      where: {
        idType,
        idNumber,
        user: { institutionId, deletedAt: null },
      },
      select: { id: true },
    });
    return row !== null;
  }

  async createProfileForUser(userId: string, data: TeacherProfileData): Promise<Teacher> {
    const row = await prisma.teacher.create({
      data: { userId, idType: data.idType, idNumber: data.idNumber, phone: data.phone },
      include: withUser,
    });
    return toTeacher(row);
  }

  async updateProfile(teacherId: string, data: TeacherProfileData): Promise<Teacher> {
    const row = await prisma.teacher.update({
      where: { id: teacherId },
      data: { idType: data.idType, idNumber: data.idNumber, phone: data.phone },
      include: withUser,
    });
    return toTeacher(row);
  }

  async createWithUser(institutionId: string, data: CreateTeacherData): Promise<Teacher> {
    const row = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          institutionId,
          email: data.email,
          name: data.name,
          isActive: false, // invitado hasta que ingrese
          roles: { create: { role: RoleType.TEACHER } },
        },
      });
      return tx.teacher.create({
        data: {
          userId: user.id,
          idType: data.idType,
          idNumber: data.idNumber,
          phone: data.phone ?? null,
        },
        include: withUser,
      });
    });
    return toTeacher(row);
  }

  async setInviteToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { inviteToken: tokenHash, inviteTokenExpiresAt: expiresAt },
    });
  }

  async assign(
    teacherId: string,
    courseSubjectId: string,
    bookletTypeId: string | null,
  ): Promise<void> {
    await prisma.teacherSubjectAssignment.create({
      data: { teacherId, courseSubjectId, bookletTypeId },
    });
  }

  async isAssigned(
    teacherId: string,
    courseSubjectId: string,
    bookletTypeId: string | null,
    excludeAssignmentId?: string,
  ): Promise<boolean> {
    // `findFirst` y no `findUnique`: el unique de la tabla incluye
    // `bookletTypeId`, que es NULLABLE, y en Postgres NULL != NULL — un
    // `findUnique` con null en la clave no es confiable. Además, la
    // asignación "para cualquier tipo" (null) convive con las específicas.
    const row = await prisma.teacherSubjectAssignment.findFirst({
      where: {
        teacherId,
        courseSubjectId,
        bookletTypeId,
        // Al editar, la asignación en curso no cuenta como duplicado.
        ...(excludeAssignmentId ? { id: { not: excludeAssignmentId } } : {}),
      },
    });
    return row !== null;
  }

  async findAssignmentById(
    institutionId: string,
    assignmentId: string,
  ): Promise<TeacherAssignment | null> {
    const row = await prisma.teacherSubjectAssignment.findFirst({
      where: { id: assignmentId, teacher: { user: { institutionId } } },
      include: assignmentInclude,
    });
    return row ? toTeacherAssignment(row) : null;
  }

  async updateAssignmentType(
    institutionId: string,
    assignmentId: string,
    bookletTypeId: string | null,
  ): Promise<void> {
    // El scoping va en el propio UPDATE (no solo en la lectura previa): si la
    // asignación no pertenece a la institución del actor, no se toca nada.
    const { count } = await prisma.teacherSubjectAssignment.updateMany({
      where: { id: assignmentId, teacher: { user: { institutionId } } },
      data: { bookletTypeId },
    });
    if (count === 0) {
      throw new Error(
        `Asignación ${assignmentId} no encontrada en la institución ${institutionId}`,
      );
    }
  }

  async deleteAssignment(institutionId: string, assignmentId: string): Promise<void> {
    // Scoping en el propio DELETE: si la asignación no es de la institución
    // del actor, no se borra nada.
    const { count } = await prisma.teacherSubjectAssignment.deleteMany({
      where: { id: assignmentId, teacher: { user: { institutionId } } },
    });
    if (count === 0) {
      throw new Error(
        `Asignación ${assignmentId} no encontrada en la institución ${institutionId}`,
      );
    }
  }

  async listAssignments(institutionId: string, teacherId?: string): Promise<TeacherAssignment[]> {
    const rows = await prisma.teacherSubjectAssignment.findMany({
      where: {
        teacher: { user: { institutionId } },
        ...(teacherId ? { teacherId } : {}),
      },
      include: assignmentInclude,
      orderBy: [
        { courseSubject: { course: { name: "asc" } } },
        { courseSubject: { subject: { name: "asc" } } },
      ],
    });
    return rows.map(toTeacherAssignment);
  }
}
