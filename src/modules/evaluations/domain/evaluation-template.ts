export interface TemplateSection {
  title: string;
  numQuestions: number;
  order: number;
}

export interface EvaluationTemplate {
  id: string;
  name: string;
  description: string | null;
  courseSubjectId: string;
  institutionId: string;
  createdBy: string;
  structure: TemplateSection[];
  createdAt: Date;
}

export interface CreateTemplateData {
  name: string;
  description?: string;
  courseSubjectId: string;
  structure: TemplateSection[];
}

export interface TemplateRepository {
  create(
    institutionId: string,
    createdBy: string,
    data: CreateTemplateData,
  ): Promise<EvaluationTemplate>;
  findById(institutionId: string, id: string): Promise<EvaluationTemplate | null>;
  findByInstitution(institutionId: string): Promise<EvaluationTemplate[]>;
  delete(institutionId: string, id: string): Promise<void>;
}
