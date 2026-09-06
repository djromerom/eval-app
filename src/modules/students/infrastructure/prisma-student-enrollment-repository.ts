import type { StudentEnrollment as PrismaStudentEnrollment } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CreateStudentEnrollmentData,
  StudentEnrollment,
  StudentEnrollmentRepository,
  UpdateStudentEnrollmentData,
} from "../domain/student-enrollment";

function toEnrollment(r: PrismaStudentEnrollment): StudentEnrollment {
  return {
    id: r.id,
    studentId: r.studentId,
    academicYearId: r.academicYearId,
    groupId: r.groupId,
    grade: r.grade,
    bookletTypeId: r.bookletTypeId,
    isCurrent: r.isCurrent,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class PrismaStudentEnrollmentRepository implements StudentEnrollmentRepository {
  async findById(institutionId: string, id: string): Promise<StudentEnrollment | null> {
    const row = await prisma.studentEnrollment.findFirst({
      where: { id, student: { institutionId } },
    });
    return row && toEnrollment(row);
  }

  async findCurrentByStudent(
    institutionId: string,
    studentId: string,
  ): Promise<StudentEnrollment | null> {
    const row = await prisma.studentEnrollment.findFirst({
      where: { studentId, isCurrent: true, student: { institutionId } },
    });
    return row && toEnrollment(row);
  }

  async findByStudentAndYear(
    institutionId: string,
    studentId: string,
    academicYearId: string,
  ): Promise<StudentEnrollment | null> {
    const row = await prisma.studentEnrollment.findFirst({
      where: { studentId, academicYearId, student: { institutionId } },
    });
    return row && toEnrollment(row);
  }

  async findCurrentByGroup(
    institutionId: string,
    groupId: string,
    academicYearId?: string,
  ): Promise<StudentEnrollment[]> {
    const rows = await prisma.studentEnrollment.findMany({
      where: {
        groupId,
        isCurrent: true,
        student: {
          institutionId,
          ...(academicYearId
            ? {/* no filter at enrollment level — caller passes AY for doc purposes */}
            : {}),
        },
        ...(academicYearId ? { academicYearId } : {}),
      },
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.map(toEnrollment);
  }

  async findHistoryByStudent(
    institutionId: string,
    studentId: string,
  ): Promise<StudentEnrollment[]> {
    const rows = await prisma.studentEnrollment.findMany({
      where: { studentId, student: { institutionId } },
      orderBy: [{ academicYearId: "asc" }],
    });
    return rows.map(toEnrollment);
  }

  async create(
    institutionId: string,
    data: CreateStudentEnrollmentData,
  ): Promise<StudentEnrollment> {
    return toEnrollment(
      await prisma.$transaction(async (tx) => {
        // Flip atómico: desmarca los previos del estudiante y crea el nuevo
        // como vigente. Evita el caso "dos filas isCurrent=true" si el
        // caller no llamó setCurrent primero.
        await tx.studentEnrollment.updateMany({
          where: { studentId: data.studentId, isCurrent: true },
          data: { isCurrent: false },
        });
        return tx.studentEnrollment.create({
          data: {
            studentId: data.studentId,
            academicYearId: data.academicYearId,
            groupId: data.groupId,
            grade: data.grade ?? null,
            bookletTypeId: data.bookletTypeId ?? null,
            isCurrent: true,
          },
        });
      }),
    );
  }

  async createMany(institutionId: string, data: CreateStudentEnrollmentData[]): Promise<number> {
    if (data.length === 0) return 0;
    // Una sola transacción por lote: para cada estudiante, desmarca previos
    // y crea la fila vigente. Si el mismo `studentId` aparece dos veces en
    // el lote, gana la última (la transacción corre en orden).
    return prisma.$transaction(async (tx) => {
      const uniqueStudentIds = Array.from(new Set(data.map((d) => d.studentId)));
      await tx.studentEnrollment.updateMany({
        where: { studentId: { in: uniqueStudentIds }, isCurrent: true },
        data: { isCurrent: false },
      });
      const res = await tx.studentEnrollment.createMany({
        data: data.map((d) => ({
          studentId: d.studentId,
          academicYearId: d.academicYearId,
          groupId: d.groupId,
          grade: d.grade ?? null,
          bookletTypeId: d.bookletTypeId ?? null,
          isCurrent: true,
        })),
      });
      return res.count;
    });
  }

  async update(
    institutionId: string,
    id: string,
    data: UpdateStudentEnrollmentData,
  ): Promise<StudentEnrollment> {
    // findFirstOrThrow con filtro de institución garantiza que un id de
    // otra institución devuelve P2025 (not found).
    const row = await prisma.studentEnrollment.findFirstOrThrow({
      where: { id, student: { institutionId } },
    });
    return toEnrollment(
      await prisma.studentEnrollment.update({
        where: { id: row.id },
        data: {
          ...(data.groupId !== undefined ? { groupId: data.groupId } : {}),
          ...(data.grade !== undefined ? { grade: data.grade } : {}),
          ...(data.bookletTypeId !== undefined ? { bookletTypeId: data.bookletTypeId } : {}),
        },
      }),
    );
  }

  async setCurrent(institutionId: string, id: string): Promise<void> {
    const target = await prisma.studentEnrollment.findFirstOrThrow({
      where: { id, student: { institutionId } },
    });
    await prisma.$transaction([
      prisma.studentEnrollment.updateMany({
        where: { studentId: target.studentId, isCurrent: true, NOT: { id } },
        data: { isCurrent: false },
      }),
      prisma.studentEnrollment.update({ where: { id }, data: { isCurrent: true } }),
    ]);
  }
}
