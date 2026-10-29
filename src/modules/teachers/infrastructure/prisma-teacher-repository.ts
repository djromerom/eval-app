import { RoleType } from "@prisma/client";
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
  ): Promise<boolean> {
    // `findFirst` y no `findUnique`: el unique de la tabla incluye
    // `bookletTypeId`, que es NULLABLE, y en Postgres NULL != NULL — un
    // `findUnique` con null en la clave no es confiable. Además, la
    // asignación "para cualquier tipo" (null) convive con las específicas.
    const row = await prisma.teacherSubjectAssignment.findFirst({
      where: { teacherId, courseSubjectId, bookletTypeId },
    });
    return row !== null;
  }

  async listAssignments(institutionId: string, teacherId?: string): Promise<TeacherAssignment[]> {
    const rows = await prisma.teacherSubjectAssignment.findMany({
      where: {
        teacher: { user: { institutionId } },
        ...(teacherId ? { teacherId } : {}),
      },
      include: {
        courseSubject: {
          include: { course: { select: { name: true } }, subject: { select: { name: true } } },
        },
        bookletType: { include: { period: { select: { name: true } } } },
      },
      orderBy: [
        { courseSubject: { course: { name: "asc" } } },
        { courseSubject: { subject: { name: "asc" } } },
      ],
    });
    return rows.map((r) => ({
      id: r.id,
      teacherId: r.teacherId,
      courseSubjectId: r.courseSubjectId,
      courseName: r.courseSubject.course.name,
      subjectName: r.courseSubject.subject.name,
      bookletTypeId: r.bookletTypeId,
      bookletTypeName: r.bookletType?.name ?? null,
      periodName: r.bookletType?.period.name ?? null,
    }));
  }
}
