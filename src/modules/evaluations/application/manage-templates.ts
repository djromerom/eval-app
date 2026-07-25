import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";
import { type Result, ValidationError, fail, ok } from "@/shared/domain/result";
import type { CourseSubjectRepository } from "@/modules/academic/domain/types";
import type { EvaluationRepository } from "../domain/evaluation";
import { ANSWER_KEYS_ORDER } from "../domain/evaluation";
import {
  type CreateTemplateData,
  type EvaluationTemplate,
  type TemplateRepository,
} from "../domain/evaluation-template";

export interface CreateTemplateInput {
  actor: AuthenticatedUser;
  data: CreateTemplateData;
}

export interface ListTemplatesInput {
  actor: AuthenticatedUser;
}

export interface GetTemplateInput {
  actor: AuthenticatedUser;
  id: string;
}

export interface DeleteTemplateInput {
  actor: AuthenticatedUser;
  id: string;
}

export interface ApplyTemplateInput {
  actor: AuthenticatedUser;
  templateId: string;
  evaluationId: string;
}

export class CreateTemplate implements UseCase<CreateTemplateInput, EvaluationTemplate> {
  constructor(
    private readonly templates: TemplateRepository,
    private readonly courseSubjects: CourseSubjectRepository,
  ) {}

  async execute({ actor, data }: CreateTemplateInput): Promise<Result<EvaluationTemplate>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;

    if (!data.name.trim()) return fail(new ValidationError("El nombre es obligatorio."));
    if (data.structure.length === 0)
      return fail(new ValidationError("Agrega al menos una sección."));
    for (const s of data.structure) {
      if (s.numQuestions < 1)
        return fail(new ValidationError("Cada sección debe tener al menos 1 pregunta."));
    }

    const cs = await this.courseSubjects.findById(actor.institutionId, data.courseSubjectId);
    if (!cs) return fail(new ValidationError("La asignatura-curso no existe en tu institución."));

    return ok(await this.templates.create(actor.institutionId, actor.userId, data));
  }
}

export class ListTemplates implements UseCase<ListTemplatesInput, EvaluationTemplate[]> {
  constructor(private readonly templates: TemplateRepository) {}

  async execute({ actor }: ListTemplatesInput): Promise<Result<EvaluationTemplate[]>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;
    return ok(await this.templates.findByInstitution(actor.institutionId));
  }
}

export class GetTemplate implements UseCase<GetTemplateInput, EvaluationTemplate> {
  constructor(private readonly templates: TemplateRepository) {}

  async execute({ actor, id }: GetTemplateInput): Promise<Result<EvaluationTemplate>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;
    const tpl = await this.templates.findById(actor.institutionId, id);
    if (!tpl) return fail(new ValidationError("Plantilla no encontrada."));
    return ok(tpl);
  }
}

export class DeleteTemplate implements UseCase<DeleteTemplateInput, void> {
  constructor(private readonly templates: TemplateRepository) {}

  async execute({ actor, id }: DeleteTemplateInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;
    const tpl = await this.templates.findById(actor.institutionId, id);
    if (!tpl) return fail(new ValidationError("Plantilla no encontrada."));
    await this.templates.delete(actor.institutionId, id);
    return ok(undefined);
  }
}

/**
 * Aplica una plantilla a una formulación ya creada: genera las secciones
 * y preguntas vacías según la estructura de la plantilla.
 */
export class ApplyTemplate implements UseCase<ApplyTemplateInput, void> {
  constructor(
    private readonly templates: TemplateRepository,
    private readonly evaluations: EvaluationRepository,
  ) {}

  async execute({ actor, templateId, evaluationId }: ApplyTemplateInput): Promise<Result<void>> {
    const authorized = requireRole(actor, "TEACHER", "COORDINATOR");
    if (!authorized.ok) return authorized;

    const tpl = await this.templates.findById(actor.institutionId, templateId);
    if (!tpl) return fail(new ValidationError("Plantilla no encontrada."));

    const evalDetail = await this.evaluations.getDetail(actor.institutionId, evaluationId);
    if (!evalDetail) return fail(new ValidationError("Formulación no encontrada."));
    if (evalDetail.status !== "DRAFT")
      return fail(
        new ValidationError("Solo se puede aplicar plantilla a formulaciones en borrador."),
      );

    for (const sec of tpl.structure) {
      const section = await this.evaluations.addSection(actor.institutionId, evaluationId, {
        title: sec.title,
      });
      for (let i = 0; i < sec.numQuestions; i++) {
        await this.evaluations.addQuestion(actor.institutionId, evaluationId, section.id, {
          text: "",
          options: ANSWER_KEYS_ORDER.slice(0, 4).map((key) => ({ key, text: "" })),
          correctAnswer: "A",
        });
      }
    }

    return ok(undefined);
  }
}
