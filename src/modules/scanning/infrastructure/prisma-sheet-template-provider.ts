import { Prisma } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { captureSheetGeometry } from "@/modules/printing/infrastructure/capture-sheet-geometry";
import type { SheetTemplate } from "@/modules/printing/domain/sheet-template";
import type { SheetTemplateProvider } from "../domain/answer-sheet";
import { logger } from "@/shared/infrastructure/logger";

const log = logger.child({ component: "sheet-template-provider" });

/**
 * Obtiene la geometría de la hoja de un compendio, midiéndola del render
 * real la primera vez y cacheándola en `EvaluationBundle.sheetTemplate`.
 *
 * La medición arranca Chromium (~2–3 s), demasiado caro para hacerlo en cada
 * hoja de un lote de 200. Como la rejilla depende del compendio y no del
 * estudiante, se mide una vez y se reutiliza.
 *
 * El caché NO se invalida solo. Es deliberado: si el layout de impresión
 * cambia, recapturar produciría una plantilla que ya no describe el papel
 * impreso. Quien detecta ese desajuste es la validación de alineación en el
 * escaneo, que manda la hoja a revisión. Para forzar una recaptura (p. ej.
 * tras reimprimir con un formato nuevo) hay que limpiar `sheetTemplate`.
 */
export class PrismaSheetTemplateProvider implements SheetTemplateProvider {
  async getForBundle(institutionId: string, bundleId: string): Promise<SheetTemplate | null> {
    const bundle = await prisma.evaluationBundle.findFirst({
      where: { id: bundleId, institutionId },
      select: { id: true, sheetTemplate: true },
    });
    if (!bundle) return null;

    if (bundle.sheetTemplate) {
      const cached = bundle.sheetTemplate as unknown as SheetTemplate;
      // Una plantilla sin finders no sirve para registrar: se vuelve a medir.
      if (cached.version === 1 && cached.bubbles?.length > 0 && cached.qrFinders?.length >= 3) {
        return cached;
      }
      log.warn({ bundleId }, "Plantilla cacheada inservible; se vuelve a medir");
    }

    // La ruta de impresión exige al menos un estudiante para renderizar.
    // Cualquiera sirve: la rejilla es la misma para todos.
    const student = await prisma.student.findFirst({
      where: { institutionId, deletedAt: null },
      select: { id: true },
    });
    if (!student) {
      log.warn({ bundleId }, "Sin estudiantes en la institución: no se puede medir la plantilla");
      return null;
    }

    let template: SheetTemplate;
    try {
      template = await captureSheetGeometry({
        bundleId,
        institutionId,
        sampleStudentId: student.id,
      });
    } catch (e) {
      // No es fatal: el lector cae a la detección de rejilla desde la imagen.
      log.error({ bundleId, err: (e as Error).message }, "Fallo al medir la plantilla");
      return null;
    }

    await prisma.evaluationBundle.update({
      where: { id: bundleId },
      data: {
        sheetTemplate: template as unknown as Prisma.InputJsonValue,
        sheetTemplateAt: new Date(),
      },
    });
    log.info({ bundleId, bubbles: template.bubbles.length }, "Plantilla medida y cacheada");
    return template;
  }
}
