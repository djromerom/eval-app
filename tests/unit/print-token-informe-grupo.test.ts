/**
 * Print token para el informe por grupo (sep 2026). El token firma
 * {periodId, groupId, institutionId, kind: "informe-grupo"} en vez del
 * evaluationId/bundleId que usan los demás kinds. Garantiza que la página
 * `/print/informe-grupo/[periodId]/[groupId]` solo se carga con un token
 * que coincida con los ids del path — sin sesión, sin token válido, redirige
 * a /login vía `resolvePrintActor`.
 *
 * Mismo patrón que `tests/unit/print-token.test.ts`: las env vars se setean
 * en `beforeAll` y el módulo se importa dinámicamente (env.ts valida al
 * import-time; un import top-level rompe antes del beforeAll).
 */
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.QR_SIGNING_SECRET ??= "test-secret-de-al-menos-16-chars";
  process.env.DATABASE_URL ??= "postgresql://u:p@localhost:5432/db";
  process.env.AUTH_SECRET ??= "test-auth-secret-16chars";
});

describe("print token — informe-grupo", () => {
  const access = {
    periodId: "019f9b2c-57c5-7a40-ad2c-106a57b70f7d",
    groupId: "01a07489-aaaa-bbbb-cccc-dddddddddddd",
    institutionId: "inst-1",
    kind: "informe-grupo" as const,
  };

  it("round-trip: firma y verifica manteniendo periodId, groupId y kind", async () => {
    const { signPrintToken, verifyPrintToken } =
      await import("@/shared/infrastructure/crypto/print-token");
    const token = signPrintToken(access);
    const decoded = verifyPrintToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded).toEqual(access);
  });

  it("preserva los campos nuevos en el payload (sin evaluationId/bundleId)", async () => {
    const { signPrintToken, verifyPrintToken } =
      await import("@/shared/infrastructure/crypto/print-token");
    const token = signPrintToken(access);
    const decoded = verifyPrintToken(token);
    expect(decoded?.periodId).toBe(access.periodId);
    expect(decoded?.groupId).toBe(access.groupId);
    expect(decoded?.institutionId).toBe(access.institutionId);
    expect(decoded?.kind).toBe("informe-grupo");
    expect(decoded?.evaluationId).toBeUndefined();
    expect(decoded?.bundleId).toBeUndefined();
  });

  it("discrimina kind: un token con kind distinto no es válido para este path", async () => {
    // El token verifica (firma OK, no expirado), pero el caller compara
    // `access.kind !== expected.kind` en `resolvePrintActor` y rechaza.
    // Acá validamos que el round-trip no se rompe con otro kind.
    const { signPrintToken, verifyPrintToken } =
      await import("@/shared/infrastructure/crypto/print-token");
    const other = signPrintToken({ ...access, kind: "bundle" });
    const decoded = verifyPrintToken(other);
    expect(decoded).not.toBeNull();
    expect(decoded?.kind).toBe("bundle");
  });

  it("rechaza tokens manipulados (firma inválida)", async () => {
    const { signPrintToken, verifyPrintToken } =
      await import("@/shared/infrastructure/crypto/print-token");
    const token = signPrintToken(access);
    const [body, sig] = token.split(".");
    const tampered = `${body}.${sig?.split("").reverse().join("") ?? ""}`;
    expect(verifyPrintToken(tampered)).toBeNull();
  });
});
