/**
 * Tests puros de `computeItemsBadge`. 4 casos canónicos; sin BD.
 */
import { describe, expect, it } from "vitest";
import { computeItemsBadge, type ItemsBadge } from "@/modules/consultas/domain/shared/items-badge";

describe("computeItemsBadge", () => {
  it.each<[number, number | null, ItemsBadge]>([
    [10, 10, "ok"],
    [8, 10, "low"],
    [12, 10, "high"],
    [10, null, "none"],
    [0, 0, "ok"], // edge: regla pidiendo 0 (defensivo contra inputs malformados)
    [0, 5, "low"],
    [5, 0, "high"], // item extra cuando la regla es 0
  ])("total=%i expected=%s → %s", (total, expected, expectedBadge) => {
    expect(computeItemsBadge(total, expected)).toBe(expectedBadge);
  });
});
