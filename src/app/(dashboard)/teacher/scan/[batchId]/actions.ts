"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import {
  makeClassifyUnclassifiedScan,
  makeCorrectAnswerSheetAnswers,
} from "@/modules/scanning/infrastructure/container";
import { EstudianteConHojaError } from "@/modules/scanning/domain/unclassified-scan";
import { estudiantesDelCuadernillo } from "../_lib/estudiantes-del-cuadernillo";
import type { StudentOption } from "./[sheetId]/asignar-estudiante-button";
import type { AnswerKey } from "@/modules/evaluations/domain/evaluation";

/** Elige cuadernillo y estudiante para una hoja sin clasificar y la manda a
 *  calificar. La hoja puede quedar en otro lote (el de ese cuadernillo). */
export async function clasificarHojaAction(input: {
  batchId: string;
  unclassifiedScanId: string;
  bundleId: string;
  studentId: string;
}) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");

  const result = await makeClassifyUnclassifiedScan().execute({
    actor,
    unclassifiedScanId: input.unclassifiedScanId,
    bundleId: input.bundleId,
    studentId: input.studentId,
  });
  if (!result.ok) {
    return {
      ok: false as const,
      code: result.error.code,
      error: result.error.message,
      otraHoja: result.error instanceof EstudianteConHojaError ? result.error.otraHoja : null,
    };
  }

  revalidatePath(`/teacher/scan/${input.batchId}`);
  if (result.value.batchId !== input.batchId) {
    revalidatePath(`/teacher/scan/${result.value.batchId}`);
  }
  revalidatePath("/teacher/scan");
  return { ok: true as const, ...result.value };
}

/** Lista del selector de estudiante al cambiar el cuadernillo en la card. */
export async function estudiantesDelCuadernilloAction(bundleId: string): Promise<StudentOption[]> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  return estudiantesDelCuadernillo(actor.institutionId, bundleId);
}

/** Persiste las correcciones manuales hechas en la matriz de revisión por lote
 *  (teclas A-H). Recalcula la nota con el mismo criterio del worker y rechaza
 *  si alguna hoja del batch está en PROCESSING (el reproceso sobrescribiría
 *  la corrección al terminar).
 *
 *  Devuelve `ok: true` con la lista de hojas actualizadas (incluye score
 *  recalculado), o `ok: false` con un código estable que la UI muestra tal
 *  cual (`BATCH_NOT_FOUND`, `SHEET_NOT_IN_BATCH`, `SHEET_PROCESSING`,
 *  `POSITION_OUT_OF_RANGE`, `INVALID_KEY`). */
export async function guardarCorreccionesMatrizAction(input: {
  batchId: string;
  patches: {
    sheetId: string;
    corrections: { posicion: number; selectedKey: AnswerKey | null }[];
  }[];
}) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");

  const result = await makeCorrectAnswerSheetAnswers().execute({
    actor,
    batchId: input.batchId,
    patches: input.patches,
  });
  if (!result.ok) {
    return {
      ok: false as const,
      code: result.error.code,
      error: result.error.message,
    };
  }

  revalidatePath(`/teacher/scan/${input.batchId}`);
  for (const u of result.value.updatedSheets) {
    revalidatePath(`/teacher/scan/${input.batchId}/${u.sheetId}`);
  }
  revalidatePath("/teacher/scan");
  return { ok: true as const, updatedSheets: result.value.updatedSheets };
}
