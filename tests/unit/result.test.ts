import { describe, expect, it } from "vitest";
import {
  DomainError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  fail,
  ok,
} from "@/shared/domain/result";

describe("Result", () => {
  it("ok envuelve un valor", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it("fail envuelve un error", () => {
    const error = new ValidationError("mal");
    const result = fail(error);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(error);
  });

  it("los errores de dominio tienen código estable", () => {
    expect(new NotFoundError("Institución", "x").code).toBe("NOT_FOUND");
    expect(new ForbiddenError().code).toBe("FORBIDDEN");
    expect(new ValidationError("y").code).toBe("VALIDATION");
    expect(new DomainError("CUSTOM", "z").code).toBe("CUSTOM");
  });
});
