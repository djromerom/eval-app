/**
 * Tests de `safeReturnPath`. El caso que importa no es el feliz sino el
 * hostil: este valor viene de la query string y alimenta un href.
 */
import { describe, expect, it } from "vitest";
import { safeReturnPath } from "@/shared/domain/return-path";

const DEF = "/teacher/scan";

describe("safeReturnPath", () => {
  it("acepta rutas internas", () => {
    expect(safeReturnPath("/admin/consultas/calificaciones", DEF)).toBe(
      "/admin/consultas/calificaciones",
    );
    expect(safeReturnPath("/a?b=c&d=e#f", DEF)).toBe("/a?b=c&d=e#f");
  });

  it("cae al valor por defecto si no hay parámetro", () => {
    expect(safeReturnPath(undefined, DEF)).toBe(DEF);
    expect(safeReturnPath("", DEF)).toBe(DEF);
  });

  it("rechaza URLs absolutas y esquemas peligrosos", () => {
    expect(safeReturnPath("https://evil.test/phishing", DEF)).toBe(DEF);
    expect(safeReturnPath("javascript:alert(1)", DEF)).toBe(DEF);
    expect(safeReturnPath("data:text/html,x", DEF)).toBe(DEF);
  });

  it("rechaza protocol-relative, que empieza con / pero sale del sitio", () => {
    expect(safeReturnPath("//evil.test", DEF)).toBe(DEF);
    expect(safeReturnPath("/\\evil.test", DEF)).toBe(DEF);
  });

  it("rechaza saltos de línea", () => {
    expect(safeReturnPath("/ok\nLocation: https://evil.test", DEF)).toBe(DEF);
  });
});
