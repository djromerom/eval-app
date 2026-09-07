import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  AddItemInput,
  Bundle,
  BundleDetail,
  BundleItem,
  BundleItemDetail,
  BundleRepository,
  CreateBundleData,
  UpdateBundleData,
} from "@/modules/bundles/domain/bundle";
import type { BundleStatus } from "@/modules/bundles/domain/bundle-status";
import type {
  AcademicYear,
  AcademicYearRepository,
  Course,
  CourseRepository,
  CreateAcademicYearData,
  CreateCourseData,
  CreatePeriodData,
  Period,
  PeriodRepository,
  UpdatePeriodData,
} from "@/modules/academic/domain/types";
import type {
  BookletType,
  BookletTypeRepository,
  CreateBookletTypeData,
  UpdateBookletTypeData,
} from "@/modules/booklet-types/domain/booklet-type";

/**
 * Catálogo de cursos compartido por los tests de bundles (Sprint 9).
 * Los IDs son estables para que los specs puedan referirlos por nombre.
 */
export const COURSES: Record<string, { id: string; name: string; institutionId: string }> = {
  "course-6": { id: "course-6", name: "6°", institutionId: "inst-1" },
  "course-11": { id: "course-11", name: "11°", institutionId: "inst-1" },
  // Curso de OTRA institución: sirve para probar el aislamiento multi-tenant.
  "course-otra": { id: "course-otra", name: "9°", institutionId: "inst-2" },
};

export function courseNameOf(courseId: string): string {
  return COURSES[courseId]?.name ?? courseId;
}

/**
 * Repo de cursos en memoria para los use cases que validan `bundle.courseId`.
 * Replica el filtro por `institutionId` del adaptador Prisma: un curso de
 * otra institución es indistinguible de uno inexistente.
 */
export class InMemoryCourseRepository implements CourseRepository {
  async findAll(institutionId: string): Promise<Course[]> {
    return Object.values(COURSES)
      .filter((c) => c.institutionId === institutionId)
      .map(toCourse);
  }
  async findById(institutionId: string, id: string): Promise<Course | null> {
    const c = COURSES[id];
    return c && c.institutionId === institutionId ? toCourse(c) : null;
  }
  async create(_institutionId: string, _data: CreateCourseData): Promise<Course> {
    throw new Error("no usado en tests de bundles");
  }
}

/** Instancia compartida: el catálogo es inmutable, no hay estado por test. */
export const courses = new InMemoryCourseRepository();

/**
 * Sprint Bundle-Period (sep 2026): repos en memoria compartidos para que
 * los tests de CreateBundle/UpdateBundle/ListBundles puedan cablear las
 * nuevas dependencias (AcademicYear, Period, BookletType). Mantienen el
 * contrato de los puertos — los use cases los ejercitan igual que con el
 * adaptador Prisma.
 *
 * Cada test que necesite estado sembrado crea su propia instancia
 * (`new InMemoryAcademicYearRepository()`); para los casos por defecto
 * (sin año actual / sin periodo / sin bookletTypes) se ofrecen singletons
 * `years` / `periods` / `bookletTypes`.
 */
export class InMemoryAcademicYearRepository implements AcademicYearRepository {
  items: AcademicYear[] = [];
  async findAll(institutionId: string): Promise<AcademicYear[]> {
    return this.items.filter((y) => y.institutionId === institutionId);
  }
  async findById(institutionId: string, id: string): Promise<AcademicYear | null> {
    return this.items.find((y) => y.institutionId === institutionId && y.id === id) ?? null;
  }
  async findByYear(institutionId: string, year: number): Promise<AcademicYear | null> {
    return this.items.find((y) => y.institutionId === institutionId && y.year === year) ?? null;
  }
  async create(institutionId: string, data: CreateAcademicYearData): Promise<AcademicYear> {
    const y: AcademicYear = {
      id: `ay-${this.items.length + 1}`,
      institutionId,
      year: data.year,
      startDate: data.startDate,
      endDate: data.endDate,
      isCurrent: data.isCurrent ?? false,
    };
    this.items.push(y);
    return y;
  }
  async setCurrent(institutionId: string, id: string): Promise<void> {
    for (const y of this.items) {
      if (y.institutionId === institutionId) y.isCurrent = y.id === id;
    }
  }
  async findCurrent(institutionId: string): Promise<AcademicYear | null> {
    return this.items.find((y) => y.institutionId === institutionId && y.isCurrent) ?? null;
  }
}

export class InMemoryPeriodRepository implements PeriodRepository {
  items: Period[] = [];
  async findAll(institutionId: string, academicYearId?: string): Promise<Period[]> {
    return this.items.filter(
      (p) =>
        p.institutionId === institutionId &&
        (!academicYearId || p.academicYearId === academicYearId),
    );
  }
  async findById(institutionId: string, id: string): Promise<Period | null> {
    return this.items.find((p) => p.institutionId === institutionId && p.id === id) ?? null;
  }
  async create(institutionId: string, data: CreatePeriodData): Promise<Period> {
    const p: Period = {
      id: `period-${this.items.length + 1}`,
      institutionId,
      academicYearId: data.academicYearId,
      name: data.name,
      order: data.order,
      startDate: data.startDate,
      endDate: data.endDate,
      isCurrent: false,
    };
    this.items.push(p);
    return p;
  }
  async update(institutionId: string, id: string, _data: UpdatePeriodData): Promise<Period | null> {
    return this.items.find((p) => p.institutionId === institutionId && p.id === id) ?? null;
  }
  async delete(institutionId: string, id: string): Promise<void> {
    const idx = this.items.findIndex((p) => p.institutionId === institutionId && p.id === id);
    if (idx >= 0) this.items.splice(idx, 1);
  }
  async setCurrent(
    institutionId: string,
    academicYearId: string,
    periodId: string,
    isCurrent: boolean,
  ): Promise<void> {
    for (const p of this.items) {
      if (
        p.institutionId === institutionId &&
        p.academicYearId === academicYearId &&
        p.id !== periodId
      ) {
        p.isCurrent = false;
      }
    }
    const target = this.items.find((p) => p.institutionId === institutionId && p.id === periodId);
    if (target) target.isCurrent = isCurrent;
  }
  async findCurrent(institutionId: string, academicYearId: string): Promise<Period | null> {
    return (
      this.items.find(
        (p) =>
          p.institutionId === institutionId && p.academicYearId === academicYearId && p.isCurrent,
      ) ?? null
    );
  }
  // Match case-insensitive por nombre dentro de la institución. Merge origin/main
  // (a519866): usado por el import XLSX para resolver `PRUEBA` a Period.id.
  async findByName(institutionId: string, name: string): Promise<Period | null> {
    const lower = name.toLowerCase();
    return (
      this.items.find((p) => p.institutionId === institutionId && p.name.toLowerCase() === lower) ??
      null
    );
  }
}

export class InMemoryBookletTypeRepository implements BookletTypeRepository {
  items: BookletType[] = [];
  async findById(institutionId: string, id: string): Promise<BookletType | null> {
    return this.items.find((b) => b.institutionId === institutionId && b.id === id) ?? null;
  }
  async listByPeriod(institutionId: string, periodId: string): Promise<BookletType[]> {
    return this.items.filter((b) => b.institutionId === institutionId && b.periodId === periodId);
  }
  async listByInstitution(institutionId: string): Promise<BookletType[]> {
    return this.items.filter((b) => b.institutionId === institutionId);
  }
  // Merge origin/main (a519866): usado por el import XLSX para resolver
  // `TIPO DE CUADERNILLO` a BookletType.id dentro de la Prueba elegida.
  async findByName(institutionId: string, name: string): Promise<BookletType[]> {
    const lower = name.toLowerCase();
    return this.items.filter(
      (b) => b.institutionId === institutionId && b.name.toLowerCase() === lower,
    );
  }
  async findByNameAndPeriod(
    institutionId: string,
    name: string,
    periodId: string,
  ): Promise<BookletType[]> {
    const lower = name.toLowerCase();
    return this.items.filter(
      (b) =>
        b.institutionId === institutionId &&
        b.periodId === periodId &&
        b.name.toLowerCase() === lower,
    );
  }
  async create(institutionId: string, data: CreateBookletTypeData): Promise<BookletType> {
    const bt: BookletType = {
      id: `bt-${this.items.length + 1}`,
      institutionId,
      periodId: data.periodId,
      name: data.name,
      description: data.description ?? null,
      order: data.order ?? 0,
    };
    this.items.push(bt);
    return bt;
  }
  async update(
    institutionId: string,
    id: string,
    _data: UpdateBookletTypeData,
  ): Promise<BookletType | null> {
    return this.items.find((b) => b.institutionId === institutionId && b.id === id) ?? null;
  }
  async delete(institutionId: string, id: string): Promise<void> {
    const idx = this.items.findIndex((b) => b.institutionId === institutionId && b.id === id);
    if (idx >= 0) this.items.splice(idx, 1);
  }
}

/** Singletons vacíos para los tests que no necesitan sembrar estado. */
export const years = new InMemoryAcademicYearRepository();
export const periods = new InMemoryPeriodRepository();
export const bookletTypes = new InMemoryBookletTypeRepository();

function toCourse(c: { id: string; name: string; institutionId: string }): Course {
  return {
    id: c.id,
    institutionId: c.institutionId,
    academicYearId: "year-1",
    name: c.name,
    code: c.name,
  };
}

/**
 * Simula el constraint `@@unique([bundleId, order])` de `EvaluationBundleItem`
 * en Postgres. Si al intentar setear `order` para `itemId` ya existe OTRO item
 * del mismo `bundleId` con ese `order`, lanza el mismo error que Prisma
 * (`Unique constraint failed on the fields: (bundleId, order)`) para que un
 * reorden in-place falle también en tests unitarios, no solo en producción.
 */
function assertNoOrderCollision(
  bundleItems: Array<{ id: string; order: number }>,
  itemId: string,
  nextOrder: number,
  bundleId: string,
): void {
  const collision = bundleItems.find((it) => it.id !== itemId && it.order === nextOrder);
  if (collision) {
    throw new Error(
      `Unique constraint failed on the fields: (bundleId, order) ` +
        `(bundleId=${bundleId}, order=${nextOrder})`,
    );
  }
}

/**
 * Repositorio en memoria para tests de use cases de bundles.
 * Persiste bundles, items y un catálogo de evaluations precargadas.
 */
export type SeedEvaluation = {
  id: string;
  title: string;
  status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "PUBLISHED";
  totalQuestions: number;
  /** Sprint 7 — duración capturada en Settings; nullable. */
  durationMinutes: number | null;
  institutionId: string;
  subjectId: string;
  subjectName: string;
  subjectIsArea: boolean;
  parentSubjectId: string | null;
  parentSubjectName: string | null;
  /** Sprint 9 — curso de la evaluation (vía courseSubject). */
  courseId: string;
  courseName: string;
  /** Sprint Bundle-Period — Tipo de cuadernillo de la evaluation. */
  bookletTypeId: string | null;
  bookletTypeName: string | null;
};

/**
 * Catálogo de BookletTypes compartido por los tests de bundles (Sprint
 * Bundle-Period). Los IDs son estables para que los specs puedan referirlos
 * por nombre.
 */
export const BOOKLET_TYPES: Record<
  string,
  { id: string; name: string; periodId: string; institutionId: string }
> = {
  "bt-p1-est": {
    id: "bt-p1-est",
    name: "Estándar",
    periodId: "period-1",
    institutionId: "inst-1",
  },
  "bt-p1-esp": {
    id: "bt-p1-esp",
    name: "Especial",
    periodId: "period-1",
    institutionId: "inst-1",
  },
  "bt-p2-est": {
    id: "bt-p2-est",
    name: "Estándar",
    periodId: "period-2",
    institutionId: "inst-1",
  },
};

/**
 * Catálogo de periodos compartido por los tests (Sprint Bundle-Period).
 * Solo lo necesitamos para resolver `periodName` desde `periodId` en los
 * repositorios en memoria — el repo Prisma lo hace con un join.
 */
export const PERIODS: Record<string, { id: string; name: string; institutionId: string }> = {
  "period-1": { id: "period-1", name: "I Periodo", institutionId: "inst-1" },
  "period-2": { id: "period-2", name: "II Periodo", institutionId: "inst-1" },
};

export function bookletTypeNameOf(bookletTypeId: string | null): string | null {
  if (bookletTypeId === null) return null;
  return BOOKLET_TYPES[bookletTypeId]?.name ?? null;
}

export function periodNameOf(periodId: string | null): string | null {
  if (periodId === null) return null;
  return PERIODS[periodId]?.name ?? null;
}

export class InMemoryBundleRepository implements BundleRepository {
  bundles = new Map<string, Bundle>();
  items = new Map<string, BundleItem & { institutionId: string }>();
  evaluations = new Map<string, SeedEvaluation>();
  /**
   * Contador monotónico para generar IDs de item. NO usar `this.items.size + 1`
   * porque tras un remove el tamaño baja y el siguiente add reciclaría un ID
   * existente → `items.set(id, ...)` sobrescribe la fila previa en vez de
   * añadir (bug latente en este repo de tests: tras `removeItem` + `addItem`
   * el item previo desaparecía del Map). Este contador solo sube.
   */
  private nextItemSeq = 0;

  seedEvaluation(ev: SeedEvaluation): void {
    this.evaluations.set(ev.id, ev);
  }

  async create(
    institutionId: string,
    createdById: string,
    data: CreateBundleData,
    evaluationsById: Map<string, SeedEvaluation>,
  ): Promise<Bundle> {
    const id = `bundle-${this.bundles.size + 1}`;
    const now = new Date();
    const bundle: Bundle = {
      id,
      institutionId,
      createdById,
      name: data.name,
      bookletNumber: data.bookletNumber ?? null,
      courseId: data.courseId ?? null,
      courseName: data.courseId ? courseNameOf(data.courseId) : null,
      periodId: data.periodId ?? null,
      periodName: periodNameOf(data.periodId ?? null),
      bookletTypeId: data.bookletTypeId ?? null,
      bookletTypeName: bookletTypeNameOf(data.bookletTypeId ?? null),
      status: "DRAFT",
      theme: data.theme ?? null,
      coverContent: null,
      createdAt: now,
      updatedAt: now,
    };
    this.bundles.set(id, bundle);
    let order = 1;
    for (const evId of data.evaluationIds) {
      const ev = evaluationsById.get(evId);
      if (!ev) throw new Error(`Evaluation ${evId} no encontrada`);
      const itemId = `item-${++this.nextItemSeq}`;
      this.items.set(itemId, {
        id: itemId,
        bundleId: id,
        evaluationId: evId,
        order: order++,
        institutionId,
      });
    }
    return bundle;
  }

  async findById(institutionId: string, id: string): Promise<Bundle | null> {
    const b = this.bundles.get(id);
    return b && b.institutionId === institutionId ? b : null;
  }

  async findDetail(institutionId: string, id: string): Promise<BundleDetail | null> {
    const b = await this.findById(institutionId, id);
    if (!b) return null;
    const items = await this.listItemsOrdered(id);
    return {
      ...b,
      items,
      totalQuestions: items.reduce((s, i) => s + i.totalQuestions, 0),
    };
  }

  async findAll(
    institutionId: string,
    filters?: { periodId?: string; bookletTypeId?: string; status?: BundleStatus },
  ): Promise<Bundle[]> {
    return Array.from(this.bundles.values()).filter((b) => {
      if (b.institutionId !== institutionId) return false;
      if (filters?.periodId !== undefined && b.periodId !== filters.periodId) return false;
      if (filters?.bookletTypeId !== undefined && b.bookletTypeId !== filters.bookletTypeId)
        return false;
      if (filters?.status !== undefined && b.status !== filters.status) return false;
      return true;
    });
  }

  async findByCourseIds(institutionId: string, courseIds: string[]): Promise<Bundle[]> {
    if (courseIds.length === 0) return [];
    return Array.from(this.bundles.values()).filter(
      (b) =>
        b.institutionId === institutionId && b.courseId !== null && courseIds.includes(b.courseId),
    );
  }

  async update(institutionId: string, id: string, data: UpdateBundleData): Promise<Bundle> {
    const b = await this.findById(institutionId, id);
    if (!b) throw new Error(`Bundle ${id} no encontrado`);
    const updated: Bundle = {
      ...b,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.bookletNumber !== undefined ? { bookletNumber: data.bookletNumber } : {}),
      ...(data.courseId !== undefined
        ? {
            courseId: data.courseId,
            courseName: data.courseId ? courseNameOf(data.courseId) : null,
          }
        : {}),
      ...(data.periodId !== undefined
        ? {
            periodId: data.periodId,
            periodName: periodNameOf(data.periodId),
          }
        : {}),
      ...(data.bookletTypeId !== undefined
        ? {
            bookletTypeId: data.bookletTypeId,
            bookletTypeName: bookletTypeNameOf(data.bookletTypeId),
          }
        : {}),
      ...(data.theme !== undefined ? { theme: data.theme } : {}),
      ...(data.coverContent !== undefined ? { coverContent: data.coverContent } : {}),
      updatedAt: new Date(),
    };
    this.bundles.set(id, updated);
    return updated;
  }

  async delete(institutionId: string, id: string): Promise<void> {
    const b = await this.findById(institutionId, id);
    if (!b) return;
    this.bundles.delete(id);
    for (const [itemId, item] of this.items) {
      if (item.bundleId === id) this.items.delete(itemId);
    }
  }

  async listItemsOrdered(bundleId: string): Promise<BundleItemDetail[]> {
    const items = Array.from(this.items.values())
      .filter((i) => i.bundleId === bundleId)
      .sort((a, b) => a.order - b.order);
    return items.map((i) => {
      const ev = this.evaluations.get(i.evaluationId)!;
      return {
        id: i.id,
        bundleId: i.bundleId,
        evaluationId: i.evaluationId,
        order: i.order,
        evaluationTitle: ev.title,
        evaluationStatus: ev.status,
        totalQuestions: ev.totalQuestions,
        durationMinutes: ev.durationMinutes,
        subjectName: ev.subjectName,
        subjectIsArea: ev.subjectIsArea,
        parentSubjectId: ev.parentSubjectId,
        parentSubjectName: ev.parentSubjectName,
        courseId: ev.courseId,
        courseName: ev.courseName,
        bookletTypeId: ev.bookletTypeId,
        bookletTypeName: ev.bookletTypeName,
      };
    });
  }

  async addItem(institutionId: string, bundleId: string, data: AddItemInput): Promise<BundleItem> {
    const items = await this.listItemsOrdered(bundleId);
    // Para el append usamos `max(order) + 1`, NO `items.length + 1`.
    // Si los items quedan con orders no contiguos (e.g. tras una eliminación
    // intermedia), `count + 1` apuntaría a un slot ya ocupado y el
    // `@@unique([bundleId, order])` de Postgres rechazaría el INSERT. Con
    // max+1 siempre cae en un slot libre. (Fix en línea con Sprint 5.)
    const order =
      data.order ?? (items.length === 0 ? 1 : Math.max(...items.map((i) => i.order)) + 1);
    if (items.some((i) => i.order === order)) {
      throw new Error(`Order ${order} ya existe en el bundle`);
    }
    const id = `item-${++this.nextItemSeq}`;
    this.items.set(id, { id, bundleId, evaluationId: data.evaluationId, order, institutionId });
    return { id, bundleId, evaluationId: data.evaluationId, order };
  }

  async removeItem(institutionId: string, bundleId: string, itemId: string): Promise<boolean> {
    const item = this.items.get(itemId);
    if (!item || item.bundleId !== bundleId || item.institutionId !== institutionId) {
      return false;
    }
    this.items.delete(itemId);
    return true;
  }

  async reorderItems(institutionId: string, bundleId: string, itemIds: string[]): Promise<void> {
    // Validación de pertenencia (igual que en PrismaBundleRepository).
    const bundleItems = Array.from(this.items.values()).filter(
      (it) => it.bundleId === bundleId && it.institutionId === institutionId,
    );
    const existingIds = new Set(bundleItems.map((it) => it.id));
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

    // Espejo del comportamiento de Prisma: simula el constraint
    // @@unique([bundleId, order]) que existe en el schema. Si reordenamos
    // in-place, una colisión temporal lanzaría
    // `Unique constraint failed on the fields: (bundleId, order)` en
    // Postgres; aquí reproducimos el mismo error. Para evitarlo, two-phase:
    //   1) llevamos cada item a un orden negativo único (-1, -2, …)
    //   2) aplicamos el orden final 1-based sobre el rango ya libre
    //
    // Importante: el snapshot debe refrescarse en CADA iteración para
    // reflejar las órdenes que ya seteamos en phase 1. Si capturamos
    // `bundleItems` una sola vez al inicio, en phase 2 todavía veríamos las
    // órdenes positivas viejas y reportaríamos colisiones fantasma.
    const snapshot = () =>
      Array.from(this.items.values()).filter(
        (it) => it.bundleId === bundleId && it.institutionId === institutionId,
      );
    let i = 0;
    for (const id of itemIds) {
      const item = this.items.get(id)!;
      const tempOrder = -1 - i++;
      assertNoOrderCollision(snapshot(), id, tempOrder, bundleId);
      this.items.set(id, { ...item, order: tempOrder });
    }
    let order = 1;
    for (const id of itemIds) {
      const item = this.items.get(id)!;
      assertNoOrderCollision(snapshot(), id, order, bundleId);
      this.items.set(id, { ...item, order: order++ });
    }
  }

  async setStatus(institutionId: string, id: string, status: BundleStatus): Promise<void> {
    const b = await this.findById(institutionId, id);
    if (!b) throw new Error(`Bundle ${id} no encontrado`);
    this.bundles.set(id, { ...b, status, updatedAt: new Date() });
  }

  async findEvaluationsByIds(
    institutionId: string,
    evaluationIds: string[],
  ): Promise<SeedEvaluation[]> {
    return evaluationIds
      .map((id) => this.evaluations.get(id))
      .filter((e): e is SeedEvaluation => Boolean(e) && e!.institutionId === institutionId);
  }
}

/** Actores comunes */
export const superAdmin: AuthenticatedUser = {
  userId: "u-super",
  institutionId: "inst-1",
  roles: ["ECU_MASTER"],
};

export const teacher: AuthenticatedUser = {
  userId: "u-teach",
  institutionId: "inst-1",
  roles: ["TEACHER"],
};

export const coordinator: AuthenticatedUser = {
  userId: "u-coord",
  institutionId: "inst-1",
  roles: ["ECU_LIDER"],
};

export const adminOtherInstitution: AuthenticatedUser = {
  userId: "u-super-2",
  institutionId: "inst-2",
  roles: ["ECU_MASTER"],
};

/** Seeds de evaluations de ejemplo (grado 6°, Ciencias Naturales). */
export function seedEvaluationGrado6(
  repo: InMemoryBundleRepository,
  options?: Partial<SeedEvaluation>,
): SeedEvaluation {
  const ev: SeedEvaluation = {
    id: options?.id ?? `ev-${Math.random().toString(36).slice(2)}`,
    title: options?.title ?? "Biología 6°",
    status: options?.status ?? "APPROVED",
    totalQuestions: options?.totalQuestions ?? 33,
    durationMinutes: options?.durationMinutes ?? null,
    institutionId: options?.institutionId ?? "inst-1",
    subjectId: options?.subjectId ?? "subj-bio",
    subjectName: options?.subjectName ?? "Biología",
    subjectIsArea: options?.subjectIsArea ?? false,
    parentSubjectId: options?.parentSubjectId ?? "subj-cn",
    parentSubjectName: options?.parentSubjectName ?? "Ciencias Naturales",
    courseId: options?.courseId ?? "course-6",
    courseName: options?.courseName ?? courseNameOf(options?.courseId ?? "course-6"),
    bookletTypeId: options?.bookletTypeId ?? null,
    bookletTypeName: options?.bookletTypeName ?? null,
  };
  repo.seedEvaluation(ev);
  return ev;
}
