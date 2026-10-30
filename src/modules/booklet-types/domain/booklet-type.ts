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
  /** Match case-insensitive por nombre dentro de la institución. Devuelve
   *  TODOS los matches (uno por Period si el docente reutilizó el nombre).
   *  El caller decide qué hacer si hay varios — típicamente, error por fila
   *  en el import XLSX. */
  findByName(institutionId: string, name: string): Promise<BookletType[]>;
  /** Match case-insensitive por (nombre + periodId). Usado por el import XLSX
   *  para resolver `TIPO DE CUADERNILLO` dentro de la Prueba que el
   *  docente eligió explícitamente en la columna PRUEBA. Sin match =
   *  error por fila. */
  findByNameAndPeriod(
    institutionId: string,
    name: string,
    periodId: string,
  ): Promise<BookletType[]>;
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

// ---------------------------------------------------------------------------
// Vocabulario de nombres (anti-deriva ortográfica)
// ---------------------------------------------------------------------------

/**
 * Normaliza un nombre de tipo SOLO para comparar, nunca para guardar:
 * minúsculas, sin tildes y sin espacios redundantes.
 *
 * "Estándar", "ESTANDAR" y "estandar" colapsan al mismo valor, de modo que
 * el catálogo no se fragmenta según cómo se escribió el nombre. La `ñ` se
 * convierte a `n` a mano porque al descomponer Unicode la tilde de la ñ se
 * perdería.
 */
export function normalizeBookletTypeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ñ/g, "n")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** ¿La palabra lleva tilde u otro acento? ("Estándar" sí, "Estandar" no). */
function hasDiacritics(value: string): boolean {
  return /[\u0300-\u036f]/.test(value.normalize("NFD"));
}

/** Un nombre del catálogo institucional, con su grafía canónica. */
export interface BookletTypeVocabularyEntry {
  /** Grafía canónica: la que debe usarse al crear un tipo nuevo. */
  name: string;
  /** Cuántos tipos de la institución comparten este nombre (por escrito). */
  count: number;
}

/**
 * Vocabulario institucional de nombres de tipo: agrupa por nombre
 * normalizado y devuelve UNA entrada por concepto, con la grafía canónica.
 *
 * La grafía canónica se elige por este orden:
 * 1. La escrita CORRECTAMENTE (con tilde): "Estándar" antes que
 *    "Estandar". El criterio va primero que el uso a propósito — si no, la
 *    grafía equivocada se perpetúa por estar repetida en más pruebas.
 * 2. La más usada.
 * 3. La más corta.
 * 4. La alfabética.
 *
 * Determinista para que la UI y el servidor coincidan siempre.
 */
export function buildBookletTypeVocabulary(types: BookletType[]): BookletTypeVocabularyEntry[] {
  const groups = new Map<string, Map<string, number>>();

  for (const t of types) {
    const spelling = t.name.trim();
    const key = normalizeBookletTypeName(spelling);
    if (!key) continue;
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(spelling, (spellings.get(spelling) ?? 0) + 1);
    groups.set(key, spellings);
  }

  const entries: BookletTypeVocabularyEntry[] = [];
  for (const spellings of groups.values()) {
    const ranked = [...spellings.entries()].sort((a, b) => {
      // Negativo = `a` va primero. La grafía con tilde debe ir por delante.
      const diacritics = Number(hasDiacritics(b[0])) - Number(hasDiacritics(a[0]));
      if (diacritics !== 0) return diacritics;
      if (b[1] !== a[1]) return b[1] - a[1];
      if (a[0].length !== b[0].length) return a[0].length - b[0].length;
      return a[0].localeCompare(b[0], "es");
    });
    const total = [...spellings.values()].reduce((sum, n) => sum + n, 0);
    entries.push({ name: ranked[0]![0], count: total });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/**
 * Devuelve la grafía canónica de `name` dentro del catálogo de la
 * institución. Si el nombre es nuevo (no existe normalizado), se devuelve
 * tal cual (recortado).
 *
 * Es la defensa de servidor contra la deriva ortográfica: aunque alguien
 * escriba "Estandar" a mano, se guarda "Estándar".
 */
export function canonicalBookletTypeName(name: string, types: BookletType[]): string {
  const key = normalizeBookletTypeName(name);
  if (!key) return name.trim();
  const match = buildBookletTypeVocabulary(types).find(
    (entry) => normalizeBookletTypeName(entry.name) === key,
  );
  return match?.name ?? name.trim();
}
