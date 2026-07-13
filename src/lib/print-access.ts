import { requireAuthenticatedUser } from "@/lib/session";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import { type PrintKind, verifyPrintToken } from "@/shared/infrastructure/crypto/print-token";

/**
 * Acceso a las rutas /print/*: o hay sesión de usuario, o un token de impresión
 * firmado (para el worker de PDF, que no tiene sesión). El token está atado a la
 * evaluación y al tipo de documento, así que solo abre exactamente esa página.
 * Si no hay token válido, cae al gate de sesión normal (redirige a /login).
 */
export async function resolvePrintActor(
  token: string | undefined,
  expected: { evaluationId: string; kind: PrintKind },
): Promise<AuthenticatedUser> {
  if (token) {
    const access = verifyPrintToken(token);
    if (access && access.evaluationId === expected.evaluationId && access.kind === expected.kind) {
      // Actor sintético del worker: acotado a la institución del token.
      return {
        userId: "pdf-worker",
        institutionId: access.institutionId,
        roles: ["ADMIN", "COORDINATOR", "TEACHER"],
      };
    }
  }
  return requireAuthenticatedUser();
}
