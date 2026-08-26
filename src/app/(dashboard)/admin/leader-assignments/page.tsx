import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { EntityForm } from "@/components/admin/entity-form";
import { makeListCourses } from "@/modules/academic/infrastructure/container";
import { makeListUsers } from "@/modules/users/infrastructure/container";
import { makeListLeaderAssignments } from "@/modules/leader-assignments/infrastructure/container";
import { assignLeaderAction, unassignLeaderFormAction } from "./actions";

export const metadata: Metadata = { title: "Asignación de Líderes ECU" };

/**
 * Admin asigna cursos a Líderes ECU. La asignación cubre el курсо entero
 * (todas sus asignaturas) — ver módulo `leader-assignments` (ago 2026,
 * feat/lider-ecu §3).
 */
export default async function LeaderAssignmentsPage() {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const [usersRes, coursesRes, assignmentsRes] = await Promise.all([
    makeListUsers().execute({ actor }),
    makeListCourses().execute({ actor }),
    makeListLeaderAssignments().execute({ actor }),
  ]);
  const users = usersRes.ok ? usersRes.value : [];
  const courses = coursesRes.ok ? coursesRes.value : [];
  const assignments = assignmentsRes.ok ? assignmentsRes.value : [];

  // Solo los usuarios con rol ECU_LIDER aparecen en el combobox de "Asignar".
  // (Los TEACHER/ADMIN no son líderes — el use case AssignLeader también
  // rechaza la asignación si el user no tiene el rol, pero la UI lo filtra
  // para mejor UX.)
  const leaders = users.filter((u) => u.roles.includes("ECU_LIDER") && u.isActive);
  const leaderOptions = leaders.map((u) => ({ value: u.id, label: u.name }));
  const courseOptions = courses.map((c) => ({ value: c.id, label: c.name }));

  // Indexamos por líder para mostrar la tabla "¿qué cursos lidera cada uno?".
  const byLeader = new Map<string, typeof assignments>();
  for (const a of assignments) {
    byLeader.set(a.userId, [...(byLeader.get(a.userId) ?? []), a]);
  }

  return (
    <>
      <PageHeader
        title="Asignación de Líderes ECU"
        description="Asigna grados enteros a cada Líder ECU. Verán en revisión y cuadernillos solo las formulaciones de los grados que lideran."
      />

      <div className="space-y-6">
        <section className="bg-card space-y-4 rounded-xl border p-6">
          <h2 className="font-semibold">Nueva asignación</h2>
          <EntityForm
            action={assignLeaderAction}
            submitLabel="Asignar"
            disabledReason={
              leaders.length === 0
                ? "No hay usuarios con rol Líder ECU. Crea uno en /admin/users."
                : courseOptions.length === 0
                  ? "No hay grados en la institución."
                  : undefined
            }
            fields={[
              {
                name: "userId",
                label: "Líder ECU",
                type: "select",
                required: true,
                options: leaderOptions,
              },
              {
                name: "courseId",
                label: "Grado",
                type: "select",
                required: true,
                options: courseOptions,
              },
            ]}
          />
        </section>

        <section className="bg-card space-y-4 rounded-xl border p-6">
          <h2 className="font-semibold">Asignaciones actuales ({assignments.length})</h2>
          {assignments.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Aún no hay asignaciones de Líderes ECU a cursos.
            </p>
          ) : (
            <div className="space-y-4">
              {leaders
                .filter((u) => byLeader.has(u.id))
                .map((u) => (
                  <div key={u.id} className="rounded-lg border p-4">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-muted-foreground mb-2 text-xs">
                      {byLeader.get(u.id)!.length} grado(s) asignado(s)
                    </p>
                    <ul className="space-y-2">
                      {byLeader.get(u.id)!.map((a) => (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
                        >
                          <span>{a.courseName}</span>
                          <form action={unassignLeaderFormAction} className="ml-auto">
                            <input type="hidden" name="userId" value={a.userId} />
                            <input type="hidden" name="courseId" value={a.courseId} />
                            <Button type="submit" size="sm" variant="ghost">
                              Quitar
                            </Button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
