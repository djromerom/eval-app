import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { TemplateForm } from "./template-form";

export const metadata: Metadata = { title: "Nueva plantilla" };

export default async function NewTemplatePage() {
  const actor = await requireAuthenticatedUser("TEACHER", "COORDINATOR");
  const csRes = await makeListCourseSubjects().execute({ actor });
  const subjects = csRes.ok ? csRes.value : [];

  return (
    <>
      <PageHeader
        title="Nueva plantilla"
        description="Define la estructura de secciones y preguntas."
      />
      <TemplateForm
        subjects={subjects.map((s) => ({ id: s.id, label: `${s.courseName} · ${s.subjectName}` }))}
      />
    </>
  );
}
