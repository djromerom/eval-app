import { AsyncLocalStorage } from "node:async_hooks";
import type { PrismaPromise } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Contexto de institución por request (multi-tenant, REQUERIMIENTOS_v2.md §3.9).
 *
 * La migración `enable_rls` deja las políticas RLS listas: cada request debe
 * fijar la variable de sesión `app.current_institution` para que PostgreSQL
 * filtre por institución. Hoy la app se conecta con el rol DUEÑO (que OMITE RLS)
 * y el aislamiento lo garantiza la capa de aplicación; en producción se apunta
 * al rol restringido `eval_app` y estas utilidades activan la segunda barrera.
 */
const storage = new AsyncLocalStorage<{ institutionId: string }>();

export function runWithInstitution<T>(institutionId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ institutionId }, fn);
}

export function getCurrentInstitutionId(): string | undefined {
  return storage.getStore()?.institutionId;
}

/**
 * Ejecuta una operación Prisma dentro de una transacción que fija
 * `app.current_institution` (patrón oficial de RLS con set_config local).
 * Úsalo cuando la app opere con el rol restringido `eval_app`.
 */
export async function withInstitutionRLS<T>(
  institutionId: string,
  operation: PrismaPromise<T>,
): Promise<T> {
  const [, result] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('app.current_institution', ${institutionId}, true)`,
    operation,
  ]);
  return result;
}
