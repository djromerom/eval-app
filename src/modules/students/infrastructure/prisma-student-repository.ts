import type { Student as PrismaStudent } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CreateStudentData,
  Student,
  StudentRepository,
  UpdateStudentData,
} from "../domain/student";

function toStudent(r: PrismaStudent): Student {
  return {
    id: r.id,
    institutionId: r.institutionId,
    groupId: r.groupId,
    lastName1: r.lastName1,
    lastName2: r.lastName2,
    firstName1: r.firstName1,
    firstName2: r.firstName2,
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
      orderBy: [{ lastName1: "asc" }, { lastName2: "asc" }, { firstName1: "asc" }, { firstName2: "asc" }],
    });
    return rows.map(toStudent);
  }

  async findAll(institutionId: string): Promise<Student[]> {
    const rows = await prisma.student.findMany({
      where: { institutionId, ...notDeleted },
      orderBy: [{ lastName1: "asc" }, { lastName2: "asc" }, { firstName1: "asc" }, { firstName2: "asc" }],
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

  async update(institutionId: string, id: string, data: UpdateStudentData): Promise<Student> {
    // `findFirstOrThrow` con filtro de institución + deletedAt garantiza
    // que un id de otra institución o ya borrado devuelve P2025 (not found).
    const row = await prisma.student.findFirstOrThrow({
      where: { id, institutionId, ...notDeleted },
    });
    return toStudent(
      await prisma.student.update({
        where: { id: row.id },
        data: {
          groupId: data.groupId,
          lastName1: data.lastName1,
          lastName2: data.lastName2,
          firstName1: data.firstName1,
          firstName2: data.firstName2,
          idType: data.idType,
          idNumber: data.idNumber,
          enrollmentYear: data.enrollmentYear,
          isActive: data.isActive,
        },
      }),
    );
  }

  async softDelete(institutionId: string, id: string): Promise<void> {
    // Marca deletedAt y baja isActive — preserva el historial de códigos
    // (los QR viejos deben seguir funcionando aunque el estudiante se dé de baja).
    await prisma.student.update({
      where: { id, institutionId },
      data: { deletedAt: new Date(), isActive: false },
    });
  }
}
