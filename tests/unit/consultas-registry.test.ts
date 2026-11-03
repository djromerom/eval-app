/**
 * Tests del catálogo de consultas: qué ve cada rol.
 *
 * La regla que se fija acá es la del módulo de consultas: el ECU_LIDER entra
 * al listado de formulaciones, pero solo con las consultas que lo incluyen
 * en `roles`. Lo que puede VER dentro de cada una (los grados que tiene
 * asignados) lo aplica el use case, no el registry.
 */
import { describe, expect, it } from "vitest";
import {
  CONSULTAS,
  consultasFor,
  findConsulta,
} from "@/modules/consultas/domain/consultas-registry";

describe("consultasFor — qué consultas ve cada rol", () => {
  it("el ECU_LIDER ve el listado de formulaciones", () => {
    const ids = consultasFor(["ECU_LIDER"]).map((c) => c.id);
    expect(ids).toContain("formulaciones");
  });

  it("el ECU_LIDER no ve las consultas que son solo de admin de institución", () => {
    const ids = consultasFor(["ECU_LIDER"]).map((c) => c.id);
    expect(ids).not.toContain("formuladores");
    expect(ids).not.toContain("reglas-conteo");
  });

  it("el ECU_MASTER ve todas las consultas", () => {
    expect(consultasFor(["ECU_MASTER"])).toHaveLength(CONSULTAS.length);
  });

  it("el docente no ve ninguna", () => {
    expect(consultasFor(["TEACHER"])).toHaveLength(0);
  });
});

describe("findConsulta — configuración por id", () => {
  it("devuelve la consulta del listado de formulaciones", () => {
    expect(findConsulta("formulaciones")?.title).toBe("Listado de Formulaciones");
  });

  it("devuelve undefined para un id desconocido", () => {
    expect(findConsulta("no-existe")).toBeUndefined();
  });
});
