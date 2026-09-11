import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { cn } from "@/lib/utils";
import { AnswerSheetsStudentPicker } from "./_components/answer-sheets-student-picker";

export const metadata: Metadata = { title: "Hojas de respuesta del cuadernillo" };

export const dynamic = "force-dynamic";

/**
 * Página para que el SUPER_ADMIN (o quien tenga permiso) elija los
 * estudiantes a los que se les imprimirá la hoja de respuestas unificada
 * del cuadernillo. Tras seleccionar + click en "Imprimir", se redirige a
 * `/print/answer-sheets/bundle/[id]?students=<csv>` que es la ruta que el
 * navegador (o el worker) usa para generar el PDF.
 *
 * Sprint Bundle-Period (sep 2026): filtramos por `bundle.courseId` para que
 * solo aparezcan estudiantes del grado del cuadernillo. Si el bundle es
 * "varios grados" (courseId=null), se muestran todos los activos de la
 * institución como antes.
 */
export default async function BundleAnswerSheetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER", "SUPER_ADMIN");
  const { id } = await params;

  const bundleRes = await makeGetBundle().execute({ actor, bundleId: id });
  if (!bundleRes.ok) notFound();
  const bundle = bundleRes.value;

  if (bundle.status !== "READY") {
    return (
      <>
        <PageHeader
          title="Hojas de respuesta del cuadernillo"
          description={
            <>
              El cuadernillo <strong>{bundle.name}</strong> aún está en borrador. Márcalo como{" "}
              <strong>listo</strong> para poder generar hojas de respuesta.
            </>
          }
        />
        <Link
          href={`/admin/bundles/${bundle.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Volver al cuadernillo
        </Link>
      </>
    );
  }

  // Filtramos por el grado (courseId) y el tipo de cuadernillo (bookletTypeId)
  // del cuadernillo. Ambos nullable: si alguno viene null NO filtramos por
  // ese eje (courseId null = "varios grados", bookletTypeId null = sin
  // tipo asignado al bundle).
  const students = await prisma.student.findMany({
    where: {
      institutionId: actor.institutionId,
      isActive: true,
      ...(bundle.courseId ? { group: { courseId: bundle.courseId } } : {}),
      ...(bundle.bookletTypeId ? { bookletTypeId: bundle.bookletTypeId } : {}),
    },
    orderBy: [
      { lastName1: "asc" },
      { lastName2: "asc" },
      { firstName1: "asc" },
      { firstName2: "asc" },
    ],
    select: {
      id: true,
      lastName1: true,
      lastName2: true,
      firstName1: true,
      firstName2: true,
      code: true,
      group: { select: { name: true } },
    },
  });

  // Texto del PageHeader según la combinación de filtros activos (espejo
  // de la lógica del where de arriba). Si ninguno está set, mensaje neutro.
  const filterParts: string[] = [];
  if (bundle.courseId) filterParts.push("grado");
  if (bundle.bookletTypeId) filterParts.push("tipo de cuadernillo");
  const filterPhrase = filterParts.length > 0 ? ` del ${filterParts.join(" y ")}` : "";
  const description = `Selecciona los estudiantes${filterPhrase} a los que se les imprimirá la hoja de respuestas unificada${filterParts.length > 0 ? "" : " del cuadernillo"}. Cada hoja incluye un QR firmado con el id del cuadernillo (no de la formulación).`;

  return (
    <>
      <PageHeader title={`Hojas de respuesta — ${bundle.name}`} description={description} />

      <AnswerSheetsStudentPicker
        bundleId={bundle.id}
        students={students.map((s) => ({
          id: s.id,
          lastName1: s.lastName1,
          lastName2: s.lastName2,
          firstName1: s.firstName1,
          firstName2: s.firstName2,
          code: s.code,
          groupName: s.group?.name ?? null,
        }))}
      />

      <div className="text-muted-foreground mt-4 text-xs">
        <strong>Nota:</strong> esta previsualización abre la página <code>/print/...</code>
        en el navegador. Para generar el PDF impositionado (saddle-stitch) usa el botón
        &quot;Descargar cuadernillo&quot; del cuadernillo — el worker PDF se encarga.
      </div>
    </>
  );
}
