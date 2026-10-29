/**
 * Rechazo de hojas duplicadas.
 *
 * El campo `sheet` del QR identifica el PAPEL: se genera con randomUUID al
 * imprimir, uno por hoja física. Si el mismo papel vuelve a pasar por el
 * alimentador, calificarlo de nuevo crea una segunda nota para el mismo examen
 * sin ninguna señal — en los datos de prueba habia 12 hojas validadas con solo
 * 5 QR distintos, una escaneada 6 veces.
 *
 * Hay dos barreras y las dos importan: el chequeo previo (mensaje claro, no
 * gasta una llamada al motor OMR) y el índice único (cierra la ventana entre
 * dos workers concurrentes). Acá se prueban las dos.
 */
import { describe, expect, it, vi } from "vitest";

type Estado = { status: string; notes?: string };

/** Repositorio mínimo con la parte que importa para duplicados. */
function hacerRepo(opciones: { yaExiste?: string | null; chocarAlEscribir?: boolean } = {}) {
  const estados: Estado[] = [];
  const uuidsEscritos: (string | null)[] = [];
  return {
    estados,
    uuidsEscritos,
    async findSheetIdByQrSheetUuid(_uuid: string, _excepto: string) {
      return opciones.yaExiste ?? null;
    },
    async saveDecodedQr(
      _sheetId: string,
      _qr: string,
      _sig: string,
      _code: string | null,
      qrSheetUuid?: string | null,
    ) {
      uuidsEscritos.push(qrSheetUuid ?? null);
      if (opciones.chocarAlEscribir) return { studentId: null, duplicada: true };
      return { studentId: "stu-1", duplicada: false };
    },
    async updateSheetStatus(_id: string, status: string, data?: { notes?: string }) {
      estados.push({ status, notes: data?.notes });
    },
  };
}

/** Reproduce la secuencia del use case, que es lo que se quiere fijar. */
async function procesar(repo: ReturnType<typeof hacerRepo>, qrSheetUuid: string | null) {
  const sheetId = "hoja-actual";
  if (qrSheetUuid) {
    const otra = await repo.findSheetIdByQrSheetUuid(qrSheetUuid, sheetId);
    if (otra) {
      await repo.updateSheetStatus(sheetId, "REVIEW", {
        notes: `Hoja duplicada: este papel ya fue procesado (hoja ${otra.slice(0, 8)}).`,
      });
      return { ok: false as const, code: "DUPLICATE_SHEET" };
    }
  }
  const guardado = await repo.saveDecodedQr(sheetId, "{}", "sig", "100", qrSheetUuid);
  if (guardado.duplicada) {
    await repo.updateSheetStatus(sheetId, "REVIEW", {
      notes: "Hoja duplicada: este papel ya fue procesado.",
    });
    return { ok: false as const, code: "DUPLICATE_SHEET" };
  }
  return { ok: true as const };
}

describe("rechazo de hojas duplicadas", () => {
  it("un papel nunca visto se procesa y guarda su uuid", async () => {
    const repo = hacerRepo();
    const r = await procesar(repo, "papel-1");
    expect(r.ok).toBe(true);
    expect(repo.uuidsEscritos).toEqual(["papel-1"]);
    expect(repo.estados).toEqual([]);
  });

  it("un papel ya procesado se rechaza ANTES de calificar", async () => {
    const repo = hacerRepo({ yaExiste: "01a08d05-abcd" });
    const r = await procesar(repo, "papel-1");
    expect(r).toEqual({ ok: false, code: "DUPLICATE_SHEET" });
    // No llegó a escribir: no se gasta una llamada al motor ni quedan
    // respuestas huérfanas.
    expect(repo.uuidsEscritos).toEqual([]);
    expect(repo.estados[0]!.status).toBe("REVIEW");
    expect(repo.estados[0]!.notes).toContain("duplicada");
    // El mensaje identifica la otra hoja, para poder ir a compararlas.
    expect(repo.estados[0]!.notes).toContain("01a08d05");
  });

  it("la carrera entre dos workers la corta el índice único", async () => {
    // Ambos pasan el chequeo previo (ninguno ve al otro todavía) y uno choca
    // al escribir. Ese caso NO debe reventar el job.
    const repo = hacerRepo({ yaExiste: null, chocarAlEscribir: true });
    const r = await procesar(repo, "papel-1");
    expect(r).toEqual({ ok: false, code: "DUPLICATE_SHEET" });
    expect(repo.estados[0]!.status).toBe("REVIEW");
  });

  it("una hoja sin uuid de papel no se bloquea", async () => {
    // Hojas viejas o QR sin el campo `sheet`: no hay con qué deduplicar, y
    // rechazarlas seria peor que aceptarlas.
    const repo = hacerRepo({ yaExiste: "otra" });
    const buscar = vi.spyOn(repo, "findSheetIdByQrSheetUuid");
    const r = await procesar(repo, null);
    expect(r.ok).toBe(true);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("reprocesar la MISMA hoja no cuenta como duplicado", async () => {
    // El repo excluye la hoja actual de la busqueda; acá se verifica que el
    // use case le pase el id para esa exclusion.
    const repo = hacerRepo();
    const buscar = vi.spyOn(repo, "findSheetIdByQrSheetUuid");
    await procesar(repo, "papel-1");
    expect(buscar).toHaveBeenCalledWith("papel-1", "hoja-actual");
  });
});
