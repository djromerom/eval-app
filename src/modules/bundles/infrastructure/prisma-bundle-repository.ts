import {
  type BundleStatus as PrismaBundleStatus,
  type EvaluationBundle as PrismaBundle,
  type EvaluationBundleItem as PrismaBundleItem,
  DraftStatus,
  type Prisma,
} from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type {
  AddItemInput,
  Bundle,
  BundleDetail,
  BundleItem,
  BundleItemDetail,
  BundleRepository,
  CreateBundleData,
  UpdateBundleData,
} from "../domain/bundle";
import type { BundleStatus } from "../domain/bundle-status";

// El curso se carga siempre por join (nullable): `courseName` alimenta la
// portada del PDF y los listados sin obligar a un segundo query.
// Sprint Bundle-Period: también se cargan `period` y `bookletType` por join
// (nullable, nullable) para alimentar las columnas Prueba/Tipo del listado
// y el header del detalle sin un query extra.
type BundleRow = PrismaBundle & {
  course?: { name: string } | null;
  period?: { name: string } | null;
  bookletType?: { name: string } | null;
};

type BundleItemRow = PrismaBundleItem & {
  evaluation: {
    id: string;
    title: string;
    status: DraftStatus;
    totalQuestions: number;
    durationMinutes: number | null;
    institutionId: string;
    courseSubject: {
      courseId: string;
      course: { name: string };
      subject: {
        id: string;
        name: string;
        isArea: boolean;
        parentSubjectId: string | null;
        parentSubject: { id: string; name: string } | null;
      };
    };
    bookletType: { id: string; name: string } | null;
  };
};

function toBundle(row: BundleRow): Bundle {
  return {
    id: row.id,
    institutionId: row.institutionId,
    name: row.name,
    bookletNumber: row.bookletNumber,
    courseId: row.courseId,
    courseName: row.course?.name ?? null,
    periodId: row.periodId,
    periodName: row.period?.name ?? null,
    bookletTypeId: row.bookletTypeId,
    bookletTypeName: row.bookletType?.name ?? null,
    status: row.status as BundleStatus,
    theme: row.theme,
    coverContent: row.coverContent,
    createdById: row.createdById,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toItemDetail(row: BundleItemRow): BundleItemDetail {
  const subj = row.evaluation.courseSubject.subject;
  return {
    id: row.id,
    bundleId: row.bundleId,
    evaluationId: row.evaluationId,
    order: row.order,
    evaluationTitle: row.evaluation.title,
    evaluationStatus: row.evaluation.status,
    totalQuestions: row.evaluation.totalQuestions,
    durationMinutes: row.evaluation.durationMinutes,
    subjectName: subj.name,
    subjectIsArea: subj.isArea,
    parentSubjectId: subj.parentSubjectId,
    parentSubjectName: subj.parentSubject?.name ?? null,
    courseId: row.evaluation.courseSubject.courseId,
    courseName: row.evaluation.courseSubject.course.name,
    bookletTypeId: row.evaluation.bookletType?.id ?? null,
    bookletTypeName: row.evaluation.bookletType?.name ?? null,
  };
}

export class PrismaBundleRepository implements BundleRepository {
  async create(
    institutionId: string,
    createdById: string,
    data: CreateBundleData,
    evaluationsById: Map<
      string,
      {
        id: string;
        title: string;
        status: string;
        totalQuestions: number;
        durationMinutes: number | null;
        institutionId: string;
        subjectId: string;
        subjectName: string;
        subjectIsArea: boolean;
        parentSubjectId: string | null;
        parentSubjectName: string | null;
        courseId: string;
        courseName: string;
        bookletTypeId: string | null;
        bookletTypeName: string | null;
      }
    >,
  ): Promise<Bundle> {
    return prisma.$transaction(async (tx) => {
      const bundle = await tx.evaluationBundle.create({
        data: {
          institutionId,
          createdById,
          name: data.name,
          bookletNumber: data.bookletNumber ?? null,
          courseId: data.courseId ?? null,
          periodId: data.periodId ?? null,
          bookletTypeId: data.bookletTypeId ?? null,
          theme: (data.theme ?? null) as Prisma.InputJsonValue,
        },
        include: {
          course: { select: { name: true } },
          period: { select: { name: true } },
          bookletType: { select: { name: true } },
        },
      });

      // Insertar items en el orden dado por el caller. Reordenamos por el
      // orden de aparición en data.evaluationIds (1-based).
      let order = 1;
      for (const evId of data.evaluationIds) {
        if (!evaluationsById.has(evId)) {
          throw new Error(
            `Evaluation ${evId} no encontrada en evaluationsById; bug en CreateBundle`,
          );
        }
        await tx.evaluationBundleItem.create({
          data: {
            bundleId: bundle.id,
            evaluationId: evId,
            order: order++,
          },
        });
      }

      return toBundle(bundle);
    });
  }

  async findById(institutionId: string, id: string): Promise<Bundle | null> {
    const row = await prisma.evaluationBundle.findFirst({
      where: { id, institutionId },
      include: {
        course: { select: { name: true } },
        period: { select: { name: true } },
        bookletType: { select: { name: true } },
      },
    });
    return row && toBundle(row);
  }

  async findDetail(institutionId: string, id: string): Promise<BundleDetail | null> {
    const row = await prisma.evaluationBundle.findFirst({
      where: { id, institutionId },
      include: {
        items: { orderBy: { order: "asc" } },
        course: { select: { name: true } },
        period: { select: { name: true } },
        bookletType: { select: { name: true } },
      },
    });
    if (!row) return null;

    const detailItems = await this.listItemsOrderedInternal(row.id);
    const totalQuestions = detailItems.reduce((acc, i) => acc + i.totalQuestions, 0);

    return {
      ...toBundle(row),
      items: detailItems,
      totalQuestions,
    };
  }

  async findAll(institutionId: string, filters?: {
    periodId?: string;
    bookletTypeId?: string;
    status?: BundleStatus;
  }): Promise<Bundle[]> {
    const rows = await prisma.evaluationBundle.findMany({
      where: {
        institutionId,
        ...(filters?.periodId !== undefined ? { periodId: filters.periodId } : {}),
        ...(filters?.bookletTypeId !== undefined ? { bookletTypeId: filters.bookletTypeId } : {}),
        ...(filters?.status !== undefined ? { status: filters.status as PrismaBundleStatus } : {}),
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: {
        course: { select: { name: true } },
        period: { select: { name: true } },
        bookletType: { select: { name: true } },
      },
    });
    return rows.map(toBundle);
  }

  async findByCourseIds(institutionId: string, courseIds: string[]): Promise<Bundle[]> {
    if (courseIds.length === 0) return [];
    const rows = await prisma.evaluationBundle.findMany({
      where: { institutionId, courseId: { in: courseIds } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: {
        course: { select: { name: true } },
        period: { select: { name: true } },
        bookletType: { select: { name: true } },
      },
    });
    return rows.map(toBundle);
  }

  async update(institutionId: string, id: string, data: UpdateBundleData): Promise<Bundle> {
    const row = await prisma.evaluationBundle.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.bookletNumber !== undefined ? { bookletNumber: data.bookletNumber } : {}),
        ...(data.courseId !== undefined ? { courseId: data.courseId } : {}),
        ...(data.periodId !== undefined ? { periodId: data.periodId } : {}),
        ...(data.bookletTypeId !== undefined ? { bookletTypeId: data.bookletTypeId } : {}),
        ...(data.theme !== undefined
          ? { theme: (data.theme ?? null) as Prisma.InputJsonValue }
          : {}),
        ...(data.coverContent !== undefined
          ? { coverContent: (data.coverContent ?? null) as Prisma.InputJsonValue }
          : {}),
      },
      include: {
        course: { select: { name: true } },
        period: { select: { name: true } },
        bookletType: { select: { name: true } },
      },
    });
    // Doble check institutionId para evitar leaks.
    if (row.institutionId !== institutionId) {
      throw new Error(`Bundle ${id} no pertenece a la institución ${institutionId}`);
    }
    return toBundle(row);
  }

  async delete(institutionId: string, id: string): Promise<void> {
    await prisma.evaluationBundle.deleteMany({ where: { id, institutionId } });
  }

  async listItemsOrdered(bundleId: string): Promise<BundleItemDetail[]> {
    return this.listItemsOrderedInternal(bundleId);
  }

  private async listItemsOrderedInternal(bundleId: string): Promise<BundleItemDetail[]> {
    const rows = await prisma.evaluationBundleItem.findMany({
      where: { bundleId },
      orderBy: { order: "asc" },
      include: {
        evaluation: {
          select: {
            id: true,
            title: true,
            status: true,
            totalQuestions: true,
            durationMinutes: true,
            institutionId: true,
            courseSubject: {
              select: {
                courseId: true,
                course: { select: { name: true } },
                subject: {
                  select: {
                    id: true,
                    name: true,
                    isArea: true,
                    parentSubjectId: true,
                    parentSubject: { select: { id: true, name: true } },
                  },
                },
              },
            },
            bookletType: { select: { id: true, name: true } },
          },
        },
      },
    });
    return rows.map(toItemDetail);
  }

  async addItem(institutionId: string, bundleId: string, data: AddItemInput): Promise<BundleItem> {
    // Para el append usamos `max(order) + 1`, NO `count + 1` — si los items
    // quedan con orders no contiguos (típico tras una eliminación intermedia),
    // `count + 1` apuntaría a un slot ya ocupado y dispararía
    // `Unique constraint failed on (bundleId, order)`. Con max+1 siempre
    // cae en un slot libre. Mismo fix que en `InMemoryBundleRepository.addItem`
    // para mantener paridad de comportamiento entre tests y prod.
    let order = data.order;
    if (order === undefined) {
      const max = await prisma.evaluationBundleItem.aggregate({
        where: { bundleId },
        _max: { order: true },
      });
      order = (max._max.order ?? 0) + 1;
    }
    // Verificamos pertenencia vía el bundle.
    await prisma.evaluationBundle.findFirstOrThrow({ where: { id: bundleId, institutionId } });
    const row = await prisma.evaluationBundleItem.create({
      data: {
        bundleId,
        evaluationId: data.evaluationId,
        order,
      },
    });
    return {
      id: row.id,
      bundleId: row.bundleId,
      evaluationId: row.evaluationId,
      order: row.order,
    };
  }

  async removeItem(institutionId: string, bundleId: string, itemId: string): Promise<boolean> {
    // Verificamos pertenencia vía el bundle antes de borrar.
    const bundle = await prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: { id: true },
    });
    if (!bundle) return false;
    const result = await prisma.evaluationBundleItem.deleteMany({
      where: { id: itemId, bundleId },
    });
    return result.count > 0;
  }

  async reorderItems(institutionId: string, bundleId: string, itemIds: string[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.evaluationBundle.findFirstOrThrow({
        where: { id: bundleId, institutionId },
      });

      // Validación: la lista de ids debe coincidir 1-a-1 con los items del bundle
      // (mismo set, ningún duplicado). Evita mover/duplicar items sin querer.
      const existing = await tx.evaluationBundleItem.findMany({
        where: { bundleId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((r) => r.id));
      if (existingIds.size !== itemIds.length) {
        throw new Error(
          `reorderItems: expected ${existingIds.size} items but received ${itemIds.length}`,
        );
      }
      for (const id of itemIds) {
        if (!existingIds.has(id)) {
          throw new Error(`reorderItems: item ${id} does not belong to bundle ${bundleId}`);
        }
      }

      // Two-phase update: el constraint @@unique([bundleId, order]) impide
      // renumerar in-place cuando algún item "baja" (p.ej. revertir [1,2,3]
      // → [3,2,1]: al setear id3.order=1 colisiona con id1.order=1 que aún no
      // fue renumerado). Pasada 1: llevamos todos los items a un rango negativo
      // que no colisiona con el actual. Pasada 2: aplicamos el orden final
      // 1-based sobre ese rango ya libre.
      let i = 0;
      for (const id of itemIds) {
        await tx.evaluationBundleItem.update({
          where: { id },
          data: { order: -1 - i++ },
        });
      }
      let order = 1;
      for (const id of itemIds) {
        await tx.evaluationBundleItem.update({
          where: { id },
          data: { order: order++ },
        });
      }
    });
  }

  async setStatus(institutionId: string, id: string, status: BundleStatus): Promise<void> {
    await prisma.evaluationBundle.updateMany({
      where: { id, institutionId },
      data: { status: status as PrismaBundleStatus },
    });
  }

  async findEvaluationsByIds(
    institutionId: string,
    evaluationIds: string[],
  ): Promise<
    Array<{
      id: string;
      title: string;
      status: string;
      totalQuestions: number;
      durationMinutes: number | null;
      institutionId: string;
      subjectId: string;
      subjectName: string;
      subjectIsArea: boolean;
      parentSubjectId: string | null;
      parentSubjectName: string | null;
      courseId: string;
      courseName: string;
      bookletTypeId: string | null;
      bookletTypeName: string | null;
    }>
  > {
    if (evaluationIds.length === 0) return [];
    const rows = await prisma.evaluation.findMany({
      where: { id: { in: evaluationIds }, institutionId, deletedAt: null },
      select: {
        id: true,
        title: true,
        status: true,
        totalQuestions: true,
        durationMinutes: true,
        institutionId: true,
        courseSubject: {
          select: {
            courseId: true,
            course: { select: { name: true } },
            subject: {
              select: {
                id: true,
                name: true,
                isArea: true,
                parentSubjectId: true,
                parentSubject: { select: { id: true, name: true } },
              },
            },
          },
        },
        bookletType: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      totalQuestions: r.totalQuestions,
      durationMinutes: r.durationMinutes,
      institutionId: r.institutionId,
      subjectId: r.courseSubject.subject.id,
      subjectName: r.courseSubject.subject.name,
      subjectIsArea: r.courseSubject.subject.isArea,
      parentSubjectId: r.courseSubject.subject.parentSubjectId,
      parentSubjectName: r.courseSubject.subject.parentSubject?.name ?? null,
      courseId: r.courseSubject.courseId,
      courseName: r.courseSubject.course.name,
      bookletTypeId: r.bookletType?.id ?? null,
      bookletTypeName: r.bookletType?.name ?? null,
    }));
  }
}
