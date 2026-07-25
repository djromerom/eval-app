/**
 * Entidad Bundle (cuadernillo multi-formulación) + puerto de persistencia.
 * El dominio no conoce Prisma: solo tipos y contratos.
 * Ver docs/cuadernillos.md.
 */
import type { BundleStatus } from "./bundle-status";
import type {
  EvaluationTheme,
  ResolvedTheme as ThemeResolvedTheme,
} from "@/modules/theme/domain/theme";

/**
 * Override visual por bundle. Mismo shape que EvaluationTheme — extender
 * EvaluationTheme cuando agreguemos campos específicos de bundle (p.ej.
 * encabezado del salón). Hoy sólo reusa los campos cubiertos por
 * `src/app/(dashboard)/admin/bundles/[id]/designer/`.
 *
 * El override (parcial) se mergea con Institution.theme en runtime a través
 * de `getResolvedBundleTheme()` con precedencia bundle > institucional.
 */
export type BundleTheme = EvaluationTheme;

/** Tema visual resuelto: combinación Institution.theme + bundle.theme. */
export type ResolvedTheme = ThemeResolvedTheme;

export interface Bundle {
  id: string;
  institutionId: string;
  name: string;
  bookletNumber: number | null;
  /**
   * Curso del cuadernillo (Sprint 9). `null` = cuadernillo cross-course
   * (simulacro institucional que mezcla grados). Si está definido, todos
   * los items deben ser evaluations de ese curso — invariante validada en
   * CreateBundle / AddEvaluationToBundle / UpdateBundle, no en la DB.
   */
  courseId: string | null;
  /** Nombre del curso resuelto por el repo (para portada y listados). */
  courseName: string | null;
  status: BundleStatus;
  /**
   * Override visual por cuadernillo. JSONB crudo: la capa de aplicación no
   * lo estructura — `getResolvedBundleTheme()` lo valida con
   * `parseEvaluationTheme()` antes de mergearlo. Tipeado como `unknown`
   * por consistencia con `Evaluation.theme`.
   */
  theme: unknown;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Una formulación dentro de un bundle. Tiene `order` (1-based). */
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
  /**
   * Duración estimada en minutos de la evaluation (Sprint 7). Nullable:
   * las evaluations creadas antes de Sprint 7 quedan con null y la portada
   * cae al cálculo heurístico `totalQuestions * DEFAULT_MINUTES_PER_QUESTION`.
   * Si está definido, gana sobre el cálculo.
   */
  durationMinutes: number | null;
  /** Nombre del subject (área o subject hoja) para la portada. */
  subjectName: string | null;
  /** Subject hoja: id del parent si tiene; null si es subject raíz. */
  parentSubjectId: string | null;
  /** Nombre del parent subject (área raíz) si existe; null si el subject es raíz. */
  parentSubjectName: string | null;
  /** Indica si el subject es un área agrupadora (no evaluable). */
  subjectIsArea: boolean;
  /** Curso de la evaluation (vía courseSubject). Usado para validar que
   *  coincida con `bundle.courseId` cuando éste está definido. */
  courseId: string;
  /** Nombre del curso ("11°") para los mensajes de error y la UI. */
  courseName: string;
}

/** Bundle con items ya cargados. */
export interface BundleDetail extends Bundle {
  items: BundleItemDetail[];
  /** Suma de totalQuestions de todos los items. */
  totalQuestions: number;
}

/**
 * Datos para crear un bundle. El tema es **parcial** — los campos no
 * provistos caen al institucional en runtime (mergeTheme). `null` resetea
 * al institucional explícitamente.
 */
export interface CreateBundleData {
  name: string;
  bookletNumber?: number | null;
  /** Curso del cuadernillo. `null`/omitido = cross-course. */
  courseId?: string | null;
  evaluationIds: string[];
  theme?: Partial<BundleTheme> | null;
}

export interface UpdateBundleData {
  name?: string;
  bookletNumber?: number | null;
  /**
   * `undefined` = no tocar; `null` = limpiar (volver a cross-course);
   * string = asignar curso (requiere que los items ya presentes coincidan).
   */
  courseId?: string | null;
  theme?: Partial<BundleTheme> | null;
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
        courseId: string;
        courseName: string;
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
      /** Sprint 7: duración capturada en Settings; nullable. */
      durationMinutes: number | null;
      institutionId: string;
      subjectId: string;
      subjectName: string;
      subjectIsArea: boolean;
      parentSubjectId: string | null;
      parentSubjectName: string | null;
      /** Sprint 9: curso de la evaluation, para validar contra bundle.courseId. */
      courseId: string;
      courseName: string;
    }>
  >;
}
