/**
 * Entidad Institution (tenant raíz del sistema).
 * El dominio no conoce Prisma: define su propio modelo y el contrato
 * de persistencia (puerto) que la infraestructura implementa.
 */
export interface Institution {
  id: string;
  name: string;
  slug: string;
  code: string;
  logo: string | null;
  /** Tema institucional (overrides del default del sistema). JSONB crudo —
   *  el módulo theme (ver @/modules/theme) lo valida antes de mergear.
   *  Tipado como `unknown` por consistencia con Evaluation.theme/Bundle.theme.
   *  El cover-designer (ago 2026) lee Institution.theme.primaryColor para
   *  pintar bordes de acento en variantes que lo usen (primaria-v1). */
  theme: unknown;
  /** Override institucional del copy de la portada (cover). JSONB crudo —
   *  el módulo bundle-cover (ver @/modules/bundle-cover) lo valida con
   *  `parseCoverContent()` antes de mergearlo con el bundle. Tipado como
   *  `unknown` por consistencia con `theme` y `Bundle.coverContent`. Lo
   *  configuran los admin institucionales en /admin/theme. PR 3 (ago 2026). */
  coverContent: unknown;
  isActive: boolean;
  createdAt: Date;
}

export interface CreateInstitutionData {
  name: string;
  slug: string;
  code: string;
  logo?: string;
}

export interface InstitutionRepository {
  findById(id: string): Promise<Institution | null>;
  findBySlug(slug: string): Promise<Institution | null>;
  findByCode(code: string): Promise<Institution | null>;
  findAll(): Promise<Institution[]>;
  create(data: CreateInstitutionData): Promise<Institution>;
  setActive(id: string, isActive: boolean): Promise<void>;
  /**
   * Persiste el override institucional de `coverContent` (PR 3, ago 2026).
   * `null` = DB NULL (merge cae al DEFAULT_*). El caller valida y sanea
   * el objeto con `parseCoverContent()` antes de invocar — el repo solo
   * escribe lo que recibe.
   */
  setCoverContent(id: string, coverContent: Record<string, unknown> | null): Promise<void>;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** El slug se usa como subdominio: minúsculas, números y guiones. */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && slug.length >= 3 && slug.length <= 40;
}
