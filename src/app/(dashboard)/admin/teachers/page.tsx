import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { EntityForm } from "@/components/admin/entity-form";
import { TEACHER_ID_TYPES, isProfileComplete } from "@/modules/teachers/domain/teacher";
import {
  makeListTeacherAssignments,
  makeListTeachers,
} from "@/modules/teachers/infrastructure/container";
import { makeListCourseSubjects } from "@/modules/academic/infrastructure/container";
import { assignTeacherAction, createTeacherAction } from "./actions";
import { CompleteProfileForm } from "./complete-profile-form";
import { ResendInviteButton } from "./resend-invite-button";

export const metadata: Metadata = { title: "Docentes" };

export default async function TeachersPage() {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const [teachersRes, courseSubjectsRes, assignmentsRes] = await Promise.all([
    makeListTeachers().execute({ actor }),
    makeListCourseSubjects().execute({ actor }),
    makeListTeacherAssignments().execute({ actor }),
  ]);
  const teachers = teachersRes.ok ? teachersRes.value : [];
  const courseSubjects = courseSubjectsRes.ok ? courseSubjectsRes.value : [];
  const assignments = assignmentsRes.ok ? assignmentsRes.value : [];

  const teacherOptions = teachers.map((t) => ({ value: t.id, label: t.name }));
  const csOptions = courseSubjects.map((cs) => ({
    value: cs.id,
    label: `${cs.courseName} · ${cs.subjectName}`,
  }));
  const byTeacher = new Map<string, typeof assignments>();
  for (const a of assignments) {
    byTeacher.set(a.teacherId, [...(byTeacher.get(a.teacherId) ?? []), a]);
  }

  return (
    <>
      <PageHeader
        title="Docentes"
        description="Registra docentes (crea su cuenta inactiva) y asígnalos a asignaturas-curso. §3.2"
      />

      <div className="space-y-6">
        <section className="bg-card space-y-4 rounded-xl border p-6">
          <h2 className="font-semibold">Nuevo docente</h2>
          <EntityForm
            action={createTeacherAction}
            submitLabel="Registrar"
            fields={[
              {
                name: "name",
                label: "Nombre",
                type: "text",
                required: true,
                placeholder: "Nombre y apellido",
              },
              {
                name: "email",
                label: "Correo",
                type: "text",
                required: true,
                placeholder: "docente@colegio.edu.co",
              },
              {
                name: "idType",
                label: "Tipo doc.",
                type: "select",
                required: true,
                options: TEACHER_ID_TYPES.map((t) => ({ value: t, label: t })),
              },
              { name: "idNumber", label: "N.º doc.", type: "text", required: true },
              { name: "phone", label: "Teléfono", type: "text" },
            ]}
          />
        </section>

        <section className="bg-card space-y-4 rounded-xl border p-6">
          <h2 className="font-semibold">Asignar a asignatura-curso</h2>
          <EntityForm
            action={assignTeacherAction}
            submitLabel="Asignar"
            disabledReason={
              teachers.length === 0
                ? "Registra primero un docente."
                : courseSubjects.length === 0
                  ? "Enlaza asignaturas a cursos en Estructura académica."
                  : undefined
            }
            fields={[
              {
                name: "teacherId",
                label: "Docente",
                type: "select",
                required: true,
                options: teacherOptions,
              },
              {
                name: "courseSubjectId",
                label: "Asignatura-curso",
                type: "select",
                required: true,
                options: csOptions,
              },
            ]}
          />
        </section>

        <section className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground border-b text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Correo</th>
                <th className="px-4 py-3 font-medium">Documento</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 font-medium">Asignaturas-curso</th>
                <th className="px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {teachers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted-foreground px-4 py-8 text-center">
                    Aún no hay docentes.
                  </td>
                </tr>
              ) : (
                teachers.map((t) => {
                  const complete = isProfileComplete(t);
                  return (
                    <tr key={t.id} className="border-b align-top last:border-0">
                      <td className="px-4 py-3 font-medium">{t.name}</td>
                      <td className="text-muted-foreground px-4 py-3">{t.email}</td>
                      <td className="text-muted-foreground px-4 py-3">
                        {complete ? `${t.idType} ${t.idNumber}` : "Sin documento"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <span
                            className={
                              t.isActive
                                ? "bg-primary/10 text-primary inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                                : "bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                            }
                          >
                            {t.isActive ? "Activo" : "Invitado"}
                          </span>
                          {!complete ? (
                            <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                              Perfil incompleto
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-muted-foreground px-4 py-3">
                        {(byTeacher.get(t.id) ?? [])
                          .map((a) => `${a.courseName}·${a.subjectName}`)
                          .join(", ") || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-2">
                          {!complete ? <CompleteProfileForm teacherId={t.id} /> : null}
                          {!t.isActive ? <ResendInviteButton teacherId={t.id} /> : null}
                          {complete && t.isActive ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
