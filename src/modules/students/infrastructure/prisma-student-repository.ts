import type {
  Prisma,
  Student as PrismaStudent,
  StudentEnrollment as PrismaStudentEnrollment,
} from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  CreateStudentData,
  Student,
  StudentRepository,
  UpdateStudentData,
} from "../domain/student";
import type { StudentEnrollment } from "../domain/student-enrollment";

type StudentWithCurrentEnrollment = PrismaStudent & {
  enrollments: PrismaStudentEnrollment[];
};

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

function toStudent(r: StudentWithCurrentEnrollment): Student {
  const current = r.enrollments.find((e) => e.isCurrent) ?? null;
  return {
    id: r.id,
    institutionId: r.institutionId,
    lastName1: r.lastName1,
    lastName2: r.lastName2,
    firstName1: r.firstName1,
    firstName2: r.firstName2,
    idType: r.idType,
    idNumber: r.idNumber,
    code: r.code,
    enrollmentYear: r.enrollmentYear,
    isActive: r.isActive,
    currentEnrollment: current && toEnrollment(current),
  };
}

/** Solo estudiantes no eliminados (soft delete vía deletedAt). */
const notDeleted = { deletedAt: null };

/** Include compartido: trae el enrollment vigente (a lo sumo uno) y el
 *  nombre del grupo en una sola query. */
const withCurrentEnrollment = {
  enrollments: { where: { isCurrent: true }, take: 1 },
} satisfies Prisma.StudentInclude;

export class PrismaStudentRepository implements StudentRepository {
  async findById(institutionId: string, id: string): Promise<Student | null> {
    const row = await prisma.student.findFirst({
      where: { id, institutionId, ...notDeleted },
      include: withCurrentEnrollment,
    });
    return row && toStudent(row);
  }

  async findByCode(institutionId: string, code: string): Promise<Student | null> {
    const row = await prisma.student.findFirst({
      where: { institutionId, code, ...notDeleted },
      include: withCurrentEnrollment,
    });
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
      include: withCurrentEnrollment,
    });
    return student && toStudent(student);
  }

  async findByGroup(institutionId: string, groupId: string): Promise<Student[]> {
    const rows = await prisma.student.findMany({
      where: {
        institutionId,
        ...notDeleted,
        enrollments: { some: { groupId, isCurrent: true } },
      },
      include: withCurrentEnrollment,
      orderBy: [{ lastName1: "asc" }, { lastName2: "asc" }, { firstName1: "asc" }, { firstName2: "asc" }],
    });
    return rows.map(toStudent);
  }

  async findAll(institutionId: string): Promise<Student[]> {
    const rows = await prisma.student.findMany({
      where: { institutionId, ...notDeleted, enrollments: { some: { isCurrent: true } } },
      include: withCurrentEnrollment,
      orderBy: [{ lastName1: "asc" }, { lastName2: "asc" }, { firstName1: "asc" }, { firstName2: "asc" }],
    });
    return rows.map(toStudent);
  }

  async create(institutionId: string, data: CreateStudentData): Promise<Student> {
    // Defensa: el use case siempre inyecta academicYearId antes de llamar al
    // repo. Si llega undefined, es un bug del caller — fallar ruidosamente.
    if (!data.enrollment.academicYearId) {
      throw new Error("CreateStudent: academicYearId is required (use case must inject it)");
    }
    const academicYearId: string = data.enrollment.academicYearId;
    // Transición (cutover): la columna Student.groupId sigue siendo NOT NULL
    // hasta el commit 8 (DROP). Mantenemos sincronizada con enrollment.groupId.
    // Tras commit 8 se pasa `groupId: undefined` y Prisma lo omite.
    const created = await prisma.$transaction(async (tx) => {
      const s = await tx.student.create({
        data: {
          institutionId,
          lastName1: data.lastName1,
          lastName2: data.lastName2,
          firstName1: data.firstName1,
          firstName2: data.firstName2,
          idType: data.idType,
          idNumber: data.idNumber,
          code: data.code,
          enrollmentYear: data.enrollmentYear,
          groupId: data.enrollment.groupId,
          grade: data.enrollment.grade ?? null,
          bookletTypeId: data.enrollment.bookletTypeId ?? null,
        },
      });
      await tx.studentEnrollment.create({
        data: {
          studentId: s.id,
          academicYearId,
          groupId: data.enrollment.groupId,
          grade: data.enrollment.grade ?? null,
          bookletTypeId: data.enrollment.bookletTypeId ?? null,
          isCurrent: true,
        },
      });
      return s.id;
    });
    const reloaded = await this.findById(institutionId, created);
    if (!reloaded) throw new Error("Student vanished immediately after create");
    return reloaded;
  }

  async createMany(institutionId: string, data: CreateStudentData[]): Promise<number> {
    if (data.length === 0) return 0;
    // Defensa: el use case siempre inyecta academicYearId antes de llamar al
    // repo. Si alguna fila llega sin él, es un bug del caller — fallar ruidosamente.
    for (const d of data) {
      if (!d.enrollment.academicYearId) {
        throw new Error(
          "CreateStudent.createMany: academicYearId is required (use case must inject it)",
        );
      }
    }
    // Tipar el array como `academicYearId: string` para satisfacer TS (acima
    // validamos que todas las filas lo traen).
    const rows = data.map((d) => ({
      ...d,
      enrollment: {
        ...d.enrollment,
        academicYearId: d.enrollment.academicYearId as string,
      },
    }));
    return prisma.$transaction(async (tx) => {
      // 1) Bulk-create los estudiantes (groupId/grade/bookletTypeId transitorio
      //    sincronizado con enrollment — ver nota en create()).
      const res = await tx.student.createMany({
        data: rows.map((d) => ({
          institutionId,
          lastName1: d.lastName1,
          lastName2: d.lastName2,
          firstName1: d.firstName1,
          firstName2: d.firstName2,
          idType: d.idType,
          idNumber: d.idNumber,
          code: d.code,
          enrollmentYear: d.enrollmentYear,
          groupId: d.enrollment.groupId,
          grade: d.enrollment.grade ?? null,
          bookletTypeId: d.enrollment.bookletTypeId ?? null,
        })),
      });
      // 2) Re-leer los IDs recién creados (ordenados por código = mismo orden
      //    que el input, porque `code` es único por institución).
      const codes = rows.map((d) => d.code);
      const created = await tx.student.findMany({
        where: { institutionId, code: { in: codes } },
        select: { id: true, code: true },
      });
      const idByCode = new Map(created.map((s) => [s.code, s.id]));
      // 3) Bulk-create los enrollments (uno por estudiante, isCurrent=true).
      await tx.studentEnrollment.createMany({
        data: rows.map((d) => {
          const studentId = idByCode.get(d.code);
          if (!studentId) throw new Error(`Student id missing after bulk create: ${d.code}`);
          return {
            studentId,
            academicYearId: d.enrollment.academicYearId,
            groupId: d.enrollment.groupId,
            grade: d.enrollment.grade ?? null,
            bookletTypeId: d.enrollment.bookletTypeId ?? null,
            isCurrent: true,
          };
        }),
      });
      return res.count;
    });
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
    const enrollmentInput = data.enrollment;
    // Defensa: el use case siempre inyecta academicYearId antes de llamar al
    // repo si enrollment viene presente.
    if (enrollmentInput && !enrollmentInput.academicYearId) {
      throw new Error(
        "UpdateStudent: enrollment.academicYearId is required (use case must inject it)",
      );
    }
    await prisma.$transaction(async (tx) => {
      await tx.student.update({
        where: { id: row.id },
        data: {
          // Transición (cutover): mantener groupId/grade/bookletTypeId en sync
          // con la matrícula. Ver nota en create(). Commit 8 los dropea.
          ...(enrollmentInput
            ? {
                groupId: enrollmentInput.groupId,
                grade: enrollmentInput.grade ?? null,
                bookletTypeId: enrollmentInput.bookletTypeId ?? null,
              }
            : {}),
          lastName1: data.lastName1,
          lastName2: data.lastName2,
          firstName1: data.firstName1,
          firstName2: data.firstName2,
          idType: data.idType,
          idNumber: data.idNumber,
          enrollmentYear: data.enrollmentYear,
          isActive: data.isActive,
        },
      });

      if (enrollmentInput) {
        // Defensa: ya validamos arriba que academicYearId viene presente.
        const academicYearId = enrollmentInput.academicYearId!;
        // Upsert de la matrícula vigente del año académico solicitado.
        // Si ya existe (student, AY), actualiza; si no, crea como isCurrent.
        const existing = await tx.studentEnrollment.findFirst({
          where: { studentId: id, academicYearId },
        });
        if (existing) {
          await tx.studentEnrollment.update({
            where: { id: existing.id },
            data: {
              groupId: enrollmentInput.groupId,
              grade: enrollmentInput.grade ?? null,
              bookletTypeId: enrollmentInput.bookletTypeId ?? null,
            },
          });
        } else {
          // Flip atómico: desmarca previos del mismo estudiante + crea el
          // nuevo como vigente (evita dos filas `isCurrent=true`).
          await tx.studentEnrollment.updateMany({
            where: { studentId: id, isCurrent: true },
            data: { isCurrent: false },
          });
          await tx.studentEnrollment.create({
            data: {
              studentId: id,
              academicYearId,
              groupId: enrollmentInput.groupId,
              grade: enrollmentInput.grade ?? null,
              bookletTypeId: enrollmentInput.bookletTypeId ?? null,
              isCurrent: true,
            },
          });
        }
      }
    });

    const reloaded = await this.findById(institutionId, row.id);
    if (!reloaded) throw new Error("Student vanished immediately after update");
    return reloaded;
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
