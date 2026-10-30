import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type { EvaluationRepository } from "@/modules/evaluations/domain/evaluation";
import type {
  BankQuestionRepository,
  CreateBankQuestionData,
} from "@/modules/question-bank/domain/bank-question";
import {
  type ParsedQuestion,
  type ParsedQuestionProblem,
  partitionParsedQuestionsWithIndexes,
} from "../domain/parsed-question";
import {
  STRICT_DEFAULT_RESOLVER,
  type OptionRuleResolver,
  type OptionsRange,
  isOptionsCountAllowed,
  optionsCountErrorMessage,
} from "@/modules/option-rules/domain/option-rule";
import {
  collectUniqueContexts,
  mergeContextsIntoSectionContent,
  prependContextToBankQuestion,
  stripContextFromQuestions,
} from "./context-stitch";
import { contextTextToTipTap } from "./context-to-tiptap";
import { latexTextToTipTapNodes } from "./latex-to-tiptap";

/**
 * A dónde van las preguntas importadas. Lo elige el docente en la pantalla de
 * revisión: puede meterlas en la formulación que está armando, o guardarlas en
 * el banco para reutilizarlas después.
 *
 * `sectionId` es OPCIONAL cuando el destino es "evaluation": si falta y las
 * preguntas traen contextos compartidos, el use case crea una sección por cada
 * contexto y reparte las preguntas según `contextTitle`. Si falta y NO hay
 * contextos, devuelve error (no hay ancla donde meter las preguntas).
 */
export type ImportDestination =
  | { kind: "evaluation"; evaluationId: string; sectionId?: string }
  | { kind: "bank"; subjectId: string };

export interface ImportQuestionsInput {
  actor: AuthenticatedUser;
  questions: ParsedQuestion[];
  destination: ImportDestination;
}

export interface ImportQuestionsResult {
  imported: number;
  /** Las que no se pudieron dar de alta, con el motivo. */
  problems: ParsedQuestionProblem[];
  /** Mensajes no-fatales sobre cómo se acomodaron cosas (contexto compartido,
   *  advertencias estructurales). Se muestran en el banner de éxito para
   *  que el docente sepa qué pasó con su información. */
  infos: string[];
}

/**
 * Da de alta las preguntas que el docente confirmó en la revisión.
 *
 * Igual que `ImportStudents`, NO aborta ante una pregunta mala: da de alta las
 * buenas y devuelve el detalle de las que se quedaron fuera. Importar 20
 * preguntas y perderlas todas porque una tenía una opción vacía sería un mal
 * negocio para el docente.
 *
 * El texto llega como string plano desde los parsers y se convierte aquí a
 * documento TipTap, que es lo que espera la base de datos.
 *
 * Sobre el contexto compartido (Fase 3 → corrección): los parsers ya lo leen
 * pero la BD no tiene una columna `contextText` por pregunta, así que aquí
 * decidimos a dónde va:
 *  - **Formulación destino**: el contexto se PROMUeve al `section.content`
 *    (TipTap) UNA sola vez para todas las preguntas que lo compartían. Si ya
 *    había contenido en la sección, se concatena con un separador.
 *  - **Banco destino**: el contexto se EMBEBE al inicio del TipTap `text` de
 *    cada pregunta que lo traiga (con un encabezado "Contexto"). El banco
 *    hoy no almacena contexto compartido aparte.
 *
 * En ambos casos el docente ve un `info` en el banner de éxito describiendo
 * la decisión: nunca pierde información silenciosamente.
 */
export class ImportQuestions implements UseCase<ImportQuestionsInput, ImportQuestionsResult> {
  constructor(
    private readonly evaluations: EvaluationRepository,
    private readonly bank: BankQuestionRepository,
    private readonly optionRules: OptionRuleResolver = STRICT_DEFAULT_RESOLVER,
  ) {}

  async execute({
    actor,
    questions,
    destination,
  }: ImportQuestionsInput): Promise<Result<ImportQuestionsResult>> {
    const authorized = requireRole(actor, "TEACHER", "ECU_LIDER");
    if (!authorized.ok) return authorized;

    if (questions.length === 0) {
      return fail(new ValidationError("No hay preguntas para importar."));
    }

    const { valid, validIndexes, problems } = partitionParsedQuestionsWithIndexes(questions);
    if (valid.length === 0) {
      return fail(
        new ValidationError(
          "Ninguna de las preguntas está lista para importar. Revisa los avisos.",
        ),
      );
    }

    // Regla de opciones de respuesta (sprint oct 2026): las preguntas cuyo
    // número de opciones no cabe en el rango del destino no se importan.
    // Como la importación NUNCA aborta por una pregunta mala (da de alta las
    // buenas y reporta las demás), aquí las separamos y las reportamos como
    // problemas, apuntando a su posición original en la lista revisada.
    const range = await this.resolveRange(actor, destination);
    const { kept, problems: rangeProblems } = partitionByOptionsCount(valid, validIndexes, range);
    const allProblems = [...problems, ...rangeProblems];

    if (kept.length === 0) {
      return fail(
        new ValidationError(
          "Ninguna de las preguntas está lista para importar. Revisa los avisos.",
        ),
      );
    }

    const result =
      destination.kind === "evaluation"
        ? await this.intoEvaluation(actor, kept, destination)
        : await this.intoBank(actor, kept, destination);

    if (!result.ok) return result;
    return ok({
      imported: result.value.imported,
      problems: allProblems,
      infos: result.value.infos,
    });
  }

  /**
   * Rango de opciones del destino de la importación.
   *
   * - A una evaluación → el de su (Prueba × Asignatura).
   * - Al banco → el de la asignatura (unión de sus reglas), porque el banco
   *   no pertenece a una Prueba.
   *
   * Si no se puede resolver el rango (formulación inexistente, etc.) se
   * devuelve `null` y no se filtra: el destino se valida después y devuelve
   * su error propio.
   */
  private async resolveRange(
    actor: AuthenticatedUser,
    destination: ImportDestination,
  ): Promise<OptionsRange | null> {
    if (destination.kind === "bank") {
      return this.optionRules.forSubject(actor.institutionId, destination.subjectId);
    }
    const evaluation = await this.evaluations.findById(
      actor.institutionId,
      destination.evaluationId,
    );
    if (!evaluation) return null;
    return this.optionRules.forEvaluation(
      actor.institutionId,
      evaluation.courseSubjectId,
      evaluation.periodId,
    );
  }

  /** Añade a un contexto de una formulación propia y en BORRADOR. */
  private async intoEvaluation(
    actor: AuthenticatedUser,
    questions: ParsedQuestion[],
    destination: Extract<ImportDestination, { kind: "evaluation" }>,
  ): Promise<Result<{ imported: number; infos: string[] }>> {
    // Necesitamos `getDetail` (no `findById`) porque vamos a leer el contenido
    // actual del contexto para fusionar el contexto compartido entrante.
    const detail = await this.evaluations.getDetail(actor.institutionId, destination.evaluationId);
    if (!detail) return fail(new NotFoundError("Formulación", destination.evaluationId));
    if (detail.teacherId !== actor.userId) {
      return fail(new ValidationError("Solo el autor puede editar la formulación."));
    }
    if (detail.status !== "DRAFT") {
      return fail(new ValidationError("Solo se puede editar una formulación en BORRADOR."));
    }

    const infos: string[] = [];
    const uniqueContexts = collectUniqueContexts(questions);

    // Hay DOS caminos según si la importación trae o no `sectionId`:
    //
    //  - CON sectionId (camino legacy): todo va a una sección que el docente
    //    eligió. Los contextos compartidos se concatenan al `content` de esa
    //    sección. Sigue siendo útil para "añadir preguntas a un contexto que
    //    ya existe".
    //  - SIN sectionId: el docente NO eligió sección porque quiere que el
    //    sistema reparta las preguntas según el contexto que el parser ya
    //    detectó. Hay dos sub-casos:
    //      · Hay contextos compartidos: una sección nueva por cada contexto
    //        y cada pregunta va a la suya (cotejo por contextText /
    //        contextTitle). Las preguntas sin contexto caen a la PRIMERA
    //        sección creada (con info explícito al docente).
    //      · NO hay contextos compartidos: una sola sección vacía para
    //        anclar todas las preguntas. Resuelve el caso típico del
    //        importador por IA de preguntas sueltas en una formulación
    //        recién creada (sin secciones aún): antes bloqueábamos al
    //        docente con "Elige un contexto destino…".

    let sectionForQuestion: (q: ParsedQuestion, idx: number) => string | null;

    if (destination.sectionId) {
      // ---- Camino A: sectionId explícito ----
      // Solo validamos que la sección exista cuando vamos a FUSIONAR
      // contextos en ella. Si no hay contextos, confiamos en el sectionId
      // como ancla para `addQuestion` (la BD validará la FK si fuera inválida;
      // el uso histórico de esta rama con `sections: []` en los tests confirma
      // que la sección puede existir en la BD sin estar precargada en detail).
      if (uniqueContexts.length > 0) {
        const explicit = detail.sections.find((s) => s.id === destination.sectionId);
        if (!explicit) {
          return fail(new NotFoundError("Contexto de formulación", destination.sectionId));
        }
        // Construimos el mapa contextText → { id → url } agregando las
        // figuras de TODAS las preguntas que comparten ese contexto.
        // Es la misma figura, así que la primera URL que aparezca es la
        // válida (los IDs vienen del `FigureRegistry` global del extractor).
        const contextImagesByText: Record<string, Record<string, string>> = {};
        for (const ctx of uniqueContexts) {
          contextImagesByText[ctx] = aggregateContextImages(questions, ctx);
        }
        const merged = mergeContextsIntoSectionContent(
          explicit.content,
          uniqueContexts,
          contextImagesByText,
        );
        await this.evaluations.updateSection(
          actor.institutionId,
          destination.evaluationId,
          destination.sectionId,
          { content: merged },
        );
        if (uniqueContexts.length === 1) {
          infos.push(
            "El contexto compartido se guardó en el contexto de formulación (afecta a todas las preguntas que lo compartían).",
          );
        } else {
          infos.push(
            `Se encontraron ${uniqueContexts.length} contextos distintos y se concatenaron en el contexto de formulación. Si varios no comparten texto, conviene dividirlos en varias importaciones.`,
          );
        }
      }
      const anchorSectionId = destination.sectionId;
      sectionForQuestion = () => anchorSectionId;
    } else {
      // ---- Camino B: sin sectionId elegido ----
      // Sub-caso B1: hay contextos compartidos → una sección por cada uno.
      // Sub-caso B2: NO hay contextos compartidos → una sección vacía única
      //               con todas las preguntas.

      if (uniqueContexts.length === 0) {
        // ---- Camino B2: una sección vacía para todas las preguntas ----
        // Caso típico del importador IA: el parser no detectó contextos
        // compartidos (cada pregunta trae solo su enunciado) y la
        // formulación destino aún no tiene secciones donde anclar. Antes
        // este escenario terminaba en "Elige un contexto destino", dejando
        // al docente sin salida si la evaluación estaba recién creada.
        // Creamos una sección con título derivado del primer enunciado
        // para que el docente pueda ubicarla en la vista de Contextos.
        const fallbackTitle = deriveFallbackSectionTitle(questions);
        const sec = await this.evaluations.addSection(
          actor.institutionId,
          destination.evaluationId,
          {
            title: fallbackTitle,
            content: { type: "doc", content: [] },
          },
        );
        const fallbackSectionId = sec.id;
        sectionForQuestion = () => fallbackSectionId;
        infos.push(
          `La importación no traía contextos compartidos. Se creó el contexto "${sec.title ?? fallbackTitle}" para anclar las ${questions.length} pregunta(s). Puedes renombrarlo o añadir contenido desde la vista de Contextos.`,
        );
      } else {
        // ---- Camino B1: una sección por cada contexto compartido ----
        // Mapa contextText → sectionId (y fallback contextTitle → sectionId
        // para preguntas que solo referencian el contexto por título sin
        // repetir el texto). El parser ya hace esta resolución, pero aquí
        // defendemos contra parsers que no la apliquen.
        const contextToSection = new Map<string, string>();
        const titleToSection = new Map<string, string>();

        for (const ctx of uniqueContexts) {
          const imageMap = aggregateContextImages(questions, ctx);
          const sec = await this.evaluations.addSection(
            actor.institutionId,
            destination.evaluationId,
            {
              title: deriveSectionTitle(ctx),
              content: contextTextToRichText(ctx, imageMap),
            },
          );
          contextToSection.set(ctx, sec.id);
          if (sec.title) titleToSection.set(sec.title, sec.id);
        }

        // Fallback: preguntas SIN contexto van a la primera sección creada.
        // El docente ve el aviso en `infos`.
        const fallbackSectionId = contextToSection.values().next().value as string | undefined;

        // IMPORTANTE: capturamos el sectionId por ÍNDICE de la pregunta antes
        // de `stripContextFromQuestions`, porque el strip devuelve objetos
        // NUEVOS (spread) y perderíamos la referencia.
        const sectionByIndex: (string | null)[] = questions.map((q) => {
          if (q.contextText && contextToSection.has(q.contextText)) {
            return contextToSection.get(q.contextText)!;
          }
          if (q.contextTitle && titleToSection.has(q.contextTitle)) {
            return titleToSection.get(q.contextTitle)!;
          }
          return fallbackSectionId ?? null;
        });

        sectionForQuestion = (_q, idx) => sectionByIndex[idx] ?? null;

        const withoutContextCount = questions.filter((q) => !q.contextText).length;
        infos.push(
          `Se crearon ${uniqueContexts.length} sección(es) nuevas, una por cada contexto compartido detectado.`,
        );
        if (withoutContextCount > 0) {
          infos.push(
            `${withoutContextCount} pregunta(s) sin contexto se asignaron a la primera sección creada; revisalas o muévelas desde el editor.`,
          );
        }
      }
    }

    // 2) Damos de alta cada pregunta ya sin `contextText`, para no duplicarlo
    //    ni en la pregunta ni en el contexto. `addQuestion` numera cada
    //    pregunta a partir de `totalQuestions`, así que el bucle secuencial
    //    preserva el orden del documento de origen. En paralelo se pisarían
    //    los números.
    const stripped = stripContextFromQuestions(questions);
    for (let idx = 0; idx < stripped.length; idx++) {
      const q = stripped[idx]!;
      const sectionId = sectionForQuestion(q, idx);
      if (!sectionId) {
        return fail(
          new ValidationError("No se pudo determinar la sección destino para una pregunta."),
        );
      }
      const imageUrl = q.image?.url ?? null;
      await this.evaluations.addQuestion(actor.institutionId, destination.evaluationId, sectionId, {
        text: toRichText(q.text, imageUrl),
        options: q.options.map((o) => ({ key: o.key, text: o.text })),
        correctAnswer: q.correctAnswer!, // partitionParsedQuestions ya lo garantizó
        competency: q.competency,
        menComponent: null,
        ...(imageUrl !== null ? { image: imageUrl } : {}),
      });
    }
    return ok({ imported: stripped.length, infos });
  }

  /** Guarda en el banco, todas con la misma asignatura. */
  private async intoBank(
    actor: AuthenticatedUser,
    questions: ParsedQuestion[],
    destination: Extract<ImportDestination, { kind: "bank" }>,
  ): Promise<Result<{ imported: number; infos: string[] }>> {
    if (!destination.subjectId) {
      return fail(new ValidationError("Elige la asignatura del banco."));
    }

    const infos: string[] = [];
    const withContextInlined = questions.map((q) => {
      const imageUrl = q.image?.url ?? null;
      const base = toRichText(q.text, imageUrl);
      if (!q.contextText) return { text: base };
      return {
        text: prependContextToBankQuestion(base, q.contextTitle, q.contextText, q.contextImages),
      };
    });

    const data: CreateBankQuestionData[] = questions.map((q, idx) => ({
      subjectId: destination.subjectId,
      text: withContextInlined[idx]!.text,
      options: q.options.map((o) => ({ key: o.key, text: o.text })),
      correctAnswer: q.correctAnswer!,
      competency: q.competency,
      evidence: q.evidence,
    }));

    const withContextCount = questions.filter((q) => Boolean(q.contextText)).length;
    if (withContextCount > 0) {
      infos.push(
        `El banco no guarda contexto compartido: se añadió al inicio del enunciado de ${withContextCount} pregunta(s) con un encabezado «Contexto».`,
      );
    }

    return ok({
      imported: await this.bank.createMany(actor.institutionId, actor.userId, data),
      infos,
    });
  }
}

/**
 * Envuelve texto plano en un documento TipTap.
 *
 * Los parsers devuelven string porque lo que se lee de un Word o un CSV no
 * trae formato aprovechable. La conversión se hace aquí, en el borde con la
 * persistencia, y no en cada parser.
 *
 * Si se pasa `imageUrl`, antepone un nodo `image` (block-level en TipTap)
 * al contenido resultante, de modo que la figura recortada del PDF /
 * incrustada del DOCX quede renderizada en el editor y en el PDF final —
 * antes solo se guardaba en la columna `Question.image` y nunca aparecía
 * en el doc TipTap que muestra la vista de lectura ni el editor visual.
 * El atributo `width: 80` deja margen a la columna de opciones en el
 * cuadernillo ICFES (igual que las figuras del contexto compartido); la
 * docente puede ajustarlo desde el editor con la `ResizableImage`.
 *
 * Además de la imagen, detecta fórmulas LaTeX dentro de `text`:
 *   - `$...$`   → nodo `inlineMath` intercalado dentro del paragraph.
 *   - `$$...$$` → nodo `blockMath` top-level (sale al lado del paragraph;
 *                 no se puede anidar en él — es la regla de ProseMirror).
 * El texto sin delimitadores termina como un único `paragraph` con todo
 * el enunciado, igual que antes; cambios retrocompatibles para preguntas
 * que no traen fórmulas.
 */
function toRichText(text: string, imageUrl?: string | null): unknown {
  const nodes: unknown[] = [];
  if (imageUrl) {
    nodes.push({ type: "image", attrs: { src: imageUrl, width: 80 } });
  }
  nodes.push(...latexTextToTipTapNodes(text));
  return { type: "doc", content: nodes };
}

/**
 * Igual que `toRichText` pero parsea bloques `[TABLA: ...]` y
 * placeholders `[IMAGEN id]` del LLM y los convierte en nodos `table`
 * / `image` reales. Usado para los contexts que van al `section.content`
 * cuando auto-creamos secciones por contexto: el LLM mete la instrucción
 * y la tabla en el mismo bloque y queremos que la tabla llegue
 * renderizable al editor y al PDF, no como un literal `[TABLA: ...]`.
 * Igual con las figuras: los `[IMAGEN id]` se resuelven a `<img>` con
 * `src` apuntando al upload institucional.
 */
function contextTextToRichText(text: string, imageMap?: Record<string, string>): unknown {
  const nodes = contextTextToTipTap(text, imageMap);
  return { type: "doc", content: nodes };
}

/**
 * Deriva un título legible a partir del texto crudo de un contexto. El parser
 * IA mete el contexto como bloque de texto plano sin título explícito; la
 * sección igual necesita un nombre que el docente vea en el índice.
 *
 * Heurística: primera línea no vacía, recortada a 80 chars. Si está vacía,
 * devuelve undefined (la sección aparecerá como "Contexto N" en la UI).
 */
function deriveSectionTitle(raw: string): string | undefined {
  const firstLine = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!firstLine) return undefined;
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

/**
 * Título para la sección fallback del Camino B2 (importación sin contextos
 * compartidos). Toma la primera línea no vacía del enunciado de la primera
 * pregunta y la trunca a 80 chars — el mismo criterio que
 * `deriveSectionTitle`, aplicado al texto de la pregunta en vez del contexto.
 * Si todas las preguntas están vacías cae a "Contexto 1" (la UI ya nombra las
 * secciones sin título como "Contexto N" usando el order, pero aquí
 * devolvemos un literal para que el `infos` siempre tenga un nombre concreto
 * que mostrar).
 */
function deriveFallbackSectionTitle(questions: ParsedQuestion[]): string {
  for (const q of questions) {
    const firstLine = q.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    if (firstLine) {
      return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
    }
  }
  return "Contexto 1";
}

/**
 * Agrega los `contextImages` de todas las preguntas que comparten un
 * mismo `contextText` en un único mapa `id → url`. Si varias preguntas
 * traen la misma figura, gana la primera (las URLs son estables por
 * id y vienen del `FigureRegistry` global del extractor).
 *
 * La razón de agregar es que el `contextText` se guarda UNA sola vez
 * en `section.content` para todas las preguntas que lo comparten; el
 * mapa de imágenes tiene que reflejar TODAS las figuras que el
 * extracto[or] detectó para ese contexto, no solo las de la primera
 * pregunta.
 */
function aggregateContextImages(
  questions: ParsedQuestion[],
  contextText: string,
): Record<string, string> {
  const agg: Record<string, string> = {};
  for (const q of questions) {
    if (q.contextText !== contextText) continue;
    // Defensa: `contextImages` es `Record<string, string>` en el dominio,
    // pero al cruzar boundaries de confianza (FormData → JSON.parse → BD)
    // puede llegar `undefined` (campo ausente en builds previos). Sin esta
    // guarda `Object.entries(undefined)` lanza "Cannot convert undefined or
    // null to object" en `commitImportAction`. Tratamos la ausencia como
    // "sin imágenes del contexto" y seguimos.
    const imgs = q.contextImages ?? {};
    for (const [id, url] of Object.entries(imgs)) {
      agg[id] = url; // first wins; URLs son estables por id
    }
  }
  return agg;
}

/**
 * Separa las preguntas válidas según el rango de opciones permitido y
 * devuelve las que se quedan fuera como problemas.
 *
 * Los índices de los problemas son los ORIGINALES (los de la lista que el
 * docente revisó), no los del subconjunto filtrado: así el aviso "Pregunta
 * #7" apunta a la pregunta correcta.
 */
function partitionByOptionsCount(
  questions: ParsedQuestion[],
  originalIndexes: number[],
  range: OptionsRange | null,
): { kept: ParsedQuestion[]; keptIndexes: number[]; problems: ParsedQuestionProblem[] } {
  const kept: ParsedQuestion[] = [];
  const keptIndexes: number[] = [];
  const problems: ParsedQuestionProblem[] = [];

  questions.forEach((q, i) => {
    const originalIndex = originalIndexes[i] ?? i;
    if (range === null || isOptionsCountAllowed(q.options.length, range)) {
      kept.push(q);
      keptIndexes.push(originalIndex);
      return;
    }
    problems.push({
      index: originalIndex,
      message: optionsCountErrorMessage(q.options.length, range),
    });
  });

  return { kept, keptIndexes, problems };
}
