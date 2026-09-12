/**
 * `estadoDeHoja` cruza el ScanStatus con el puntaje. El caso que justifica la
 * función es el tercero: una hoja puede estar en REVIEW y tener nota.
 */
import { describe, expect, it } from "vitest";
import {
  estadoDeHoja,
  etiquetaEstado,
} from "@/modules/consultas/domain/queries/calificaciones/estado";

describe("estadoDeHoja", () => {
  it("sin puntaje es pendiente, sea cual sea el estado del escaneo", () => {
    expect(estadoDeHoja(null, "REVIEW")).toBe("pendiente");
    expect(estadoDeHoja(null, "PENDING")).toBe("pendiente");
    expect(estadoDeHoja(null, "GRADED")).toBe("pendiente");
  });

  it("con puntaje y GRADED es calificada", () => {
    expect(estadoDeHoja(32, "GRADED")).toBe("calificada");
    expect(estadoDeHoja(0, "GRADED")).toBe("calificada"); // 0 aciertos sigue siendo una nota
  });

  it("con puntaje pero en REVIEW es 'con observaciones'", () => {
    // El motor deja REVIEW cuando hay marcas ambiguas: la nota existe, pero
    // conviene mirar el papel. Perder esta distincion era el motivo de no
    // usar el ScanStatus crudo.
    expect(estadoDeHoja(29, "REVIEW")).toBe("observaciones");
  });

  it("COMPLETED es la salida de 'con observaciones'", () => {
    // Cuando alguien confirma a mano una hoja observada, el estado pasa a
    // COMPLETED y debe dejar de figurar como pendiente de revisar.
    expect(estadoDeHoja(29, "COMPLETED")).toBe("calificada");
  });

  it("las etiquetas son legibles", () => {
    expect(etiquetaEstado("observaciones")).toBe("Con observaciones");
    expect(etiquetaEstado("pendiente")).toBe("Pendientes");
  });
});
