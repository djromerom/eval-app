"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import type { AdminFormState } from "@/components/admin/entity-form";
import type { AnswerKey, SoloLevel } from "@/modules/evaluations/domain/evaluation";
import {
  MIN_OPTIONS,
  ANSWER_KEYS_ORDER,
  SECTION_COLUMN_LAYOUTS,
  type SectionColumnLayout,
} from "@/modules/evaluations/domain/evaluation";
import { env } from "@/config/env";
import {
  makeListAcademicYears,
  makeListCourseSubjects,
  makeListPeriods,
} from "@/modules/academic/infrastructure/container";
import {
  makeAddQuestion,
  makeAddSection,
  makeChangeEvaluationStatus,
  makeCreateEvaluation,
  makeDeleteQuestion,
  makeDeleteSection,
  makeDuplicateQuestion,
  makeReorderQuestions,
  makeUpdateQuestion,
  makeUpdateSection,
} from "@/modules/evaluations/infrastructure/container";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/**
 * Parsea el override de layout de impresión del formData.
 *
 * - Vacío o ausente → `null` (auto / heurística).
 * - "1col" / "2col" → el valor tipado.
 * - Cualquier otro valor (por tampering del cliente) → `null` defensivo.
 *
 * El setter por sección es opt-in: si el docente no toca el select, queda
 * en `null` y la heurística decide. Si pone "2col", el cuadernillo ignora
 * la heurística y fuerza 2 columnas para esa sección.
 */
function parseColumnLayoutOverride(formData: FormData, key: string): SectionColumnLayout | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (!raw) return null;
  return (SECTION_COLUMN_LAYOUTS as readonly string[]).includes(raw)
    ? (raw as SectionColumnLayout)
    : null;
}

/** Parsea el JSON del editor rico; si no es JSON válido, lo trata como texto.
 *
 * Solo intenta parsear cuando el valor PARECE un objeto/array JSON
 * (arranca con `{` o `[` después de trim). De otro modo lo devuelve
 * crudo como string.
 *
 * Por qué el guard: el OptionInput renderiza un `<Input>` plano
 * cuando el contenido inicial no es complejo (string o doc vacío).
 * Si el docente tipea "1", "true", "null", "1.5" o "[hola]",
 * `JSON.parse` convierte eso en primitivo (number/boolean/null) y
 * luego `richTextToPlain(primitivo)` devuelve "" (la función solo
 * maneja string y objeto) → la validación falla con "Llena la
 * opción X antes de guardar" aunque el docente haya tipeado texto
 * real. Bug ago 2026: solo se disparaba en modo Input plano, no en
 * TipTap (el hidden input del TipTap siempre envía JSON válido).
 */
function rich(formData: FormData, key: string): unknown {
  const raw = str(formData, key);
  if (!raw) return undefined;
  const head = raw.trimStart();
  if (head.startsWith("{") || head.startsWith("[")) {
    try {
      return JSON.parse(raw);
    } catch {
      // Parecía JSON (arrancaba con { o [) pero está malformado: lo
      // dejamos como texto plano para que la validación cliente lo
      // pueda mostrar.
      return raw;
    }
  }
  return raw;
}

export async function createEvaluationAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");
  const bookletRaw = str(formData, "bookletNumber");
  // Sprint 7: duración estimada opcional al crear. "" → null (recae al
  // cálculo heurístico en la portada del cuadernillo). Si el input trae
  // basura no-entera, se omite (undefined → use case no valida).
  const durationRaw = str(formData, "durationMinutes");
  let durationMinutes: number | null | undefined;
  if (durationRaw === "") {
    durationMinutes = null;
  } else {
    const parsed = Number(durationRaw);
    durationMinutes = Number.isInteger(parsed) ? parsed : undefined;
  }

  const courseSubjectId = str(formData, "courseSubjectId");
  const periodId = str(formData, "periodId") || undefined;
  // ago 2026: tipo de cuadernillo opcional seleccionado por el docente.
  // "" → undefined (la formulación queda sin tipo). El use case valida
  // que el id pertenezca al mismo `periodId` de la formulación.
  const bookletTypeId = str(formData, "bookletTypeId") || undefined;

  // Auto-generamos el título como `${Asignatura} ${Curso} - ${Año}`. Año
  // viene del año académico del periodo seleccionado; si no hay periodo,
  // usamos el año actual del calendario. Sin guion entre asignatura y
  // curso (ago 2026): el docente pidió solo el guion antes del año, no
  // después del nombre de la asignatura.
  const [csRes, periodsRes, yearsRes] = await Promise.all([
    makeListCourseSubjects().execute({ actor }),
    makeListPeriods().execute({ actor }),
    makeListAcademicYears().execute({ actor }),
  ]);
  const courseSubjects = csRes.ok ? csRes.value : [];
  const periods = periodsRes.ok ? periodsRes.value : [];
  const years = yearsRes.ok ? yearsRes.value : [];

  const cs = courseSubjects.find((c) => c.id === courseSubjectId);
  if (!cs) {
    return { error: "La asignatura-grado no existe en tu institución." };
  }

  let year = new Date().getFullYear();
  if (periodId) {
    const period = periods.find((p) => p.id === periodId);
    if (period) {
      const ay = years.find((y) => y.id === period.academicYearId);
      if (ay) year = ay.year;
    }
  }

  const title = `${cs.subjectName} ${cs.courseName} - ${year}`;

  const result = await makeCreateEvaluation().execute({
    actor,
    data: {
      title,
      courseSubjectId,
      periodId,
      bookletNumber: bookletRaw ? Number(bookletRaw) : undefined,
      bookletTypeId,
      durationMinutes,
    },
  });
  if (!result.ok) return { error: result.error.message };
  redirect(`/teacher/evaluations/${result.value.id}/unified`);
}

export async function addSectionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeAddSection().execute({
    actor,
    evaluationId,
    data: {
      title: str(formData, "title") || undefined,
      content: rich(formData, "content"),
      columnLayoutOverride: parseColumnLayoutOverride(formData, "columnLayoutOverride"),
    },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  // Devolvemos el id de la sección creada para que el editor unificado
  // pueda usarlo inmediatamente (ej. al guardar contexto + pregunta en un
  // solo click, la pregunta se asocia a esta sección recién creada).
  return { success: true, sectionId: result.value.id };
}

export async function updateSectionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeUpdateSection().execute({
    actor,
    evaluationId,
    sectionId: str(formData, "sectionId"),
    // Título vacío → null: el contexto vuelve a rotularse "Contexto N".
    data: {
      title: str(formData, "title") || null,
      content: rich(formData, "content"),
      columnLayoutOverride: parseColumnLayoutOverride(formData, "columnLayoutOverride"),
    },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}

export async function deleteSectionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeDeleteSection().execute({
    actor,
    evaluationId,
    sectionId: str(formData, "sectionId"),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}

export async function addQuestionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const evaluationId = str(formData, "evaluationId");
  const soloLevel = str(formData, "soloLevel");
  const weightRaw = str(formData, "weight");

  // Lee la cantidad de opciones del formulario y la clampa a
  // [MIN_OPTIONS, env.EVAL_MAX_OPTIONS]. El form siempre envía
  // `optionCount` con el total actual de opciones visibles; el clamp
  // cubre dos casos: el cliente envía basura, o el admin bajó el
  // tope en .env y alguien tenía un form abierto con más opciones.
  // La librería tiene como techo absoluto 8 (AnswerKey A–H); la
  // cota real la pone la institución con EVAL_MAX_OPTIONS.
  const optionCountRaw = Number(str(formData, "optionCount"));
  const optionCount = Number.isInteger(optionCountRaw)
    ? Math.min(env.EVAL_MAX_OPTIONS, Math.max(MIN_OPTIONS, optionCountRaw))
    : env.EVAL_DEFAULT_OPTIONS;
  const keys = ANSWER_KEYS_ORDER.slice(0, optionCount) as AnswerKey[];

  const result = await makeAddQuestion().execute({
    actor,
    evaluationId,
    sectionId: str(formData, "sectionId"),
    data: {
      text: rich(formData, "text"),
      options: keys.map((key) => ({
        key,
        text: rich(formData, `option${key}`),
      })),
      correctAnswer: str(formData, "correctAnswer") as AnswerKey,
      justification: str(formData, "justification") || undefined,
      weight: weightRaw ? Number(weightRaw) : undefined,
      soloLevel: (soloLevel || null) as SoloLevel | null,
      menComponent: str(formData, "menComponent") || undefined,
      competency: str(formData, "competency") || undefined,
    },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  // Devolvemos el `sectionId` real persistido (no el que envió el
  // cliente) para que el editor unificado pueda sincronizar
  // `targetSectionId` con la verdad del servidor. (ago 2026, pedido del
  // docente: usar el sectionId real del response, no del cliente).
  return { success: true, sectionId: result.value.sectionId };
}

export async function updateQuestionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const evaluationId = str(formData, "evaluationId");
  const soloLevel = str(formData, "soloLevel");
  const weightRaw = str(formData, "weight");

  // Mismo clamp que en el alta: el form envía el total de opciones visibles.
  const optionCountRaw = Number(str(formData, "optionCount"));
  const optionCount = Number.isInteger(optionCountRaw)
    ? Math.min(env.EVAL_MAX_OPTIONS, Math.max(MIN_OPTIONS, optionCountRaw))
    : env.EVAL_DEFAULT_OPTIONS;
  const keys = ANSWER_KEYS_ORDER.slice(0, optionCount) as AnswerKey[];

  const result = await makeUpdateQuestion().execute({
    actor,
    evaluationId,
    questionId: str(formData, "questionId"),
    data: {
      text: rich(formData, "text"),
      options: keys.map((key) => ({ key, text: rich(formData, `option${key}`) })),
      correctAnswer: str(formData, "correctAnswer") as AnswerKey,
      justification: str(formData, "justification") || null,
      weight: weightRaw ? Number(weightRaw) : undefined,
      soloLevel: (soloLevel || null) as SoloLevel | null,
      menComponent: str(formData, "menComponent") || null,
      competency: str(formData, "competency") || null,
    },
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}

export async function deleteQuestionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeDeleteQuestion().execute({
    actor,
    evaluationId,
    questionId: str(formData, "questionId"),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  return { success: true };
}

/**
 * Duplica la pregunta indicada. La copia queda al final de la numeración
 * (`totalQuestions + 1`) y hereda todo el contenido (enunciado, opciones,
 * respuesta correcta, peso, justificación, etc.). `revalidatePath` refresca
 * tanto el índice de contextos como el editor de la sección afectada.
 */
export async function duplicateQuestionAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeDuplicateQuestion().execute({
    actor,
    evaluationId,
    questionId: str(formData, "questionId"),
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}/contexts`);
  return { success: true };
}

/**
 * Server action para el drag & drop del editor por contexto. Recibe la lista
 * de IDs de preguntas en el orden deseado tras el drop, en formato JSON
 * dentro de `orderedIds` (form-data es plano, no soporta arrays nativos).
 *
 * El use case valida pertenencia, DRAFT-only y ownership antes de renumerar.
 */
export async function reorderQuestionsAction(formData: FormData): Promise<AdminFormState> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const evaluationId = str(formData, "evaluationId");
  const sectionId = str(formData, "sectionId");
  const orderedIdsRaw = str(formData, "orderedIds");

  let orderedQuestionIds: string[];
  try {
    const parsed = JSON.parse(orderedIdsRaw);
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) {
      throw new Error("orderedIds no es un array de strings.");
    }
    orderedQuestionIds = parsed;
  } catch (e) {
    return { error: `Lista de preguntas inválida: ${(e as Error).message}` };
  }

  const result = await makeReorderQuestions().execute({
    actor,
    evaluationId,
    sectionId,
    orderedQuestionIds,
  });
  if (!result.ok) return { error: result.error.message };
  revalidatePath(`/teacher/evaluations/${evaluationId}/contexts`);
  revalidatePath(`/teacher/evaluations/${evaluationId}/contexts/${sectionId}`);
  return { success: true };
}

export async function submitForReviewAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeChangeEvaluationStatus().execute({
    actor,
    evaluationId,
    to: "IN_REVIEW",
  });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  revalidatePath("/teacher/evaluations");
}

/**
 * Publica una formulación en DRAFT directamente a PUBLISHED (atajo del
 * editor unificado, ago 2026). El flujo canónico sigue siendo
 * DRAFT → IN_REVIEW → APPROVED → PUBLISHED; este server action es solo
 * para el botón "Publicar" del unified. Mismas validaciones de dominio
 * (ownership + roles) que cualquier otra transición. Tras publicar,
 * revalida todas las rutas donde la formulación aparece como estado.
 */
export async function publishEvaluationAction(formData: FormData): Promise<void> {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");
  const evaluationId = str(formData, "evaluationId");
  const result = await makeChangeEvaluationStatus().execute({
    actor,
    evaluationId,
    to: "PUBLISHED",
  });
  if (!result.ok) throw new Error(result.error.message);
  revalidatePath(`/teacher/evaluations/${evaluationId}`);
  revalidatePath(`/teacher/evaluations/${evaluationId}/unified`);
  revalidatePath(`/teacher/evaluations/${evaluationId}/contexts`);
  revalidatePath("/teacher/evaluations");
}
