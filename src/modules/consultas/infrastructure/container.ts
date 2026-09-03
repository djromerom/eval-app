/**
 * Composition root del módulo `consultas`. Símil al patrón de `institutions/`
 * y `evaluations/`: factorías `make...()` que devuelven el use case ya
 * configurado con sus dependencias Prisma.
 */
import { ListFormulaciones } from "../application/list-formulaciones";
import { PrismaFormulacionesReader } from "./formulaciones-fetcher";

/** Singleton (una sola instancia por proceso, sin estado entre requests). */
const reader = new PrismaFormulacionesReader();

export const makeListFormulaciones = () => new ListFormulaciones(reader);
