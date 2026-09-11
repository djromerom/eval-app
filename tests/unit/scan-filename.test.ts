/** Tests del nombrado de escaneos (sep 2026). */
import { describe, expect, it } from "vitest";
import { nombreDeArchivo } from "@/modules/scanning/domain/scan-filename";

const n = (f: string, i = 0, u = new Set<string>()) => nombreDeArchivo(f, i, u);

describe("nombreDeArchivo", () => {
  it("conserva el nombre original y le agrega el timestamp", () => {
    expect(n("20260909163256931_0051.tif")).toMatch(/^20260909163256931_0051_\d{13}\.tif$/);
  });
  it("normaliza la extension a minusculas", () => {
    expect(n("Hoja.TIF")).toMatch(/\.tif$/);
  });
  it("sin extension cae a png, no a 'undefined'", () => {
    expect(n("escaneo")).toMatch(/^escaneo_\d{13}\.png$/);
  });
  it("un file.name vacio no rompe: usa el indice", () => {
    expect(n("", 4)).toMatch(/^sheet_005_\d{13}\.png$/);
  });
  it("el nombre literal 'undefined' ya no produce extension .undefined", () => {
    expect(n("undefined")).not.toMatch(/\.undefined$/);
  });
  it("neutraliza intentos de salir del directorio", () => {
    const r = n("../../../etc/passwd.tif");
    expect(r).not.toContain("/");
    expect(r).not.toContain("..");
    expect(r).toMatch(/^passwd_\d{13}\.tif$/);
  });
  it("sanea espacios y acentos", () => {
    expect(n("hoja de María 3.png")).toMatch(/^hoja_de_Mar_a_3_\d{13}\.png$/);
  });
  it("dos archivos iguales en el mismo lote no se pisan", () => {
    const u = new Set<string>();
    const a = nombreDeArchivo("x.tif", 0, u);
    const b = nombreDeArchivo("x.tif", 1, u);
    expect(a).not.toBe(b);
  });
  it("acota el largo del nombre", () => {
    expect(n("a".repeat(300) + ".tif").length).toBeLessThan(110);
  });
});
