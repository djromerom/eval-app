import { beforeAll, describe, expect, it, vi } from "vitest";

// El módulo lee env.QR_SIGNING_SECRET al importarse (via @/config/env).
beforeAll(() => {
  process.env.QR_SIGNING_SECRET ??= "test-secret-de-al-menos-16-chars";
  process.env.DATABASE_URL ??= "postgresql://u:p@localhost:5432/db";
  process.env.AUTH_SECRET ??= "test-auth-secret-16chars";
});

const access = {
  evaluationId: "eval-1",
  institutionId: "inst-1",
  kind: "booklet" as const,
};

describe("print-token", () => {
  it("firma y verifica un token válido (round-trip)", async () => {
    const { signPrintToken, verifyPrintToken } =
      await import("@/shared/infrastructure/crypto/print-token");
    const token = signPrintToken(access);
    expect(verifyPrintToken(token)).toEqual(access);
  });

  it("rechaza un token manipulado o basura", async () => {
    const { signPrintToken, verifyPrintToken } =
      await import("@/shared/infrastructure/crypto/print-token");
    const token = signPrintToken(access);
    const [body, sig] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ ...access, institutionId: "otra", exp: Date.now() + 10000 }),
    ).toString("base64url");
    expect(verifyPrintToken(`${tampered}.${sig}`)).toBeNull();
    expect(verifyPrintToken(`${body}.deadbeef`)).toBeNull();
    expect(verifyPrintToken("basura")).toBeNull();
  });

  it("rechaza un token expirado", async () => {
    const mod = await import("@/shared/infrastructure/crypto/print-token");
    const spy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const token = mod.signPrintToken(access); // exp = 1_000_000 + 5min
    spy.mockReturnValue(1_000_000 + 6 * 60 * 1000); // 6 min después
    expect(mod.verifyPrintToken(token)).toBeNull();
    spy.mockRestore();
  });
});
