"use server";

import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeClassifyUnclassifiedScan } from "@/modules/scanning/infrastructure/container";
import { EstudianteConHojaError } from "@/modules/scanning/domain/unclassified-scan";
import { estudiantesDelCuadernillo } from "../_lib/estudiantes-del-cuadernillo";
import type { StudentOption } from "./[sheetId]/asignar-estudiante-button";

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
