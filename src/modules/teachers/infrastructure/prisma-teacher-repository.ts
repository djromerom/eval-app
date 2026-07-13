import { RoleType } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CreateTeacherData,
  Teacher,
  TeacherAssignment,
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

  async assign(teacherId: string, courseSubjectId: string): Promise<void> {
    await prisma.teacherSubjectAssignment.create({ data: { teacherId, courseSubjectId } });
  }

  async isAssigned(teacherId: string, courseSubjectId: string): Promise<boolean> {
    const row = await prisma.teacherSubjectAssignment.findUnique({
      where: { teacherId_courseSubjectId: { teacherId, courseSubjectId } },
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
      },
    });
    return rows.map((r) => ({
      id: r.id,
      teacherId: r.teacherId,
      courseSubjectId: r.courseSubjectId,
      courseName: r.courseSubject.course.name,
      subjectName: r.courseSubject.subject.name,
    }));
  }
}
