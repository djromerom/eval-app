/**
 * Hojas sin clasificar de la carga automática.
 *
 * En modo Automático cada hoja trae su cuadernillo en el QR. Las que no lo
 * permiten saber (QR ilegible, firma inválida, cuadernillo no LISTO...) no
 * pueden tener AnswerSheet todavía: la hoja exige un cuadernillo o una
 * formulación. Se guardan como `UnclassifiedScan` en el primer lote de la
 * carga, y alguien les elige cuadernillo y estudiante a mano desde ese lote.
 */
import { DomainError } from "@/shared/domain/result";

export interface HojaSinClasificar {
  id: string;
  institutionId: string;
  /** Lote donde se muestra: el primero de la carga. */
  scanBatchId: string;
  /** Ruta relativa en storage. El archivo no se mueve al clasificarla. */
  filePath: string;
  originalFilename: string | null;
  /** Código de `MotivoSinClasificar`. */
  reason: string;
  resolvedAt: Date | null;
}

export interface CuadernilloParaClasificar {
  id: string;
  status: string;
  /** Cursos que cubren las formulaciones del cuadernillo. */
  courseIds: string[];
}

/** Lo que hace falta de un lote para decidir a cuál va la hoja. */
export interface LoteParaDestino {
  id: string;
  bundleId: string | null;
  uploadedBy: string;
  createdAt: Date;
}

/**
 * A qué lote va una hoja clasificada a mano. La hoja tiene que quedar en un
 * lote de SU cuadernillo: el bloqueo de inhabilitar preguntas y la matriz de
 * revisión se leen por `ScanBatch.bundleId`.
 *
 *   1. Si el cuadernillo es el del lote de origen, ese lote.
 *   2. Si no, el lote más antiguo de ese cuadernillo que subió la misma
 *      persona desde el lote de origen: los lotes hermanos de la misma carga
 *      se crean justo después del primero, y los que crean clasificaciones
 *      anteriores llevan el `uploadedBy` del origen.
 *   3. Si no hay, `null`: hay que crear uno.
 */
export function elegirLoteDestino(
  origen: LoteParaDestino,
  bundleId: string,
  candidatos: LoteParaDestino[],
): string | null {
  if (origen.bundleId === bundleId) return origen.id;
  const desde = origen.createdAt.getTime();
  const validos = candidatos
    .filter(
      (c) =>
        c.bundleId === bundleId &&
        c.uploadedBy === origen.uploadedBy &&
        c.createdAt.getTime() >= desde,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  return validos[0]?.id ?? null;
}

/** El estudiante ya tiene otra hoja calificada de ese cuadernillo. */
export class EstudianteConHojaError extends DomainError {
  constructor(
    message: string,
    public readonly otraHoja: { id: string; batchId: string } | null,
  ) {
    super("DUPLICATE_STUDENT", message);
    this.name = "EstudianteConHojaError";
  }
}

export interface UnclassifiedScanRepository {
  findById(institutionId: string, id: string): Promise<HojaSinClasificar | null>;
  findBundle(institutionId: string, bundleId: string): Promise<CuadernilloParaClasificar | null>;
  /** Activo, sin borrar y en un grupo de alguno de esos cursos. */
  studentInCourses(institutionId: string, studentId: string, courseIds: string[]): Promise<boolean>;
  /**
   * Otra hoja de este estudiante en este cuadernillo que impide darle una
   * segunda: calificada, en cola o en proceso, o clasificada a mano (aunque
   * todavía no tenga nota). Sin QR no hay id de papel con qué detectar el
   * duplicado, y los reportes toman la hoja más reciente.
   */
  findBlockingSheetOf(
    bundleId: string,
    studentId: string,
  ): Promise<{ id: string; scanBatchId: string | null } | null>;
  /**
   * En una transacción: reclama la hoja sin clasificar (si otra persona ya la
   * clasificó devuelve "ALREADY_RESOLVED"), vuelve a mirar el duplicado con
   * bloqueo (dos clasificaciones simultáneas del mismo estudiante no pasan
   * las dos), elige o crea el lote destino con `elegirLoteDestino`, crea la
   * AnswerSheet y la enlaza. Si hay duplicado no deja nada escrito.
   */
  resolverEnHoja(args: {
    hoja: HojaSinClasificar;
    bundleId: string;
    studentId: string;
    resolvedBy: string;
  }): Promise<
    | { sheetId: string; batchId: string }
    | "ALREADY_RESOLVED"
    | { duplicada: { id: string; scanBatchId: string | null } }
  >;
  /** La cola no aceptó el job: la hoja queda en SCANNED para Reprocesar. */
  marcarNoEncolada(sheetId: string): Promise<void>;
}

export interface OmrJobQueue {
  /** Encola la calificación. Si falla, la hoja queda para Reprocesar. */
  enqueue(job: {
    answerSheetId: string;
    scanBatchId: string;
    institutionId: string;
    imagePath: string;
  }): Promise<void>;
}
