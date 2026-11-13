import type { Student as PrismaStudent } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CreateStudentData,
  Student,
  StudentRepository,
  StudentRosterPatch,
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
    grade: r.grade,
    bookletTypeId: r.bookletTypeId,
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
      orderBy: [
        { lastName1: "asc" },
        { lastName2: "asc" },
        { firstName1: "asc" },
        { firstName2: "asc" },
      ],
    });
    return rows.map(toStudent);
  }

  async findAll(institutionId: string): Promise<Student[]> {
    const rows = await prisma.student.findMany({
      where: { institutionId, ...notDeleted },
      orderBy: [
        { lastName1: "asc" },
        { lastName2: "asc" },
        { firstName1: "asc" },
        { firstName2: "asc" },
      ],
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

  /**
   * Actualización masiva del roster (import modo "actualizar"). Solo escribe
   * los campos que el parche trae: `code`, `groupId`, `isActive` y
   * `deletedAt` NO se tocan — así la historia de las pruebas anteriores
   * (hojas de respuesta, QR, informes por grupo) queda intacta.
   *
   * Va por lotes para no abrir miles de transacciones: cada lote es una
   * transacción con un `updateMany` por estudiante (con filtro de
   * institución y de baja lógica, por si la fila cambió entre la lectura y
   * la escritura).
   */
  async applyRosterPatches(institutionId: string, patches: StudentRosterPatch[]): Promise<number> {
    if (patches.length === 0) return 0;
    const LOTE = 250;
    let actualizados = 0;
    for (let i = 0; i < patches.length; i += LOTE) {
      const lote = patches.slice(i, i + LOTE);
      const ops = lote.map((p) =>
        prisma.student.updateMany({
          where: { id: p.id, institutionId, ...notDeleted },
          data: {
            ...(p.lastName1 !== undefined ? { lastName1: p.lastName1 } : {}),
            ...(p.lastName2 !== undefined ? { lastName2: p.lastName2 } : {}),
            ...(p.firstName1 !== undefined ? { firstName1: p.firstName1 } : {}),
            ...(p.firstName2 !== undefined ? { firstName2: p.firstName2 } : {}),
            ...(p.idType !== undefined ? { idType: p.idType } : {}),
            ...(p.idNumber !== undefined ? { idNumber: p.idNumber } : {}),
            ...(p.enrollmentYear !== undefined ? { enrollmentYear: p.enrollmentYear } : {}),
            ...(p.grade !== undefined ? { grade: p.grade } : {}),
            ...(p.bookletTypeId !== undefined ? { bookletTypeId: p.bookletTypeId } : {}),
          },
        }),
      );
      const res = await prisma.$transaction(ops);
      actualizados += res.reduce((acc, r) => acc + r.count, 0);
    }
    return actualizados;
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
          grade: data.grade ?? null,
          bookletTypeId: data.bookletTypeId ?? null,
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
