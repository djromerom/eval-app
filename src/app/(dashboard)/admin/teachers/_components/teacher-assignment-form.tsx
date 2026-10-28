"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import type { AdminFormState } from "@/components/admin/entity-form";

export interface TeacherOption {
  id: string;
  name: string;
}

export interface CourseOption {
  id: string;
  name: string;
  academicYearId: string;
  /** Año del grado, para desambiguar "8° 2025" de "8° 2026". */
  year: number;
}

export interface CourseSubjectOption {
  id: string;
  courseId: string;
  subjectName: string;
}

export interface BookletTypeOption {
  id: string;
  name: string;
  /** Prueba (Period) a la que pertenece el tipo. */
  periodName: string;
  /** Año académico de la prueba — el tipo se filtra por el del grado. */
  academicYearId: string;
  year: number;
}

type Action = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

/**
 * Form de asignación docente ↔ asignatura-grado POR TIPO DE CUADERNILLO.
 *
 * Es client (a diferencia del `EntityForm` genérico) porque los tres selects
 * están encadenados:
 *
 *   Grado → filtra las Asignaturas de ese grado
 *   Grado → filtra los Tipos de cuadernillo (los del mismo año académico)
 *
 * El orden es Grado → Asignatura → Tipo (pedido del docente, oct 2026): el
 * grado primero porque es lo que acota todo lo demás.
 *
 * El tipo de cuadernillo es OBLIGATORIO en el form: la asignación ahora
 * dice a qué cuadernillo aplica el docente (p. ej. "Especial" lo dicta otro
 * docente que "Estándar"). Si la institución no tiene tipos configurados
 * para el año del grado, el select queda deshabilitado y la asignación
 * queda "para cualquier tipo" (mismo valor de las filas previas al sprint).
 */
export function TeacherAssignmentForm({
  action,
  teachers,
  courses,
  courseSubjects,
  bookletTypes,
  disabledReason,
}: {
  action: Action;
  teachers: TeacherOption[];
  courses: CourseOption[];
  courseSubjects: CourseSubjectOption[];
  bookletTypes: BookletTypeOption[];
  disabledReason?: string;
}) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  const [courseId, setCourseId] = useState("");
  const [courseSubjectId, setCourseSubjectId] = useState("");
  const [bookletTypeId, setBookletTypeId] = useState("");

  // Asignaturas habilitadas en el grado elegido.
  const subjectOptions = useMemo(
    () => courseSubjects.filter((cs) => cs.courseId === courseId),
    [courseSubjects, courseId],
  );

  // Tipos de cuadernillo del año académico del grado elegido (con grado
  // vacío se ofrecen todos: el admin puede ver el catálogo completo antes
  // de elegir).
  const selectedYearId = courses.find((c) => c.id === courseId)?.academicYearId;
  const typeOptions = useMemo(
    () =>
      selectedYearId
        ? bookletTypes.filter((bt) => bt.academicYearId === selectedYearId)
        : bookletTypes,
    [bookletTypes, selectedYearId],
  );

  // Cambiar el grado invalida la asignatura (puede no existir en el nuevo
  // grado) y el tipo (puede ser de otro año académico).
  const handleCourseChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCourseId(e.target.value);
    setCourseSubjectId("");
    setBookletTypeId("");
  };

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setCourseId("");
      setCourseSubjectId("");
      setBookletTypeId("");
    }
  }, [state.success]);

  if (disabledReason) {
    return <p className="text-muted-foreground text-sm">{disabledReason}</p>;
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
      <FieldBlock id="teacherId" label="Docente" required>
        <select id="teacherId" name="teacherId" required className={selectClass} defaultValue="">
          <option value="">—</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FieldBlock>

      <FieldBlock id="courseId" label="Grado" required>
        <select
          id="courseId"
          name="courseId"
          required
          className={selectClass}
          value={courseId}
          onChange={handleCourseChange}
        >
          <option value="">—</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.year}
            </option>
          ))}
        </select>
      </FieldBlock>

      <FieldBlock id="courseSubjectId" label="Asignatura" required>
        <select
          id="courseSubjectId"
          name="courseSubjectId"
          required
          className={selectClass}
          value={courseSubjectId}
          onChange={(e) => setCourseSubjectId(e.target.value)}
          disabled={!courseId || subjectOptions.length === 0}
        >
          <option value="">—</option>
          {subjectOptions.map((cs) => (
            <option key={cs.id} value={cs.id}>
              {cs.subjectName}
            </option>
          ))}
        </select>
        {courseId && subjectOptions.length === 0 ? (
          <p className="text-muted-foreground text-xs">Ese grado no tiene asignaturas enlazadas.</p>
        ) : null}
      </FieldBlock>

      <FieldBlock id="bookletTypeId" label="Tipo de cuadernillo" required={typeOptions.length > 0}>
        <select
          id="bookletTypeId"
          name="bookletTypeId"
          required={typeOptions.length > 0}
          className={selectClass}
          value={bookletTypeId}
          onChange={(e) => setBookletTypeId(e.target.value)}
          disabled={typeOptions.length === 0}
        >
          <option value="">—</option>
          {typeOptions.map((bt) => (
            <option key={bt.id} value={bt.id}>
              {bt.name} · {bt.periodName} ({bt.year})
            </option>
          ))}
        </select>
        {typeOptions.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Sin tipos configurados: la asignación aplica a cualquier cuadernillo.
          </p>
        ) : null}
      </FieldBlock>

      <SubmitButton label="Asignar" />
      {state.error ? <p className="text-destructive w-full text-sm">{state.error}</p> : null}
    </form>
  );
}

function FieldBlock({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-muted-foreground block text-xs font-medium">
        {label}
        {required ? <span aria-hidden> *</span> : null}
      </label>
      {children}
    </div>
  );
}

/** Botón de submit con estado pending vía useFormStatus. */
function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Guardando…" : label}
    </Button>
  );
}
