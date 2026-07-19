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
  institutionId: string;
  subjectId: string;
  subjectName: string;
  subjectIsArea: boolean;
  parentSubjectId: string | null;
  parentSubjectName: string | null;
};

export class InMemoryBundleRepository implements BundleRepository {
  bundles = new Map<string, Bundle>();
  items = new Map<string, BundleItem & { institutionId: string }>();
  evaluations = new Map<string, SeedEvaluation>();

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
      status: "DRAFT",
      theme: data.theme ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.bundles.set(id, bundle);
    let order = 1;
    for (const evId of data.evaluationIds) {
      const ev = evaluationsById.get(evId);
      if (!ev) throw new Error(`Evaluation ${evId} no encontrada`);
      const itemId = `item-${this.items.size + 1}`;
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

  async findAll(institutionId: string): Promise<Bundle[]> {
    return Array.from(this.bundles.values()).filter((b) => b.institutionId === institutionId);
  }

  async update(institutionId: string, id: string, data: UpdateBundleData): Promise<Bundle> {
    const b = await this.findById(institutionId, id);
    if (!b) throw new Error(`Bundle ${id} no encontrado`);
    const updated: Bundle = {
      ...b,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.bookletNumber !== undefined ? { bookletNumber: data.bookletNumber } : {}),
      ...(data.theme !== undefined ? { theme: data.theme } : {}),
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
        subjectName: ev.subjectName,
        subjectIsArea: ev.subjectIsArea,
        parentSubjectId: ev.parentSubjectId,
        parentSubjectName: ev.parentSubjectName,
      };
    });
  }

  async addItem(institutionId: string, bundleId: string, data: AddItemInput): Promise<BundleItem> {
    const items = await this.listItemsOrdered(bundleId);
    const order = data.order ?? items.length + 1;
    if (items.some((i) => i.order === order)) {
      throw new Error(`Order ${order} ya existe en el bundle`);
    }
    const id = `item-${this.items.size + 1}`;
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
  roles: ["SUPER_ADMIN"],
};

export const teacher: AuthenticatedUser = {
  userId: "u-teach",
  institutionId: "inst-1",
  roles: ["TEACHER"],
};

export const coordinator: AuthenticatedUser = {
  userId: "u-coord",
  institutionId: "inst-1",
  roles: ["COORDINATOR"],
};

export const adminOtherInstitution: AuthenticatedUser = {
  userId: "u-super-2",
  institutionId: "inst-2",
  roles: ["SUPER_ADMIN"],
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
    institutionId: options?.institutionId ?? "inst-1",
    subjectId: options?.subjectId ?? "subj-bio",
    subjectName: options?.subjectName ?? "Biología",
    subjectIsArea: options?.subjectIsArea ?? false,
    parentSubjectId: options?.parentSubjectId ?? "subj-cn",
    parentSubjectName: options?.parentSubjectName ?? "Ciencias Naturales",
  };
  repo.seedEvaluation(ev);
  return ev;
}
