import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeGetBundle } from "@/modules/bundles/infrastructure/container";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Hojas de respuesta del compendio" };

export const dynamic = "force-dynamic";

/**
 * Página para que el SUPER_ADMIN (o quien tenga permiso) elija los
 * estudiantes a los que se les imprimirá la hoja de respuestas unificada
 * del compendio. Tras seleccionar + click en "Imprimir", se redirige a
 * `/print/answer-sheets/bundle/[id]?students=<csv>` que es la ruta que el
 * navegador (o el worker) usa para generar el PDF.
 */
export default async function BundleAnswerSheetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAuthenticatedUser(
    "TEACHER",
    "COORDINATOR",
    "ECU_MASTER",
    "SUPER_ADMIN",
  );
  const { id } = await params;

  const bundleRes = await makeGetBundle().execute({ actor, bundleId: id });
  if (!bundleRes.ok) notFound();
  const bundle = bundleRes.value;

  if (bundle.status !== "READY") {
    return (
      <>
        <PageHeader
          title="Hojas de respuesta del compendio"
          description={
            <>
              El compendio <strong>{bundle.name}</strong> aún está en borrador. Márcalo como{" "}
              <strong>listo</strong> para poder generar hojas de respuesta.
            </>
          }
        />
        <Link
          href={`/admin/bundles/${bundle.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Volver al compendio
        </Link>
      </>
    );
  }

  // Lista de estudiantes de la institución. En el futuro se filtrará por
  // curso (CourseSubject) si el bundle lo requiere; por ahora todos.
  const students = await prisma.student.findMany({
    where: { institutionId: actor.institutionId, isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      code: true,
      group: { select: { name: true } },
    },
  });

  return (
    <>
      <PageHeader
        title={`Hojas de respuesta — ${bundle.name}`}
        description={
          <>
            Selecciona los estudiantes a los que se les imprimirá la hoja de respuestas unificada
            del compendio. Cada hoja incluye un QR firmado con el id del compendio (no de la
            evaluación).
          </>
        }
      />

      <form
        action={`/print/answer-sheets/bundle/${bundle.id}`}
        method="GET"
        target="_blank"
        className="bg-card space-y-4 rounded-xl border p-6"
      >
        <input type="hidden" name="t" value="" disabled />
        {/* El token HMAC no se puede pre-firmar desde el cliente (secreto en
            servidor); el flujo real es via API+worker. Este form queda como
            fallback para previsualización rápida: */}
        <p className="text-muted-foreground text-xs">
          Previsualiza o imprime directamente desde el navegador (sin pasar por el worker PDF).
        </p>
        <ul className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-2">
          {students.length === 0 ? (
            <li className="text-muted-foreground p-4 text-center text-sm">
              No hay estudiantes activos en la institución.
            </li>
          ) : (
            students.map((s) => (
              <li key={s.id}>
                <label className="hover:bg-accent flex cursor-pointer items-center gap-3 rounded-md p-2 text-sm">
                  <input type="checkbox" name="students" value={s.id} className="mt-1" />
                  <div className="flex-1">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {s.code} · {s.group?.name ?? "Sin curso"}
                    </div>
                  </div>
                </label>
              </li>
            ))
          )}
        </ul>

        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/admin/bundles/${bundle.id}`}
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          >
            ← Volver al compendio
          </Link>
          <button
            type="submit"
            className={cn(buttonVariants({ size: "sm" }))}
            disabled={students.length === 0}
          >
            Abrir en nueva pestaña
          </button>
        </div>
      </form>

      <div className="text-muted-foreground mt-4 text-xs">
        <strong>Nota:</strong> esta previsualización abre la página <code>/print/...</code>
        en el navegador. Para generar el PDF impositionado (saddle-stitch) usa el botón
        &quot;Descargar cuadernillo&quot; del compendio — el worker PDF se encarga.
      </div>
    </>
  );
}
