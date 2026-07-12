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
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** El slug se usa como subdominio: minúsculas, números y guiones. */
export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && slug.length >= 3 && slug.length <= 40;
}
