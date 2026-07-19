import { describe, expect, it } from "vitest";
import { canTransition, findTransition, isLocked } from "@/modules/bundles/domain/bundle-status";

describe("bundle-status — máquina DRAFT → READY", () => {
  it("DRAFT → READY está permitido", () => {
    expect(canTransition("DRAFT", "READY")).toBe(true);
    const t = findTransition("DRAFT", "READY");
    expect(t).not.toBeNull();
    expect(t?.from).toBe("DRAFT");
    expect(t?.to).toBe("READY");
  });

  it("READY → DRAFT está permitido (UnmarkReady, uso futuro Sprint 3)", () => {
    expect(canTransition("READY", "DRAFT")).toBe(true);
  });

  it("DRAFT → DRAFT no es una transición válida", () => {
    expect(canTransition("DRAFT", "DRAFT")).toBe(false);
  });

  it("READY → READY no es una transición válida", () => {
    expect(canTransition("READY", "READY")).toBe(false);
  });

  it("isLocked: DRAFT es editable, READY no", () => {
    expect(isLocked("DRAFT")).toBe(false);
    expect(isLocked("READY")).toBe(true);
  });
});
