import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { DomainError, type Result, fail, ok } from "@/shared/domain/result";
import { localStorage } from "@/shared/infrastructure/storage/local-storage";
import type { AnswerKey } from "@/modules/evaluations/domain/evaluation";
import type {
  ScanningRepository,
  StudentAnswerRecord,
  StudentAnswersReader,
} from "../domain/answer-sheet";
import type { EvaluationQuestionsProvider } from "./process-answer-sheet";

const ANSWER_KEYS: ReadonlySet<AnswerKey> = new Set([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
]);

function isAnswerKey(value: string): value is AnswerKey {
  return (ANSWER_KEYS as Set<string>).has(value);
}

export interface CorrectAnswerSheetAnswersInput {
  actor: AuthenticatedUser;
  batchId: string;
  patches: {
    sheetId: string;
    /** `posicion` es 1-based: coincide con `n` del grid.json y con el orden
     *  de scan del motor (`StudentAnswer.id` asc). El cliente convierte su
     *  índice 0-based sumándole 1 antes de enviar. */
    corrections: { posicion: number; selectedKey: AnswerKey | null }[];
  }[];
}

export interface CorrectAnswerSheetAnswersOutput {
  updatedSheets: {
    sheetId: string;
    score: number | null;
    totalCorrect: number | null;
    totalQuestions: number | null;
    /** Cuántas celdas se corrigieron en esta hoja. */
    changed: number;
  }[];
}

/**
 * Persiste las correcciones manuales que un docente hizo en la matriz de
 * revisión por lote (teclado A-H + Supr). Cada corrección sobreescribe la
 * `StudentAnswer` correspondiente, recalcula la nota con el mismo criterio
 * que el worker (excluyendo inhabitadas) y reescribe el `grid.json` cache
 * para que la próxima carga de la matriz muestre las correcciones sin
 * necesidad de mantenerlas en estado client.
 *
 * Reglas, en orden (cada una con código estable para la UI):
 *   1. Rol: TEACHER, ECU_LIDER o ECU_MASTER.
 *   2. El lote existe y es de la institución del actor.
 *   3. Cada `sheetId` pertenece al `batchId` Y NO está en `PROCESSING`
 *      (un reproceso en curso sobrescribiría la corrección al terminar).
 *   4. Cada `posicion` está en `1..nAnswers` de su hoja y cada `selectedKey`
 *      es una letra válida (A-H) o null (interpretado como BLANCO).
 *   5. Si la validación falla, no se escribe NADA — ni siquiera las hojas
 *      que sí estaban bien.
 *
 * El status de la hoja se preserva (REVIEW sigue REVIEW, GRADED sigue
 * GRADED): una corrección manual no es marca de "revisado por humano", es
 * una corrección del resultado de la detección. Las preguntas inhabitadas
 * del cuadernillo siguen sin contar para la nota (mismo criterio que
 * `ProcessAnswerSheet.execute`, ver `process-answer-sheet.ts:349-376`).
 *
 * El reescribir `grid.json` es best-effort: si falla (storage caído), el
 * resultado sigue siendo `ok: true` con las correcciones ya en DB. La
 * matriz del lote quedará desfasada hasta el próximo reproceso del worker,
 * que sí regenera el cache.
 */
export class CorrectAnswerSheetAnswers implements UseCase<
  CorrectAnswerSheetAnswersInput,
  CorrectAnswerSheetAnswersOutput
> {
  constructor(
    private readonly repo: ScanningRepository,
    private readonly answersReader: StudentAnswersReader,
    private readonly questionsProvider: EvaluationQuestionsProvider,
  ) {}

  async execute(
    input: CorrectAnswerSheetAnswersInput,
  ): Promise<Result<CorrectAnswerSheetAnswersOutput>> {
    const auth = requireRole(input.actor, "TEACHER", "ECU_LIDER", "ECU_MASTER");
    if (!auth.ok) return auth;

    const batch = await this.repo.getScanBatch(input.actor.institutionId, input.batchId);
    if (!batch) {
      return fail(new DomainError("BATCH_NOT_FOUND", "Lote no encontrado."));
    }

    // Validación upfront: junta TODOS los errores antes de escribir nada.
    // Si cualquier hoja está mal, ninguna se toca.
    const validation = validatePatches(input.patches);
    if (!validation.ok) return fail(validation.error);

    const updatedSheets: CorrectAnswerSheetAnswersOutput["updatedSheets"] = [];

    for (const patch of input.patches) {
      const sheet = await this.repo.getAnswerSheet(input.actor.institutionId, patch.sheetId);
      if (!sheet || sheet.scanBatchId !== input.batchId) {
        return fail(
          new DomainError(
            "SHEET_NOT_IN_BATCH",
            `La hoja ${patch.sheetId} no pertenece al lote.`,
          ),
        );
      }
      if (sheet.status === "PROCESSING") {
        return fail(
          new DomainError(
            "SHEET_PROCESSING",
            "Esta hoja se está procesando. Espera a que termine antes de guardar correcciones.",
          ),
        );
      }

      const isBundle = sheet.bundleId !== null;
      const correctAnswersRaw = isBundle
        ? await this.questionsProvider.getCorrectAnswersForBundle(
            input.actor.institutionId,
            sheet.bundleId!,
          )
        : await this.questionsProvider.getCorrectAnswers(input.actor.institutionId, sheet.evaluationId!);
      const correctByQuestionId = new Map(correctAnswersRaw.map((q) => [q.id, q]));

      const currentAnswers = await this.answersReader.listStudentAnswersForSheet(patch.sheetId);

      // Validación de rango contra el sheet actual: posicion ∈ 1..nAnswers.
      // Cada pregunta tiene una sola fila de StudentAnswer.
      for (const c of patch.corrections) {
        if (c.posicion < 1 || c.posicion > currentAnswers.length) {
          return fail(
            new DomainError(
              "POSITION_OUT_OF_RANGE",
              `La posición ${c.posicion} no existe en la hoja ${patch.sheetId} (tiene ${currentAnswers.length} ítems).`,
            ),
          );
        }
      }

      // Aplica las correcciones. Mismo orden que el scan del motor: `id` asc,
      // así que `posicion - 1` es el índice correcto en el array.
      const newAnswers = currentAnswers.map((row, idx) => {
        const corr = patch.corrections.find((c) => c.posicion === idx + 1);
        if (!corr) return row;
        const correct = correctByQuestionId.get(row.questionId);
        // Sin match por pregunta (hoja legacy con preguntas no vigentes,
        // por ejemplo): preservamos la fila tal cual. El docente solo puede
        // haber acertado a una pregunta que existe en la clave.
        if (!correct) return row;
        const isCorrect =
          corr.selectedKey !== null && corr.selectedKey === correct.correctAnswer;
        // El override explícito del docente desambigua: si eligió una sola
        // letra, la hoja NO va a revisión por causa de esta celda.
        return {
          ...row,
          selectedKey: corr.selectedKey,
          isCorrect,
          isAmbiguous: false,
        };
      });

      const { totalCorrect, effectiveQuestions } = recomputeScore(
        newAnswers,
        correctAnswersRaw,
      );

      await this.repo.saveAnswers(patch.sheetId, newAnswers);
      await this.repo.updateSheetStatus(patch.sheetId, sheet.status, {
        score: totalCorrect,
        totalCorrect,
        totalQuestions: effectiveQuestions,
      });
      await rewriteGridJsonBestEffort(input.batchId, patch.sheetId, newAnswers);

      updatedSheets.push({
        sheetId: patch.sheetId,
        score: totalCorrect,
        totalCorrect,
        totalQuestions: effectiveQuestions,
        changed: patch.corrections.length,
      });
    }

    return ok({ updatedSheets });
  }
}

/** Validación estructural de TODOS los patches: hoja por hoja, una sola
 *  pasada. Devuelve el primer error encontrado (los códigos son estables
 *  y la UI los muestra tal cual). */
function validatePatches(
  patches: CorrectAnswerSheetAnswersInput["patches"],
): Result<true> {
  for (const patch of patches) {
    if (!patch.sheetId || typeof patch.sheetId !== "string") {
      return fail(new DomainError("INVALID_KEY", "Falta el identificador de la hoja."));
    }
    for (const c of patch.corrections) {
      if (c.selectedKey !== null && !isAnswerKey(c.selectedKey)) {
        return fail(
          new DomainError(
            "INVALID_KEY",
            `"${c.selectedKey}" no es una opción válida (solo A-H).`,
          ),
        );
      }
      if (!Number.isInteger(c.posicion) || c.posicion < 1) {
        return fail(
          new DomainError("POSITION_OUT_OF_RANGE", `Posición inválida: ${c.posicion}.`),
        );
      }
    }
  }
  return ok(true);
}

/** Replica la regla de scoring del worker (`process-answer-sheet.ts:354-376`):
 *  una pregunta inhabitada no cuenta para `totalQuestions` ni para
 *  `totalCorrect`. `isCorrect === true` (no null, no false) es lo único
 *  que suma. */
function recomputeScore(
  answers: StudentAnswerRecord[],
  correctAnswers: { id: string; correctAnswer: AnswerKey; disabled?: boolean }[],
): { totalCorrect: number; effectiveQuestions: number } {
  const disabled = new Set(
    correctAnswers.filter((q) => q.disabled === true).map((q) => q.id),
  );
  let totalCorrect = 0;
  let effectiveQuestions = 0;
  for (const a of answers) {
    if (disabled.has(a.questionId)) continue;
    effectiveQuestions++;
    if (a.isCorrect === true) totalCorrect++;
  }
  return { totalCorrect, effectiveQuestions };
}

/** Reconstruye el `grid.json` cache desde las respuestas persistidas. La forma
 *  tiene que coincidir con `persistCells` del worker
 *  (`process-answer-sheet.ts:528-551`) porque `readGrid` en el lote lo lee
 *  igual. Si el archivo original tenía un `thr` distinto, lo conservamos;
 *  si falla la lectura del viejo, seguimos sin él (la página tolera null). */
async function rewriteGridJsonBestEffort(
  batchId: string,
  sheetId: string,
  answers: StudentAnswerRecord[],
): Promise<void> {
  const path = `scans/${batchId}/sheet_${sheetId}_grid.json`;
  let previousThr: number | null = null;
  try {
    const buf = await localStorage.read(path);
    const parsed = JSON.parse(buf.toString("utf-8")) as { thr?: number };
    previousThr = typeof parsed.thr === "number" ? parsed.thr : null;
  } catch {
    /* sin thr previo: seguimos sin él */
  }

  const grid = {
    thr: previousThr,
    answers: answers.map((a, idx) => ({
      n: idx + 1,
      ans: a.selectedKey ?? "BLANCO",
    })),
  };
  try {
    await localStorage.save(path, Buffer.from(JSON.stringify(grid), "utf-8"));
  } catch (e) {
    // best-effort: si el storage está caído, las correcciones ya viven en
    // StudentAnswer. La matriz del lote quedará desfasada hasta el próximo
    // reproceso del worker, que sí regenera el cache.
    console.warn(`[correct-answer-sheet-answers] no se pudo reescribir ${path}:`, e);
  }
}
