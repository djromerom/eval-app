import { describe, expect, it } from "vitest";
import { qrPayloadSchema, signedQrSchema } from "@/modules/scanning/domain/qr-payload";

describe("QR payload — bundle (Sprint 2)", () => {
  const baseEvaluation = {
    inst: "MDLM",
    eval: "00000000-0000-7000-8000-000000000001",
    student: "EST-001",
    sheet: "00000000-0000-7000-8000-000000000002",
    ts: 1_752_000_000,
  };

  const baseBundle = {
    inst: "MDLM",
    bundle: "00000000-0000-7000-8000-000000000099",
    student: "EST-001",
    sheet: "00000000-0000-7000-8000-000000000002",
    ts: 1_752_000_000,
  };

  it("acepta payload de evaluación individual", () => {
    expect(qrPayloadSchema.safeParse(baseEvaluation).success).toBe(true);
  });

  it("acepta payload de bundle (compendio)", () => {
    expect(qrPayloadSchema.safeParse(baseBundle).success).toBe(true);
  });

  it("rechaza payload con ambos eval y bundle", () => {
    const both = { ...baseEvaluation, bundle: baseBundle.bundle };
    expect(qrPayloadSchema.safeParse(both).success).toBe(false);
  });

  it("rechaza payload sin eval ni bundle", () => {
    const neither = {
      inst: "MDLM",
      student: "EST-001",
      sheet: "00000000-0000-7000-8000-000000000002",
      ts: 1_752_000_000,
    };
    expect(qrPayloadSchema.safeParse(neither).success).toBe(false);
  });

  it("signedQrSchema valida XOR y exige firma de 64 chars", () => {
    const sig = "a".repeat(64);
    expect(signedQrSchema.safeParse({ ...baseBundle, sig }).success).toBe(true);
    expect(signedQrSchema.safeParse({ ...baseEvaluation, sig }).success).toBe(true);
    expect(signedQrSchema.safeParse({ ...baseBundle, sig: "short" }).success).toBe(false);
    expect(
      signedQrSchema.safeParse({ ...baseEvaluation, bundle: baseBundle.bundle, sig }).success,
    ).toBe(false);
  });
});
