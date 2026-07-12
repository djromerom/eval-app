import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { EntityForm } from "@/components/admin/entity-form";
import { ID_TYPES } from "@/modules/students/domain/student";
import { makeListStudents } from "@/modules/students/infrastructure/container";
import { makeListGroups } from "@/modules/academic/infrastructure/container";
import { createStudentAction } from "./actions";
import { ImportForm } from "./import-form";

export const metadata: Metadata = { title: "Estudiantes" };

export default async function StudentsPage() {
  const actor = await requireAuthenticatedUser("ADMIN");
  const [studentsRes, groupsRes] = await Promise.all([
    makeListStudents().execute({ actor }),
    makeListGroups().execute({ actor }),
  ]);
  const students = studentsRes.ok ? studentsRes.value : [];
  const groups = groupsRes.ok ? groupsRes.value : [];
  const groupOptions = groups.map((g) => ({ value: g.id, label: g.name }));
  const groupLabel = new Map(groups.map((g) => [g.id, g.name]));
  const currentYear = new Date().getFullYear();

  return (
    <>
      <PageHeader
        title="Estudiantes"
        description="Gestiona los estudiantes de tu institución. El código va embebido en el QR."
      />

      <div className="space-y-6">
        <section className="bg-card space-y-4 rounded-xl border p-6">
          <h2 className="font-semibold">Nuevo estudiante</h2>
          <EntityForm
            action={createStudentAction}
            submitLabel="Agregar"
            disabledReason={
              groups.length === 0 ? "Crea primero un grupo en Estructura académica." : undefined
            }
            fields={[
              {
                name: "groupId",
                label: "Grupo",
                type: "select",
                required: true,
                options: groupOptions,
              },
              {
                name: "name",
                label: "Nombre",
                type: "text",
                required: true,
                placeholder: "Ana Pérez",
              },
              {
                name: "idType",
                label: "Tipo doc.",
                type: "select",
                required: true,
                options: ID_TYPES.map((t) => ({ value: t, label: t })),
              },
              { name: "idNumber", label: "N.º doc.", type: "text", required: true },
              {
                name: "code",
                label: "Código",
                type: "text",
                required: true,
                placeholder: "EST-001",
              },
              {
                name: "enrollmentYear",
                label: "Año ingreso",
                type: "number",
                required: true,
                placeholder: String(currentYear),
              },
            ]}
          />
        </section>

        <section className="bg-card space-y-4 rounded-xl border p-6">
          <h2 className="font-semibold">Importación masiva</h2>
          <ImportForm />
        </section>

        <section className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Documento</th>
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Grupo</th>
                <th className="px-4 py-3 font-medium">Ingreso</th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted-foreground px-4 py-8 text-center">
                    Aún no hay estudiantes.
                  </td>
                </tr>
              ) : (
                students.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="text-muted-foreground px-4 py-3">
                      {s.idType} {s.idNumber}
                    </td>
                    <td className="text-muted-foreground px-4 py-3">{s.code}</td>
                    <td className="text-muted-foreground px-4 py-3">{groupLabel.get(s.groupId)}</td>
                    <td className="text-muted-foreground px-4 py-3">{s.enrollmentYear}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
