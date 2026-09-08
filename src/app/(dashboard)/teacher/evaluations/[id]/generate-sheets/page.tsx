import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { GenerateSheetsForm } from "./generate-sheets-form";

export const metadata: Metadata = { title: "Generar hojas de respuestas" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function GenerateSheetsPage({ params }: Props) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER");

  const evalRes = await makeGetEvaluation().execute({ actor, id });
  if (!evalRes.ok) notFound();
  const evaluation = evalRes.value;

  // Obtener grupos y estudiantes directamente
  const groups = await prisma.group.findMany({
    where: { institutionId: actor.institutionId },
    orderBy: { name: "asc" },
  });

  const students = await prisma.student.findMany({
    where: { institutionId: actor.institutionId, isActive: true },
    orderBy: [
      { lastName1: "asc" },
      { lastName2: "asc" },
      { firstName1: "asc" },
      { firstName2: "asc" },
    ],
  });

  // Agrupar estudiantes por grupo
  const studentsByGroup = new Map<string, typeof students>();
  for (const s of students) {
    const list = studentsByGroup.get(s.groupId) ?? [];
    list.push(s);
    studentsByGroup.set(s.groupId, list);
  }

  const groupsData = groups
    .map((g) => ({
      group: { id: g.id, name: g.name },
      students: (studentsByGroup.get(g.id) ?? []).map((s) => ({
        id: s.id,
        lastName1: s.lastName1,
        lastName2: s.lastName2,
        firstName1: s.firstName1,
        firstName2: s.firstName2,
        code: s.code,
      })),
    }))
    .filter((g) => g.students.length > 0);

  return (
    <>
      <PageHeader
        title="Generar hojas de respuestas"
        description={`${evaluation.title} — ${evaluation.totalQuestions} pregunta(s)`}
      />

      <div className="mb-4">
        <Link
          href={`/teacher/evaluations/${id}/contexts`}
          className="text-muted-foreground text-sm hover:underline"
        >
          ← Volver a la formulación
        </Link>
      </div>

      <GenerateSheetsForm
        evaluationId={id}
        groups={groupsData}
        totalQuestions={evaluation.totalQuestions}
      />
    </>
  );
}
