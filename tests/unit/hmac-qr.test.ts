import { describe, expect, it } from "vitest";
import {
  deriveInstitutionSecret,
  signPayload,
  verifySignature,
} from "@/shared/infrastructure/crypto/hmac";
import { signedQrSchema } from "@/modules/scanning/domain/qr-payload";

const MASTER = "clave-maestra-de-prueba-32-chars!!";

const payload = {
  inst: "MDLM",
  eval: "00000000-0000-7000-8000-000000000001",
  student: "EST-001",
  sheet: "00000000-0000-7000-8000-000000000002",
  ts: 1_752_000_000,
};

describe("firma HMAC del QR", () => {
  it("la firma es determinista sin importar el orden de las claves", () => {
    const secret = deriveInstitutionSecret(MASTER, payload.inst);
    const sigA = signPayload(payload, secret);
    const reordered = {
      ts: payload.ts,
      sheet: payload.sheet,
      inst: payload.inst,
      eval: payload.eval,
      student: payload.student,
    };
    const sigB = signPayload(reordered, secret);
    expect(sigA).toBe(sigB);
    expect(sigA).toHaveLength(64);
  });

  it("verifica una firma válida y rechaza una adulterada", () => {
    const secret = deriveInstitutionSecret(MASTER, payload.inst);
    const sig = signPayload(payload, secret);
    expect(verifySignature(payload, sig, secret)).toBe(true);
    expect(verifySignature({ ...payload, student: "EST-999" }, sig, secret)).toBe(false);
  });

  it("cada institución deriva una clave distinta", () => {
    expect(deriveInstitutionSecret(MASTER, "MDLM")).not.toBe(
      deriveInstitutionSecret(MASTER, "OTRA"),
    );
  });

  it("el contenido firmado cumple el esquema del QR", () => {
    const secret = deriveInstitutionSecret(MASTER, payload.inst);
    const signed = { ...payload, sig: signPayload(payload, secret) };
    expect(signedQrSchema.safeParse(signed).success).toBe(true);
  });
});
