import type { Student as PrismaStudent } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { CreateStudentData, Student, StudentRepository } from "../domain/student";

function toStudent(r: PrismaStudent): Student {
  return {
    id: r.id,
    institutionId: r.institutionId,
    groupId: r.groupId,
    name: r.name,
    idType: r.idType,
    idNumber: r.idNumber,
    code: r.code,
    enrollmentYear: r.enrollmentYear,
    isActive: r.isActive,
  };
}

/** Solo estudiantes no eliminados (soft delete vía deletedAt). */
const notDeleted = { deletedAt: null };

export class PrismaStudentRepository implements StudentRepository {
  async findById(institutionId: string, id: string): Promise<Student | null> {
    const row = await prisma.student.findFirst({ where: { id, institutionId, ...notDeleted } });
    return row && toStudent(row);
  }

  async findByCode(institutionId: string, code: string): Promise<Student | null> {
    const row = await prisma.student.findFirst({ where: { institutionId, code, ...notDeleted } });
    return row && toStudent(row);
  }

  async findByCodeIncludingHistory(institutionId: string, code: string): Promise<Student | null> {
    const direct = await this.findByCode(institutionId, code);
    if (direct) return direct;
    // El QR viejo debe seguir funcionando: busca en el historial de códigos.
    const history = await prisma.studentCodeHistory.findFirst({
      where: { oldCode: code, student: { institutionId, ...notDeleted } },
      orderBy: { changedAt: "desc" },
    });
    if (!history) return null;
    const student = await prisma.student.findFirst({
      where: { id: history.studentId, ...notDeleted },
    });
    return student && toStudent(student);
  }

  async findByGroup(institutionId: string, groupId: string): Promise<Student[]> {
    const rows = await prisma.student.findMany({
      where: { institutionId, groupId, ...notDeleted },
      orderBy: { name: "asc" },
    });
    return rows.map(toStudent);
  }

  async findAll(institutionId: string): Promise<Student[]> {
    const rows = await prisma.student.findMany({
      where: { institutionId, ...notDeleted },
      orderBy: { name: "asc" },
    });
    return rows.map(toStudent);
  }

  async create(institutionId: string, data: CreateStudentData): Promise<Student> {
    return toStudent(
      await prisma.student.create({
        data: { institutionId, ...data },
      }),
    );
  }

  async createMany(institutionId: string, data: CreateStudentData[]): Promise<number> {
    const res = await prisma.student.createMany({
      data: data.map((d) => ({ institutionId, ...d })),
    });
    return res.count;
  }

  async changeCode(institutionId: string, studentId: string, newCode: string): Promise<void> {
    const student = await prisma.student.findFirstOrThrow({
      where: { id: studentId, institutionId },
    });
    await prisma.$transaction([
      prisma.studentCodeHistory.create({
        data: { studentId, oldCode: student.code, newCode },
      }),
      prisma.student.update({ where: { id: studentId }, data: { code: newCode } }),
    ]);
  }
}
