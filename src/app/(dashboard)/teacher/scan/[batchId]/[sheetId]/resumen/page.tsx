import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { requireAuthenticatedUser } from "@/lib/session";
import { safeReturnPath } from "@/shared/domain/return-path";
import { PageHeader } from "@/components/page-header";
import {
  resumirPorAsignatura,
  totalizar,
} from "@/modules/consultas/domain/queries/calificaciones/resumen-asignaturas";
import { listPositionByName } from "@/modules/students/domain/student";

export const metadata: Metadata = { title: "Resumen por asignatura" };

interface PageProps {
  params: Promise<{ batchId: string; sheetId: string }>;
  /** `volver`: a dónde regresa el enlace de retorno (validado). Se propaga
   *  también al enlace de la matriz, para que la cadena
   *  consulta → resumen → matriz sepa volver hasta el principio. */
  searchParams?: Promise<{ volver?: string; soloLectura?: string }>;
}

/** Barra de acierto de una asignatura. Puramente visual: el dato exacto está
 *  en las columnas de al lado, así que no lleva texto propio. */
function Barra({ correctas, total }: { correctas: number; total: number }) {
  const pct = total > 0 ? Math.round((correctas / total) * 100) : 0;
  return (
    <div
      className="bg-background h-4 w-40 overflow-hidden rounded border"
      role="img"
      aria-label={`${pct}% de acierto`}
      title={`${pct}% de acierto`}
    >
      <div className="h-full bg-emerald-400" style={{ width: `${pct}%` }} />
    </div>
  );
}

export default async function ResumenPorAsignaturaPage({ params, searchParams }: PageProps) {
  const { batchId, sheetId } = await params;
  const sp = (await searchParams) ?? {};
  const volverA = safeReturnPath(sp.volver, `/teacher/scan/${batchId}`);
  const actor = await requireAuthenticatedUser("TEACHER", "ECU_LIDER", "ECU_MASTER");

  // Mismo filtro multi-tenant que la matriz: la hoja es de una formulación
  // del docente actual, o de un cuadernillo de su institución.
  const sheet = await prisma.answerSheet.findFirst({
    where: {
      id: sheetId,
      scanBatchId: batchId,
      OR: [
        {
          evaluation: {
            institutionId: actor.institutionId,
            teacherId: actor.userId,
            deletedAt: null,
          },
        },
        { bundle: { institutionId: actor.institutionId } },
      ],
    },
    select: {
      id: true,
      status: true,
      bundle: { select: { name: true } },
      evaluation: { select: { title: true } },
      student: {
        select: {
          id: true,
          groupId: true,
          lastName1: true,
          lastName2: true,
          firstName1: true,
          firstName2: true,
          code: true,
          group: { select: { name: true, course: { select: { name: true } } } },
        },
      },
    },
  });
  if (!sheet) notFound();

  const answers = await prisma.studentAnswer.findMany({
    where: { answerSheetId: sheet.id },
    orderBy: { id: "asc" },
    select: {
      selectedKey: true,
      isCorrect: true,
      isAmbiguous: true,
      bundleItem: {
        select: {
          order: true,
          evaluation: {
            select: { courseSubject: { select: { subject: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  const filas = resumirPorAsignatura(
    answers.map((a) => ({
      subjectName: a.bundleItem?.evaluation?.courseSubject?.subject?.name ?? null,
      orden: a.bundleItem?.order ?? null,
      selectedKey: a.selectedKey,
      isCorrect: a.isCorrect,
      isAmbiguous: a.isAmbiguous,
    })),
  );
  const total = totalizar(filas);

  const alumno = sheet.student;
  const nombre = alumno
    ? [
        [alumno.lastName1, alumno.lastName2].filter(Boolean).join(" "),
        [alumno.firstName1, alumno.firstName2].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ")
    : "Hoja sin identificar";

  // "Número de lista" estilo colegio colombiano: la posición 1-based del
  // estudiante dentro de su GRUPO (la sección), ordenada por apellido1,
  // apellido2, nombre1, nombre2. NO se persiste: la planilla del salón
  // cambia y forzaría reescribir el dato histórico. La planilla del grupo
  // es chico (decenas de alumnos), así que el round-trip a la BD es
  // aceptable — y el helper `listPositionByName` es puro y testeable.
  // Hojas sin identificar (sin QR resuelto) no muestran número.
  let numeroDeLista: number | null = null;
  if (alumno) {
    const companieros = await prisma.student.findMany({
      where: { institutionId: actor.institutionId, groupId: alumno.groupId },
      select: {
        id: true,
        lastName1: true,
        lastName2: true,
        firstName1: true,
        firstName2: true,
      },
      orderBy: { lastName1: "asc" },
    });
    numeroDeLista = listPositionByName(companieros, alumno.id);
  }
  const prueba = sheet.bundle?.name ?? sheet.evaluation?.title ?? "—";
  const ubicacion = alumno?.group
    ? `${alumno.group.course.name} · ${alumno.group.name}`
    : null;

  // El enlace a la matriz arrastra el mismo `volver`, para que desde allá se
  // regrese al resumen y no al origen de toda la cadena.
  const volverAlResumen = `/teacher/scan/${batchId}/${sheetId}/resumen${
    sp.volver ? `?volver=${encodeURIComponent(volverA)}` : ""
  }`;
  const urlMatriz = (asignatura?: string) => {
    const qs = new URLSearchParams();
    if (sp.soloLectura === "1") qs.set("soloLectura", "1");
    qs.set("volver", volverAlResumen);
    if (asignatura) qs.set("asignatura", asignatura);
    return `/teacher/scan/${batchId}/${sheetId}?${qs.toString()}`;
  };

  return (
    <>
      <PageHeader
        title={
          numeroDeLista !== null
            ? `Estudiante: ${numeroDeLista}. ${nombre}`
            : `Estudiante: ${nombre}`
        }
        description={
          <>
            {prueba}
            {ubicacion && <> · {ubicacion}</>}
            {alumno?.code && <> · Código {alumno.code}</>}
          </>
        }
      />

      {filas.length === 0 ? (
        <div className="text-muted-foreground rounded border border-dashed p-8 text-center text-sm">
          Esta hoja todavía no tiene respuestas calificadas
          {sheet.status ? ` (estado: ${sheet.status})` : ""}. El desglose por asignatura aparece
          cuando el worker termina de procesarla.
        </div>
      ) : (
        <div className="bg-card overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs font-medium tracking-wide uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Asignatura</th>
                <th className="px-3 py-2 text-right">Calificación</th>
                <th className="px-3 py-2 text-right">Número correcta</th>
                <th className="px-3 py-2 text-right">Número incorrecto</th>
                <th className="px-3 py-2 text-right">Número faltando</th>
                <th className="px-3 py-2 text-right">Calificación total</th>
                <th className="px-3 py-2 text-left">
                  <span className="sr-only">Acierto</span>
                </th>
                <th className="px-3 py-2 text-right">
                  <span className="sr-only">Detalle</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.subjectName} className="hover:bg-muted/20 border-t">
                  <td className="px-3 py-2 font-medium">{f.subjectName}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {f.puntaje?.toFixed(1) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.correctas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.incorrectas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.faltantes}</td>
                  <td className="text-muted-foreground px-3 py-2 text-right tabular-nums">
                    {f.correctas} / {f.total}
                  </td>
                  <td className="px-3 py-2">
                    <Barra correctas={f.correctas} total={f.total} />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link
                      href={urlMatriz(f.subjectName)}
                      className="text-muted-foreground hover:text-primary text-xs underline underline-offset-2"
                      title={`Ver la matriz de respuestas solo de ${f.subjectName}`}
                    >
                      Ver detalle
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted/30 border-t-2 font-semibold">
              <tr>
                <td className="px-3 py-2">{total.subjectName}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {total.puntaje?.toFixed(1) ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{total.correctas}</td>
                <td className="px-3 py-2 text-right tabular-nums">{total.incorrectas}</td>
                <td className="px-3 py-2 text-right tabular-nums">{total.faltantes}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {total.correctas} / {total.total}
                </td>
                <td className="px-3 py-2">
                  <Barra correctas={total.correctas} total={total.total} />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Link
                    href={urlMatriz()}
                    className="text-muted-foreground hover:text-primary text-xs underline underline-offset-2"
                  >
                    Ver todo
                  </Link>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="mt-4">
        <Link href={volverA} className="text-muted-foreground hover:text-foreground text-sm underline">
          ← Volver
        </Link>
      </div>
    </>
  );
}
