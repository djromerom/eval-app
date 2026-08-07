import { type Prisma, type SoloLevel as PrismaSoloLevel, DraftStatus } from "@prisma/client";
import { prisma } from "@/shared/infrastructure/db/prisma";
import type { EvaluationStatus } from "../domain/evaluation-status";
import { computeRenumbering } from "../domain/evaluation";
import type {
  AnswerKey,
  CreateEvaluationData,
  CreateQuestionData,
  CreateSectionData,
  Evaluation,
  EvaluationDetail,
  EvaluationListItem,
  EvaluationRepository,
  EvaluationSection,
  Question,
  SoloLevel,
  UpdateEvaluationSettingsData,
  UpdateQuestionData,
  UpdateSectionData,
} from "../domain/evaluation";

type EvaluationRow = {
  id: string;
  institutionId: string;
  title: string;
  description: string | null;
  version: number;
  status: DraftStatus;
  courseSubjectId: string;
  academicYearId: string;
  periodId: string | null;
  teacherId: string;
  bookletNumber: number | null;
  bookletTypeId: string | null;
  totalQuestions: number;
  durationMinutes: number | null;
  theme: Prisma.JsonValue;
};

function toEvaluation(r: EvaluationRow): Evaluation {
  return {
    id: r.id,
    institutionId: r.institutionId,
    title: r.title,
    description: r.description,
    version: r.version,
    status: r.status as EvaluationStatus,
    courseSubjectId: r.courseSubjectId,
    academicYearId: r.academicYearId,
    periodId: r.periodId,
    teacherId: r.teacherId,
    bookletNumber: r.bookletNumber,
    bookletTypeId: r.bookletTypeId,
    totalQuestions: r.totalQuestions,
    durationMinutes: r.durationMinutes,
    theme: r.theme,
  };
}

type SectionRow = {
  id: string;
  title: string | null;
  content: Prisma.JsonValue;
  order: number;
  questions: {
    id: string;
    number: number;
    text: Prisma.JsonValue;
    image: string | null;
    sectionId: string;
    correctAnswer: string;
    justification: string | null;
    weight: number;
    soloLevel: PrismaSoloLevel | null;
    menComponent: string | null;
    competency: string | null;
    options: { key: string; text: Prisma.JsonValue }[];
  }[];
};

/**
 * Persiste la renumeración que calcula `computeRenumbering` (dominio) y deja
 * `totalQuestions` acorde.
 *
 * A diferencia del reorder de items del cuadernillo, aquí NO hace falta el
 * two-phase con valores temporales: `Question.number` solo tiene índice
 * (`@@index([sectionId, number])`), no constraint único, así que dos filas
 * pueden compartir número un instante sin que la BD lo rechace.
 */
async function renumberQuestions(
  tx: Prisma.TransactionClient,
  evaluationId: string,
): Promise<void> {
  const sections = await tx.evaluationSection.findMany({
    where: { evaluationId },
    orderBy: { order: "asc" },
    select: { questions: { orderBy: { number: "asc" }, select: { id: true, number: true } } },
  });

  const { updates, total } = computeRenumbering(sections);
  for (const u of updates) {
    await tx.question.update({ where: { id: u.id }, data: { number: u.number } });
  }

  await tx.evaluation.update({ where: { id: evaluationId }, data: { totalQuestions: total } });
}

function toSection(s: SectionRow): EvaluationSection {
  return {
    id: s.id,
    title: s.title,
    content: s.content,
    order: s.order,
    questions: s.questions.map((q) => ({
      id: q.id,
      number: q.number,
      text: q.text,
      image: q.image,
      sectionId: q.sectionId,
      correctAnswer: q.correctAnswer as AnswerKey,
      justification: q.justification,
      weight: q.weight,
      soloLevel: (q.soloLevel as SoloLevel | null) ?? null,
      menComponent: q.menComponent,
      competency: q.competency,
      options: q.options.map((o) => ({ key: o.key as AnswerKey, text: o.text })),
    })),
  };
}

const json = (v: unknown): Prisma.InputJsonValue => (v ?? {}) as Prisma.InputJsonValue;

export class PrismaEvaluationRepository implements EvaluationRepository {
  async create(
    institutionId: string,
    teacherId: string,
    data: CreateEvaluationData,
  ): Promise<Evaluation> {
    const cs = await prisma.courseSubject.findFirstOrThrow({
      where: { id: data.courseSubjectId, course: { institutionId } },
      include: { course: { select: { academicYearId: true } } },
    });
    const row = await prisma.evaluation.create({
      data: {
        institutionId,
        teacherId,
        courseSubjectId: data.courseSubjectId,
        academicYearId: cs.course.academicYearId,
        periodId: data.periodId ?? null,
        title: data.title,
        description: data.description ?? null,
        bookletNumber: data.bookletNumber ?? null,
        // Tipo de cuadernillo seleccionado por el docente (ago 2026). Si
        // no se envía, queda null (compatible con formulaciones previas).
        bookletTypeId: data.bookletTypeId ?? null,
        // Sprint 7: si no se envió, queda null → heurístico en la portada.
        durationMinutes: data.durationMinutes ?? null,
        // Default de maquetación: 2 columnas estilo ICFES (el PDF de
        // referencia institucional fluye preguntas a dos columnas). Se persiste
        // como override del tema institucional para que el docente lo pueda
        // cambiar desde Diseñador sin tocar el preset del colegio.
        theme: { questionColumns: 2 },
        status: DraftStatus.DRAFT,
      },
    });
    return toEvaluation(row);
  }

  async findById(institutionId: string, id: string): Promise<Evaluation | null> {
    const row = await prisma.evaluation.findFirst({
      where: { id, institutionId, deletedAt: null },
    });
    return row && toEvaluation(row);
  }

  async getDetail(institutionId: string, id: string): Promise<EvaluationDetail | null> {
    const row = await prisma.evaluation.findFirst({
      where: { id, institutionId, deletedAt: null },
      include: {
        sections: {
          orderBy: { order: "asc" },
          include: { questions: { orderBy: { number: "asc" }, include: { options: true } } },
        },
        // Hidrata periodName para que EvaluationDetail exponga el rótulo
        // legible del periodo sin un SELECT extra desde el page.tsx.
        period: { select: { name: true } },
        // Hidrata bookletTypeName (ago 2026).
        bookletType: { select: { name: true } },
        // Hidrata subjectName y courseName (ago 2026): el editor unificado
        // compone el título del header como
        // `${periodName} ${subjectName} ${courseName} ${bookletTypeName}`
        // con espacios y omitiendo los bloques faltantes (sin periodo /
        // sin tipo de cuadernillo). Antes se reutilizaba `evaluation.title`
        // que concatenaba asignatura+grado+" - "+año, formato que el
        // docente pidió reorganizar.
        courseSubject: {
          select: {
            subject: { select: { name: true } },
            course: { select: { name: true } },
          },
        },
      },
    });
    if (!row) return null;
    return {
      ...toEvaluation(row),
      sections: row.sections.map(toSection),
      periodName: row.period?.name ?? null,
      bookletTypeName: row.bookletType?.name ?? null,
      subjectName: row.courseSubject?.subject?.name ?? null,
      courseName: row.courseSubject?.course?.name ?? null,
    };
  }

  async findByTeacher(institutionId: string, teacherId: string): Promise<EvaluationListItem[]> {
    return this.listWhere({ institutionId, teacherId, deletedAt: null });
  }

  async findByInstitution(
    institutionId: string,
    status?: EvaluationStatus,
  ): Promise<EvaluationListItem[]> {
    return this.listWhere({
      institutionId,
      deletedAt: null,
      ...(status ? { status: status as DraftStatus } : {}),
    });
  }

  private async listWhere(where: Prisma.EvaluationWhereInput): Promise<EvaluationListItem[]> {
    const rows = await prisma.evaluation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        courseSubject: {
          include: { course: { select: { name: true } }, subject: { select: { name: true } } },
        },
        period: { select: { id: true, name: true } },
        bookletType: { select: { id: true, name: true } },
        academicYear: { select: { year: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status as EvaluationStatus,
      version: r.version,
      bookletNumber: r.bookletNumber,
      totalQuestions: r.totalQuestions,
      courseId: r.courseSubject.courseId,
      courseName: r.courseSubject.course.name,
      subjectName: r.courseSubject.subject.name,
      courseSubjectId: r.courseSubjectId,
      periodId: r.periodId,
      periodName: r.period?.name ?? null,
      bookletTypeId: r.bookletTypeId,
      bookletTypeName: r.bookletType?.name ?? null,
      academicYearYear: r.academicYear.year,
      updatedAt: r.updatedAt,
    }));
  }

  async addSection(
    institutionId: string,
    evaluationId: string,
    data: CreateSectionData,
  ): Promise<EvaluationSection> {
    // Verifica pertenencia a la institución antes de escribir.
    await prisma.evaluation.findFirstOrThrow({ where: { id: evaluationId, institutionId } });
    const order = await prisma.evaluationSection.count({ where: { evaluationId } });
    const row = await prisma.evaluationSection.create({
      data: {
        evaluationId,
        title: data.title ?? null,
        content: json(data.content),
        order,
      },
      include: { questions: { include: { options: true } } },
    });
    return toSection(row);
  }

  async updateSection(
    institutionId: string,
    evaluationId: string,
    sectionId: string,
    data: UpdateSectionData,
  ): Promise<EvaluationSection> {
    await prisma.evaluation.findFirstOrThrow({ where: { id: evaluationId, institutionId } });
    // findFirst + update por id: `updateMany` no permite `include`, y filtrar
    // por evaluationId aquí evita editar un contexto de otra formulación.
    const existing = await prisma.evaluationSection.findFirstOrThrow({
      where: { id: sectionId, evaluationId },
      select: { id: true },
    });
    const row = await prisma.evaluationSection.update({
      where: { id: existing.id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.content !== undefined ? { content: json(data.content) } : {}),
      },
      include: { questions: { include: { options: true }, orderBy: { number: "asc" } } },
    });
    return toSection(row);
  }

  async deleteSection(
    institutionId: string,
    evaluationId: string,
    sectionId: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.evaluation.findFirstOrThrow({ where: { id: evaluationId, institutionId } });
      const section = await tx.evaluationSection.findFirstOrThrow({
        where: { id: sectionId, evaluationId },
        select: { id: true, order: true },
      });
      // Las preguntas (y sus opciones) caen por onDelete: Cascade del esquema.
      await tx.evaluationSection.delete({ where: { id: section.id } });
      // Compacta el `order` de los contextos que quedaban por detrás.
      await tx.evaluationSection.updateMany({
        where: { evaluationId, order: { gt: section.order } },
        data: { order: { decrement: 1 } },
      });
      await renumberQuestions(tx, evaluationId);
    });
  }

  async addQuestion(
    institutionId: string,
    evaluationId: string,
    sectionId: string,
    data: CreateQuestionData,
  ): Promise<Question> {
    return prisma.$transaction(async (tx) => {
      const evaluation = await tx.evaluation.findFirstOrThrow({
        where: { id: evaluationId, institutionId },
      });
      await tx.evaluationSection.findFirstOrThrow({ where: { id: sectionId, evaluationId } });
      // Numeración continua en toda la formulación (útil para la hoja OMR).
      const number = evaluation.totalQuestions + 1;
      const q = await tx.question.create({
        data: {
          sectionId,
          number,
          text: json(data.text),
          image: data.image ?? null,
          correctAnswer: data.correctAnswer,
          justification: data.justification ?? null,
          weight: data.weight ?? 1,
          soloLevel: (data.soloLevel as PrismaSoloLevel | null) ?? null,
          menComponent: data.menComponent ?? null,
          competency: data.competency ?? null,
          bankOriginId: data.bankOriginId ?? null,
          options: { create: data.options.map((o) => ({ key: o.key, text: json(o.text) })) },
        },
        include: { options: true },
      });
      await tx.evaluation.update({ where: { id: evaluationId }, data: { totalQuestions: number } });
      return {
        id: q.id,
        number: q.number,
        text: q.text,
        image: q.image,
        sectionId: q.sectionId,
        correctAnswer: q.correctAnswer as AnswerKey,
        justification: q.justification,
        weight: q.weight,
        soloLevel: (q.soloLevel as SoloLevel | null) ?? null,
        menComponent: q.menComponent,
        competency: q.competency,
        options: q.options.map((o) => ({ key: o.key as AnswerKey, text: o.text })),
      };
    });
  }

  async updateQuestion(
    institutionId: string,
    evaluationId: string,
    questionId: string,
    data: UpdateQuestionData,
  ): Promise<Question> {
    return prisma.$transaction(async (tx) => {
      await tx.evaluation.findFirstOrThrow({ where: { id: evaluationId, institutionId } });
      // La pregunta debe colgar de un contexto de ESTA formulación.
      const existing = await tx.question.findFirstOrThrow({
        where: { id: questionId, section: { evaluationId } },
        select: { id: true },
      });

      // Las opciones se reemplazan en bloque: pasar de 4 a 3 debe borrar la
      // sobrante, y un upsert por clave la dejaría huérfana.
      if (data.options !== undefined) {
        await tx.questionOption.deleteMany({ where: { questionId: existing.id } });
      }

      const q = await tx.question.update({
        where: { id: existing.id },
        data: {
          ...(data.text !== undefined ? { text: json(data.text) } : {}),
          ...(data.correctAnswer !== undefined ? { correctAnswer: data.correctAnswer } : {}),
          ...(data.justification !== undefined ? { justification: data.justification } : {}),
          ...(data.weight !== undefined ? { weight: data.weight } : {}),
          ...(data.soloLevel !== undefined
            ? { soloLevel: (data.soloLevel as PrismaSoloLevel | null) ?? null }
            : {}),
          ...(data.menComponent !== undefined ? { menComponent: data.menComponent } : {}),
          ...(data.competency !== undefined ? { competency: data.competency } : {}),
          ...(data.image !== undefined ? { image: data.image } : {}),
          ...(data.options !== undefined
            ? { options: { create: data.options.map((o) => ({ key: o.key, text: json(o.text) })) } }
            : {}),
        },
        include: { options: true },
      });

      return {
        id: q.id,
        number: q.number,
        text: q.text,
        image: q.image,
        sectionId: q.sectionId,
        correctAnswer: q.correctAnswer as AnswerKey,
        justification: q.justification,
        weight: q.weight,
        soloLevel: (q.soloLevel as SoloLevel | null) ?? null,
        menComponent: q.menComponent,
        competency: q.competency,
        options: q.options.map((o) => ({ key: o.key as AnswerKey, text: o.text })),
      };
    });
  }

  async deleteQuestion(
    institutionId: string,
    evaluationId: string,
    questionId: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.evaluation.findFirstOrThrow({ where: { id: evaluationId, institutionId } });
      const q = await tx.question.findFirstOrThrow({
        where: { id: questionId, section: { evaluationId } },
        select: { id: true },
      });
      // Las opciones caen por cascade. `StudentAnswer` NO tiene cascade, así
      // que si hubiera respuestas escaneadas el FK abortaría la transacción —
      // no debería pasar: editar exige DRAFT y al escanear ya está PUBLISHED.
      await tx.question.delete({ where: { id: q.id } });
      await renumberQuestions(tx, evaluationId);
    });
  }

  async duplicateQuestion(
    institutionId: string,
    evaluationId: string,
    questionId: string,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.evaluation.findFirstOrThrow({ where: { id: evaluationId, institutionId } });
      // Cargamos la pregunta con sus opciones para clonar la estructura 1-a-1.
      const source = await tx.question.findFirstOrThrow({
        where: { id: questionId, section: { evaluationId } },
        include: { options: true },
      });
      const evaluation = await tx.evaluation.findFirstOrThrow({ where: { id: evaluationId } });
      const newNumber = evaluation.totalQuestions + 1;
      await tx.question.create({
        data: {
          sectionId: source.sectionId,
          number: newNumber,
          text: source.text as Prisma.InputJsonValue,
          image: source.image,
          correctAnswer: source.correctAnswer,
          justification: source.justification,
          weight: source.weight,
          soloLevel: source.soloLevel,
          menComponent: source.menComponent,
          competency: source.competency,
          // bankOriginId deliberadamente null: la copia no es del banco, es
          // una instancia propia editable de la formulación (regla del spec
          // "importaciones son independientes").
          bankOriginId: null,
          options: {
            create: source.options.map((o) => ({
              key: o.key,
              text: o.text as Prisma.InputJsonValue,
            })),
          },
        },
      });
      await tx.evaluation.update({
        where: { id: evaluationId },
        data: { totalQuestions: newNumber },
      });
    });
  }

  async reorderQuestions(
    institutionId: string,
    evaluationId: string,
    sectionId: string,
    orderedQuestionIds: string[],
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.evaluation.findFirstOrThrow({ where: { id: evaluationId, institutionId } });

      // Cargamos las preguntas reales de la sección para validar pertenencia.
      const actual = await tx.question.findMany({
        where: { sectionId, section: { evaluationId } },
        select: { id: true },
      });
      const actualIds = new Set(actual.map((q) => q.id));
      if (actualIds.size !== orderedQuestionIds.length) {
        throw new Error(
          `Reorder: la lista recibida tiene ${orderedQuestionIds.length} ids pero la sección tiene ${actualIds.size}.`,
        );
      }
      for (const id of orderedQuestionIds) {
        if (!actualIds.has(id)) {
          throw new Error(
            `Reorder: el id ${id} no pertenece a la sección ${sectionId} de la formulación ${evaluationId}.`,
          );
        }
      }

      // Renumeramos con números temporales negativos para evitar pisar
      // constraints únicos del índice `(sectionId, number)`. Luego asignamos
      // el número final 1..N.
      for (let i = 0; i < orderedQuestionIds.length; i++) {
        await tx.question.update({
          where: { id: orderedQuestionIds[i] },
          data: { number: -1 - i },
        });
      }
      for (let i = 0; i < orderedQuestionIds.length; i++) {
        await tx.question.update({
          where: { id: orderedQuestionIds[i] },
          data: { number: i + 1 },
        });
      }

      // El cuadernillo numera de corrido en toda la formulación, no dentro
      // de cada sección, así que pedimos a `renumberQuestions` que recalcule
      // `totalQuestions` y los huecos en las demás secciones (por si quedó
      // alguno). No toca los números que acabamos de asignar porque ya son
      // 1..N para esta sección.
      await renumberQuestions(tx, evaluationId);
    });
  }

  async updateStatus(institutionId: string, id: string, status: EvaluationStatus): Promise<void> {
    await prisma.evaluation.updateMany({
      where: { id, institutionId },
      data: { status: status as DraftStatus },
    });
  }

  async updateSettings(
    institutionId: string,
    id: string,
    data: UpdateEvaluationSettingsData,
  ): Promise<Evaluation> {
    const row = await prisma.evaluation.update({
      where: { id },
      data: { durationMinutes: data.durationMinutes },
    });
    // Doble check institutionId para evitar leaks cross-tenant (mismo patrón
    // que el resto de repos).
    if (row.institutionId !== institutionId) {
      throw new Error(`Evaluation ${id} no pertenece a la institución ${institutionId}`);
    }
    return toEvaluation(row);
  }

  async createNewVersion(institutionId: string, id: string): Promise<Evaluation> {
    const detail = await this.getDetail(institutionId, id);
    if (!detail) throw new Error(`Formulación no encontrada: ${id}`);
    const source = await prisma.evaluation.findFirstOrThrow({ where: { id, institutionId } });

    return prisma.$transaction(async (tx) => {
      const copy = await tx.evaluation.create({
        data: {
          institutionId,
          teacherId: source.teacherId,
          courseSubjectId: source.courseSubjectId,
          academicYearId: source.academicYearId,
          periodId: source.periodId,
          title: source.title,
          description: source.description,
          bookletNumber: source.bookletNumber,
          templateId: source.templateId,
          version: source.version + 1,
          parentVersionId: source.id,
          status: DraftStatus.DRAFT,
          totalQuestions: source.totalQuestions,
          durationMinutes: source.durationMinutes,
        },
      });
      for (const section of detail.sections) {
        await tx.evaluationSection.create({
          data: {
            evaluationId: copy.id,
            title: section.title,
            content: json(section.content),
            order: section.order,
            questions: {
              create: section.questions.map((q) => ({
                number: q.number,
                text: json(q.text),
                image: q.image,
                correctAnswer: q.correctAnswer,
                justification: q.justification,
                weight: q.weight,
                soloLevel: (q.soloLevel as PrismaSoloLevel | null) ?? null,
                menComponent: q.menComponent,
                options: { create: q.options.map((o) => ({ key: o.key, text: json(o.text) })) },
              })),
            },
          },
        });
      }
      return toEvaluation(copy);
    });
  }

  async existsByCourseSubjectPeriodYear(
    institutionId: string,
    courseSubjectId: string,
    periodId: string | null,
    academicYearId: string,
  ): Promise<boolean> {
    const row = await prisma.evaluation.findFirst({
      where: {
        institutionId,
        courseSubjectId,
        periodId,
        academicYearId,
        deletedAt: null,
      },
      select: { id: true },
    });
    return row !== null;
  }
}
