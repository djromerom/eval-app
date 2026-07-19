/**
 * Entidad Bundle (compendio multi-evaluación) + puerto de persistencia.
 * El dominio no conoce Prisma: solo tipos y contratos.
 * Ver docs/compendios.md.
 */
import type { BundleStatus } from "./bundle-status";

/** Override visual por bundle (mismo shape que Evaluation.theme). */
export type BundleTheme = unknown;

/** Tema visual resuelto: combinación Institution.theme + bundle.theme. */
export type ResolvedTheme = unknown;

export interface Bundle {
  id: string;
  institutionId: string;
  name: string;
  bookletNumber: number | null;
  status: BundleStatus;
  theme: BundleTheme | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Una evaluación dentro de un bundle. Tiene `order` (1-based). */
export interface BundleItem {
  id: string;
  bundleId: string;
  evaluationId: string;
  order: number;
}

/** Item enriquecido con datos de la evaluation: nombre, totalQuestions, status. */
export interface BundleItemDetail extends BundleItem {
  evaluationTitle: string;
  evaluationStatus: string;
  totalQuestions: number;
  /** Nombre del subject (área o subject hoja) para la portada. */
  subjectName: string | null;
  /** Subject hoja: id del parent si tiene; null si es subject raíz. */
  parentSubjectId: string | null;
  /** Nombre del parent subject (área raíz) si existe; null si el subject es raíz. */
  parentSubjectName: string | null;
  /** Indica si el subject es un área agrupadora (no evaluable). */
  subjectIsArea: boolean;
}

/** Bundle con items ya cargados. */
export interface BundleDetail extends Bundle {
  items: BundleItemDetail[];
  /** Suma de totalQuestions de todos los items. */
  totalQuestions: number;
}

/** Datos para crear un bundle. */
export interface CreateBundleData {
  name: string;
  bookletNumber?: number | null;
  evaluationIds: string[];
  theme?: BundleTheme | null;
}

export interface UpdateBundleData {
  name?: string;
  bookletNumber?: number | null;
  theme?: BundleTheme | null;
}

export interface AddItemInput {
  evaluationId: string;
  /** Posición 1-based. Si no se da, se añade al final. */
  order?: number;
}

/** Puerto de persistencia. Implementado por PrismaBundleRepository. */
export interface BundleRepository {
  /** Crea el bundle en DRAFT junto con sus items en una transacción. */
  create(
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
        institutionId: string;
        subjectId: string;
        subjectName: string;
        subjectIsArea: boolean;
        parentSubjectId: string | null;
        parentSubjectName: string | null;
      }
    >,
  ): Promise<Bundle>;

  findById(institutionId: string, id: string): Promise<Bundle | null>;
  findDetail(institutionId: string, id: string): Promise<BundleDetail | null>;
  findAll(institutionId: string): Promise<Bundle[]>;

  /** Edita solo si el bundle está en DRAFT. */
  update(institutionId: string, id: string, data: UpdateBundleData): Promise<Bundle>;

  delete(institutionId: string, id: string): Promise<void>;

  /** Devuelve los items en orden ascendente. */
  listItemsOrdered(bundleId: string): Promise<BundleItemDetail[]>;

  /** Añade un item al bundle. Devuelve el item creado. */
  addItem(institutionId: string, bundleId: string, data: AddItemInput): Promise<BundleItem>;

  /** Elimina un item por id. Devuelve true si eliminó, false si no existía. */
  removeItem(institutionId: string, bundleId: string, itemId: string): Promise<boolean>;

  /**
   * Reemplaza el orden de los items por la lista ordenada de ids.
   * Implementación debe ejecutarse en transacción.
   */
  reorderItems(institutionId: string, bundleId: string, itemIds: string[]): Promise<void>;

  /** Cambia status. Usado por MarkReady / UnmarkReady. */
  setStatus(institutionId: string, id: string, status: BundleStatus): Promise<void>;

  /** Carga múltiples evaluations por id (usado por CreateBundle para validar). */
  findEvaluationsByIds(
    institutionId: string,
    evaluationIds: string[],
  ): Promise<
    Array<{
      id: string;
      title: string;
      status: string;
      totalQuestions: number;
      institutionId: string;
      subjectId: string;
      subjectName: string;
      subjectIsArea: boolean;
      parentSubjectId: string | null;
      parentSubjectName: string | null;
    }>
  >;
}
