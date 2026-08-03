/**
 * Tipos de cuadernillo configurados por Prueba (REQUERIMIENTOS_v2 §3.3
 * — borrador de evaluaciones, customización por periodo).
 *
 * El docente necesita diferenciar el cuadernillo "Estándar" (todos los
 * estudiantes) del "Especial" (solo NEE, con contenido distinto). Esto es
 * ortogonal a `Evaluation.bookletNumber` (variante anti-copia 1, 2, 3…).
 *
 * Catálogo por Prueba, no global. Nombre único dentro de la Prueba.
 *
 * Reglas de la capa de dominio (no se importa @prisma/client):
 * - Todas las entidades llevan `institutionId` (multi-tenancy).
 * - Las FK se validan en el use case contra el repositorio (no en BD).
 * - Errores legibles: `ValidationError`, `ConflictError`, `NotFoundError`.
 */

export interface BookletType {
  id: string;
  institutionId: string;
  periodId: string;
  name: string;
  description: string | null;
  order: number;
}

export interface CreateBookletTypeData {
  periodId: string;
  name: string;
  description?: string;
  /** Si se omite, el repo asigna `count + 1` (orden al final). */
  order?: number;
}

export interface UpdateBookletTypeData {
  /** `null` explícito limpia el campo (description → null). Ausente = no se toca. */
  name?: string;
  description?: string | null;
  order?: number;
}

export interface BookletTypeRepository {
  findById(institutionId: string, id: string): Promise<BookletType | null>;
  listByPeriod(institutionId: string, periodId: string): Promise<BookletType[]>;
  /** Trae todos los de la institución para que el cliente filtre por
   *  `periodId`. Tabla chica (decenas de filas por institución), no
   *  justifica un endpoint `/api/booklet-types?periodId=X`. */
  listByInstitution(institutionId: string): Promise<BookletType[]>;
  create(institutionId: string, data: CreateBookletTypeData): Promise<BookletType>;
  update(
    institutionId: string,
    id: string,
    data: UpdateBookletTypeData,
  ): Promise<BookletType | null>;
  delete(institutionId: string, id: string): Promise<void>;
}

/** Nombre visible: 1–50 chars (límite arbitrario para no aceptar strings raros). */
export function isValidBookletTypeName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 50;
}
