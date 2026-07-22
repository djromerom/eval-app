import { describe, it } from "vitest";

describe("debug", () => {
  it("count", () => {
    const s = "¿z?,,,,B";
    console.log("length:", s.length);
    console.log(
      "chars:",
      [...s].map((c) => `${c}(${c.charCodeAt(0)})`),
    );
    console.log("split:", s.split(","));
  });
});
