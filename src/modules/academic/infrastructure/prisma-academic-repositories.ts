import type {
  AcademicYear as PrismaAcademicYear,
  Course as PrismaCourse,
  Group as PrismaGroup,
  Period as PrismaPeriod,
  Subject as PrismaSubject,
} from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  AcademicYear,
  AcademicYearRepository,
  Course,
  CourseRepository,
  CourseSubject,
  CourseSubjectRepository,
  CourseSubjectView,
  CreateAcademicYearData,
  CreateCourseData,
  CreateCourseSubjectData,
  CreateGroupData,
  CreatePeriodData,
  CreateSubjectData,
  Group,
  GroupRepository,
  Period,
  PeriodRepository,
  Subject,
  SubjectRepository,
  UpdatePeriodData,
} from "../domain/types";

// ===== Mappers (fila Prisma → shape del dominio) =====

const toYear = (r: PrismaAcademicYear): AcademicYear => ({
  id: r.id,
  institutionId: r.institutionId,
  year: r.year,
  startDate: r.startDate,
  endDate: r.endDate,
  isCurrent: r.isCurrent,
});

const toCourse = (r: PrismaCourse): Course => ({
  id: r.id,
  institutionId: r.institutionId,
  academicYearId: r.academicYearId,
  name: r.name,
  code: r.code,
});

const toSubject = (r: PrismaSubject): Subject => ({
  id: r.id,
  institutionId: r.institutionId,
  name: r.name,
  code: r.code,
  shortName: r.shortName,
});

const toGroup = (r: PrismaGroup): Group => ({
  id: r.id,
  institutionId: r.institutionId,
  courseId: r.courseId,
  name: r.name,
});

const toPeriod = (r: PrismaPeriod): Period => ({
  id: r.id,
  institutionId: r.institutionId,
  academicYearId: r.academicYearId,
  name: r.name,
  order: r.order,
  startDate: r.startDate,
  endDate: r.endDate,
  isCurrent: r.isCurrent,
});

// ===== Adaptadores =====

export class PrismaAcademicYearRepository implements AcademicYearRepository {
  async findAll(institutionId: string): Promise<AcademicYear[]> {
    const rows = await prisma.academicYear.findMany({
      where: { institutionId },
      orderBy: { year: "desc" },
    });
    return rows.map(toYear);
  }
  async findById(institutionId: string, id: string): Promise<AcademicYear | null> {
    const row = await prisma.academicYear.findFirst({ where: { id, institutionId } });
    return row && toYear(row);
  }
  async findByYear(institutionId: string, year: number): Promise<AcademicYear | null> {
    const row = await prisma.academicYear.findFirst({ where: { institutionId, year } });
    return row && toYear(row);
  }
  async create(institutionId: string, data: CreateAcademicYearData): Promise<AcademicYear> {
    return toYear(
      await prisma.academicYear.create({
        data: {
          institutionId,
          year: data.year,
          startDate: data.startDate,
          endDate: data.endDate,
          isCurrent: data.isCurrent ?? false,
        },
      }),
    );
  }
  async setCurrent(institutionId: string, id: string): Promise<void> {
    await prisma.$transaction([
      prisma.academicYear.updateMany({
        where: { institutionId, NOT: { id } },
        data: { isCurrent: false },
      }),
      prisma.academicYear.update({ where: { id }, data: { isCurrent: true } }),
    ]);
  }
  async findCurrent(institutionId: string): Promise<AcademicYear | null> {
    const row = await prisma.academicYear.findFirst({
      where: { institutionId, isCurrent: true },
    });
    return row && toYear(row);
  }
}

export class PrismaCourseRepository implements CourseRepository {
  async findAll(institutionId: string, academicYearId?: string): Promise<Course[]> {
    const rows = await prisma.course.findMany({
      where: { institutionId, ...(academicYearId ? { academicYearId } : {}) },
      orderBy: { name: "asc" },
    });
    return rows.map(toCourse);
  }
  async findById(institutionId: string, id: string): Promise<Course | null> {
    const row = await prisma.course.findFirst({ where: { id, institutionId } });
    return row && toCourse(row);
  }
  async create(institutionId: string, data: CreateCourseData): Promise<Course> {
    return toCourse(await prisma.course.create({ data: { institutionId, ...data } }));
  }
}

export class PrismaSubjectRepository implements SubjectRepository {
  async findAllForInstitution(institutionId: string): Promise<Subject[]> {
    const rows = await prisma.subject.findMany({
      where: { OR: [{ institutionId }, { institutionId: null }] },
      orderBy: { name: "asc" },
    });
    return rows.map(toSubject);
  }
  async findById(id: string): Promise<Subject | null> {
    const row = await prisma.subject.findUnique({ where: { id } });
    return row && toSubject(row);
  }
  async create(institutionId: string | null, data: CreateSubjectData): Promise<Subject> {
    return toSubject(
      await prisma.subject.create({
        data: {
          institutionId,
          name: data.name,
          code: data.code,
          shortName: data.shortName ?? null,
        },
      }),
    );
  }
  async updateShortName(id: string, shortName: string | null): Promise<Subject> {
    return toSubject(await prisma.subject.update({ where: { id }, data: { shortName } }));
  }
}

export class PrismaGroupRepository implements GroupRepository {
  async findAll(institutionId: string, courseId?: string): Promise<Group[]> {
    const rows = await prisma.group.findMany({
      where: { institutionId, ...(courseId ? { courseId } : {}) },
      orderBy: { name: "asc" },
    });
    return rows.map(toGroup);
  }
  async findById(institutionId: string, id: string): Promise<Group | null> {
    const row = await prisma.group.findFirst({ where: { id, institutionId } });
    return row && toGroup(row);
  }
  async create(institutionId: string, data: CreateGroupData): Promise<Group> {
    return toGroup(await prisma.group.create({ data: { institutionId, ...data } }));
  }
  async delete(institutionId: string, id: string): Promise<void> {
    await prisma.group.delete({ where: { id, institutionId } });
  }
}

export class PrismaCourseSubjectRepository implements CourseSubjectRepository {
  async findAll(institutionId: string): Promise<CourseSubjectView[]> {
    const rows = await prisma.courseSubject.findMany({
      where: { course: { institutionId } },
      include: { course: { select: { name: true } }, subject: { select: { name: true } } },
      orderBy: [{ course: { name: "asc" } }, { subject: { name: "asc" } }],
    });
    return rows.map((r) => ({
      id: r.id,
      courseId: r.courseId,
      subjectId: r.subjectId,
      courseName: r.course.name,
      subjectName: r.subject.name,
    }));
  }
  async findById(institutionId: string, id: string): Promise<CourseSubject | null> {
    const row = await prisma.courseSubject.findFirst({
      where: { id, course: { institutionId } },
    });
    return row && { id: row.id, courseId: row.courseId, subjectId: row.subjectId };
  }
  async exists(courseId: string, subjectId: string): Promise<boolean> {
    const row = await prisma.courseSubject.findUnique({
      where: { courseId_subjectId: { courseId, subjectId } },
    });
    return row !== null;
  }
  async create(data: CreateCourseSubjectData): Promise<CourseSubject> {
    const row = await prisma.courseSubject.create({ data });
    return { id: row.id, courseId: row.courseId, subjectId: row.subjectId };
  }
  async delete(courseId: string, subjectId: string): Promise<void> {
    await prisma.courseSubject.delete({
      where: { courseId_subjectId: { courseId, subjectId } },
    });
  }
}

export class PrismaPeriodRepository implements PeriodRepository {
  async findAll(institutionId: string, academicYearId?: string): Promise<Period[]> {
    const rows = await prisma.period.findMany({
      where: { institutionId, ...(academicYearId ? { academicYearId } : {}) },
      orderBy: { order: "asc" },
    });
    return rows.map(toPeriod);
  }
  async findById(institutionId: string, id: string): Promise<Period | null> {
    const row = await prisma.period.findFirst({ where: { id, institutionId } });
    return row && toPeriod(row);
  }
  async findByName(institutionId: string, name: string): Promise<Period | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const row = await prisma.period.findFirst({
      where: { institutionId, name: { equals: trimmed, mode: "insensitive" } },
      orderBy: [{ order: "asc" }],
    });
    return row && toPeriod(row);
  }
  async create(institutionId: string, data: CreatePeriodData): Promise<Period> {
    return toPeriod(await prisma.period.create({ data: { institutionId, ...data } }));
  }
  async update(institutionId: string, id: string, data: UpdatePeriodData): Promise<Period | null> {
    // Only the fields present in `data` are touched; absent keys keep their
    // current value. Pre-check + try/catch en el use case traduce P2002 a
    // ConflictError (capa de aplicación no importa @prisma/client).
    const row = await prisma.period.update({
      where: { id, institutionId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.order !== undefined ? { order: data.order } : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate } : {}),
        ...(data.endDate !== undefined ? { endDate: data.endDate } : {}),
      },
    });
    return toPeriod(row);
  }
  async delete(institutionId: string, id: string): Promise<void> {
    await prisma.period.delete({ where: { id, institutionId } });
  }
  async setCurrent(
    institutionId: string,
    academicYearId: string,
    periodId: string,
    isCurrent: boolean,
  ): Promise<void> {
    if (isCurrent) {
      // Flip atómico: desmarcamos las demás del mismo año académico + marcamos esta.
      // Misma transacción para que dos requests concurrentes no terminen con dos pruebas marcadas.
      await prisma.$transaction([
        prisma.period.updateMany({
          where: { institutionId, academicYearId, NOT: { id: periodId } },
          data: { isCurrent: false },
        }),
        prisma.period.update({ where: { id: periodId }, data: { isCurrent: true } }),
      ]);
      return;
    }
    // Unmark: solo desmarca esta. No tocamos las demás — la marca en el
    // mismo año académico puede quedar en otra Prueba (o en ninguna).
    await prisma.period.update({ where: { id: periodId }, data: { isCurrent: false } });
  }
  async findCurrent(institutionId: string, academicYearId: string): Promise<Period | null> {
    const row = await prisma.period.findFirst({
      where: { institutionId, academicYearId, isCurrent: true },
    });
    return row && toPeriod(row);
  }
}
