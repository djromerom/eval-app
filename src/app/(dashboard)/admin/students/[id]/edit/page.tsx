import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeListGroups } from "@/modules/academic/infrastructure/container";
import { makeGetStudent } from "@/modules/students/infrastructure/container";
import { StudentEditForm } from "./student-edit-form";

export const metadata: Metadata = { title: "Editar estudiante" };

/**
 * Drawer de edición de un estudiante (Fase 12).
 *
 * Mismo patrón visual que `Admin · Edit Period drawer`: la página monta el
 * overview de `/admin/students` debajo de un backdrop, y un aside a la derecha
 * con el formulario editable. Cancelar/Volver navega de vuelta.
 *
 * La sub-ruta es independiente para soportar back/forward del navegador y
 * enlaces directos. El drawer mismo NO se renderiza en el layout — solo
 * existe en esta ruta.
 */
export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireAuthenticatedUser("ECU_MASTER");

  const [studentRes, groupsRes] = await Promise.all([
    makeGetStudent().execute({ actor, studentId: id }),
    makeListGroups().execute({ actor }),
  ]);

  if (!studentRes.ok) notFound();
  const student = studentRes.value;
  const groups = groupsRes.ok ? groupsRes.value : [];
  const groupOptions = groups.map((g: { id: string; name: string }) => ({
    value: g.id,
    label: g.name,
  }));

  return (
    <>
      <PageHeader title="Estudiantes" description="Editando un estudiante." />

      {/* Backdrop con link al overview. */}
      <Link
        href="/admin/students"
        aria-label="Cerrar drawer y volver al listado"
        className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
      />

      <aside
        aria-label="Editar estudiante"
        className="bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l shadow-xl"
      >
        <header className="bg-muted/30 flex items-center justify-between gap-2 border-b p-5">
          <div className="space-y-1">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
              <span className="bg-primary/10 text-primary inline-flex h-5 items-center rounded px-1.5 font-mono text-xs">
                {student.code}
              </span>
              Estudiante
            </p>
            <h1 className="font-display text-xl font-bold">{student.name}</h1>
          </div>
          <Link
            href="/admin/students"
            aria-label="Cerrar"
            className="hover:bg-muted inline-flex h-9 w-9 items-center justify-center rounded-md border"
          >
            <span aria-hidden>✕</span>
          </Link>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <StudentEditForm
            student={{
              id: student.id,
              name: student.name,
              idType: student.idType,
              idNumber: student.idNumber,
              groupId: student.groupId,
              enrollmentYear: student.enrollmentYear,
              isActive: student.isActive,
              code: student.code,
            }}
            groupOptions={groupOptions}
            returnHref="/admin/students"
          />
        </div>
      </aside>
    </>
  );
}
