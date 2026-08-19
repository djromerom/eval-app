import { requireAuthenticatedUser } from "@/lib/session";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import { type PrintKind, verifyPrintToken } from "@/shared/infrastructure/crypto/print-token";

/**
 * Acceso a las rutas /print/*: o hay sesión de usuario, o un token de impresión
 * firmado (para el worker de PDF, que no tiene sesión). El token está atado al
 * evaluationId o bundleId según el kind, así que solo abre exactamente esa
 * página. Si no hay token válido, cae al gate de sesión normal (redirige a
 * /login).
 *
 * Soporta dos formas:
 *   - evaluationId (legacy): booklet, answer-sheets, answer-key de 1 evaluation.
 *   - bundleId (Sprint 1+): bundle (booklet combinado) y answer-sheets-bundle
 *     (hoja unificada, Sprint 2).
 */
export async function resolvePrintActor(
  token: string | undefined,
  expected: { evaluationId: string; kind: PrintKind } | { bundleId: string; kind: PrintKind },
): Promise<AuthenticatedUser> {
  if (token) {
    const access = verifyPrintToken(token);
    if (!access || access.kind !== expected.kind) {
      // cae al session gate
    } else if ("evaluationId" in expected && access.evaluationId === expected.evaluationId) {
      return {
        userId: "pdf-worker",
        institutionId: access.institutionId,
        roles: ["ECU_MASTER", "ECU_LIDER", "TEACHER"],
      };
    } else if ("bundleId" in expected && access.bundleId === expected.bundleId) {
      return {
        userId: "pdf-worker",
        institutionId: access.institutionId,
        roles: ["ECU_MASTER", "ECU_LIDER", "TEACHER"],
      };
    }
  }
  return requireAuthenticatedUser();
}
