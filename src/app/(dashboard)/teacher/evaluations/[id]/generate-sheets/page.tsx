import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { makeGetEvaluation } from "@/modules/evaluations/infrastructure/container";
import { GroupSelector } from "./group-selector";

export const metadata: Metadata = { title: "Generar hojas de respuestas" };

interface Props {
  params: Promise<{ id: string }>;
}

async function submitAction(formData: FormData) {
  "use server";
  await requireAuthenticatedUser("TEACHER", "ECU_LIDER");
  const evaluationId = formData.get("evaluationId") as string;
  const selected = formData.getAll("studentIds") as string[];
  if (selected.length === 0 || !evaluationId) return;
  redirect(`/print/bulk-answer-sheets/${evaluationId}?students=${selected.join(",")}`);
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
    where: {
      institutionId: actor.institutionId,
      isActive: true,
      // Solo estudiantes con matrícula vigente — los demás no imprimen hoja
      // de respuestas (caso borde post-migración).
      enrollments: { some: { isCurrent: true } },
    },
    orderBy: [
      { lastName1: "asc" },
      { lastName2: "asc" },
      { firstName1: "asc" },
      { firstName2: "asc" },
    ],
    include: {
      enrollments: { where: { isCurrent: true }, take: 1, select: { groupId: true } },
    },
  });

  // Agrupar estudiantes por grupo (solo los que tienen matrícula vigente)
  const studentsByGroup = new Map<string, typeof students>();
  for (const s of students) {
    const currentGroupId = s.enrollments[0]?.groupId;
    if (!currentGroupId) continue;
    const list = studentsByGroup.get(currentGroupId) ?? [];
    list.push(s);
    studentsByGroup.set(currentGroupId, list);
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

      <form action={submitAction} className="space-y-6">
        <input type="hidden" name="evaluationId" value={id} />

        <section className="bg-card rounded-xl border p-6">
          <h2 className="mb-4 font-semibold">Seleccionar estudiantes</h2>

          {students.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No hay estudiantes registrados. El administrador debe importarlos primero.
            </p>
          ) : (
            <GroupSelector groups={groupsData} />
          )}
        </section>

        <div className="flex items-center gap-3">
          <Button type="submit" size="lg">
            Generar hojas de respuestas
          </Button>
          <p className="text-muted-foreground text-xs">
            Se abrirá una nueva pestaña con todas las hojas listas para imprimir.
          </p>
        </div>
      </form>
    </>
  );
}
