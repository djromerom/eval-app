"use client";

import { useActionState, useState } from "react";
import { Plus, Users2, BookOpen, Trash2, GraduationCap, ChevronDown } from "lucide-react";
import {
  createCourseSubjectAction,
  createGroupAction,
  deleteCourseSubjectAction,
  deleteGroupAction,
  type FormState,
} from "../actions";
import { Button } from "@/components/ui/button";

export interface SubjectOption {
  value: string;
  label: string;
}

export interface GroupRow {
  id: string;
  name: string;
}

/** Una asignatura ya enlazada al curso (la PK compuesta + el nombre). */
export interface LinkedSubjectRow {
  /** PK de CourseSubject — la que pasamos a deleteCourseSubjectAction. */
  id: string;
  name: string;
}

export interface CourseActionsProps {
  courseId: string;
  courseName: string;
  courseCode: string;
  groups: GroupRow[];
  subjects: LinkedSubjectRow[];
  /** Lista de asignaturas DISPONIBLES (no las ya enlazadas). Si está vacía,
   *  el CTA "Agregar asignatura" se renderiza disabled con tooltip. */
  availableSubjects: SubjectOption[];
  /** Estado inicial: por defecto COLAPSADO. La card del año muestra de un
   *  vistazo la lista de cursos en formato "scan" (nombre + código + meta
   *  `N grupos · M asig`). Click en el header para expandir y editar sus
   *  grupos/asignaturas. */
  defaultExpanded?: boolean;
}

/**
 * Bloque contextual por curso — estilo "mini drawer" dentro de la card del
 * año. Colapsable: el header completo (icono + nombre + chip del código +
 * meta `N grupos · M asig`) es el botón de toggle. Expandido muestra dos
 * secciones (Grupos y Asignaturas) cada una como una lista de filas con su
 * botón de eliminar (X), y un CTA "+ Agregar…" al pie.
 *
 * Confirmación de eliminación: 2 pasos inline ("¿Eliminar? Sí/No"), mismo
 * patrón que el drawer de periodos.
 */
export function CourseActions({
  courseId,
  courseName,
  courseCode,
  groups,
  subjects,
  availableSubjects,
  defaultExpanded = false,
}: CourseActionsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const meta = `${groups.length} ${groups.length === 1 ? "grupo" : "grupos"} · ${subjects.length} ${
    subjects.length === 1 ? "asignatura" : "asignaturas"
  }`;

  return (
    <div>
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label={`Expandir curso ${courseName}`}
          className="hover:bg-muted/40 -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 py-1.5 text-left transition-colors"
        >
          <GraduationCap className="text-primary h-4 w-4" />
          <p className="text-foreground text-sm font-semibold">{courseName}</p>
          <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
            {courseCode}
          </span>
          <span className="text-muted-foreground flex-1 text-xs">{meta}</span>
          <ChevronDown className="text-muted-foreground h-4 w-4 -rotate-90" />
        </button>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-expanded={true}
            aria-label={`Contraer curso ${courseName}`}
            className="hover:bg-muted/40 -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 py-1 text-left transition-colors"
          >
            <GraduationCap className="text-primary h-4 w-4" />
            <p className="text-foreground text-sm font-semibold">{courseName}</p>
            <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]">
              {courseCode}
            </span>
            <span className="text-muted-foreground flex-1 text-xs">{meta}</span>
            <ChevronDown className="text-muted-foreground h-4 w-4" />
          </button>

          <div className="space-y-3 border-t pt-3">
            <Section
              icon={<Users2 className="h-3.5 w-3.5" />}
              title="Grupos"
              count={groups.length}
              emptyLabel="Sin grupos aún."
            >
              {[
                groups.length > 0 ? (
                  <ul className="space-y-1.5">
                    {groups.map((g) => (
                      <Row key={g.id} label={g.name}>
                        <DeleteRowAction
                          action={deleteGroupAction}
                          hiddenField={{ name: "groupId", value: g.id }}
                          entityLabel={`grupo "${g.name}"`}
                        />
                      </Row>
                    ))}
                  </ul>
                ) : null,
                <AddRowForm
                  key="add-group"
                  action={createGroupAction}
                  submitLabel="Crear"
                  hiddenFields={[{ name: "courseId", value: courseId }]}
                  inputPlaceholder="ej. 11-03"
                  inputName="name"
                />,
              ]}
            </Section>

            <Section
              icon={<BookOpen className="h-3.5 w-3.5" />}
              title="Asignaturas"
              count={subjects.length}
              emptyLabel={
                availableSubjects.length === 0
                  ? "Todas las asignaturas ya están enlazadas."
                  : "Sin asignaturas aún."
              }
            >
              {[
                subjects.length > 0 ? (
                  <ul className="space-y-1.5">
                    {subjects.map((s) => (
                      <Row key={s.id} label={s.name}>
                        <DeleteRowAction
                          action={deleteCourseSubjectAction}
                          hiddenField={{ name: "courseSubjectId", value: s.id }}
                          entityLabel={`asignatura "${s.name}" de ${courseName}`}
                        />
                      </Row>
                    ))}
                  </ul>
                ) : null,
                <AddSubjectRowForm
                  key="add-subject"
                  courseId={courseId}
                  courseName={courseName}
                  availableSubjects={availableSubjects}
                />,
              ]}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Sub-componentes =====

function Section({
  icon,
  title,
  count,
  emptyLabel,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  emptyLabel: string;
  /** children[0] = lista de filas + subtítulo (cuando count > 0),
      children[1] = CTA / sub-form de alta (siempre). */
  children: [React.ReactNode, React.ReactNode];
}) {
  return (
    <section className="space-y-2">
      <header className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        {icon}
        {title}
        <span className="bg-primary/10 text-primary rounded-full px-1.5 py-0.5 text-[10px] font-bold">
          {count}
        </span>
      </header>
      {count === 0 ? (
        <p className="text-muted-foreground text-xs italic">{emptyLabel}</p>
      ) : (
        children[0]
      )}
      {/* Form de alta siempre visible — el docente puede añadir varios. */}
      {children[1]}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="bg-muted/40 flex items-center gap-2 rounded-md border px-2.5 py-1.5">
      <span className="text-foreground flex-1 text-sm font-medium">{label}</span>
      {children}
    </li>
  );
}

/**
 * Botón destructivo con confirmación inline de 2 pasos (mismo patrón que el
 * drawer de periodos). Al primer click aparece "¿Eliminar? Sí/No". Al click
 * en Sí, hace submit del form hermano apuntando a la acción pasada.
 */
function DeleteRowAction({
  action,
  hiddenField,
  entityLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  hiddenField: { name: string; value: string };
  entityLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(action, {} as FormState);

  if (state.error && !confirming) {
    return (
      <span className="text-destructive text-xs" role="alert">
        {state.error}
      </span>
    );
  }

  return confirming ? (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name={hiddenField.name} value={hiddenField.value} />
      <span className="text-destructive text-xs">¿Eliminar?</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={() => setConfirming(false)}
      >
        No
      </Button>
      <Button type="submit" variant="destructive" size="sm" className="h-6 px-2 text-xs">
        Sí
      </Button>
    </form>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-muted-foreground hover:text-destructive h-6 w-6"
      onClick={() => setConfirming(true)}
      aria-label={`Eliminar ${entityLabel}`}
      title={`Eliminar ${entityLabel}`}
    >
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

/**
 * Sub-form para añadir un grupo: input de texto corto + Crear/Cancelar.
 * Mismo patrón que el drawer: ocultar/mostrar según `open`.
 */
function AddRowForm({
  action,
  submitLabel,
  hiddenFields,
  inputName,
  inputPlaceholder,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  hiddenFields: { name: string; value: string }[];
  inputName: string;
  inputPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, {} as FormState);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs"
      >
        <Plus className="h-3 w-3" /> Agregar
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      {hiddenFields.map((hf) => (
        <input key={hf.name} type="hidden" name={hf.name} value={hf.value} />
      ))}
      <input
        type="text"
        name={inputName}
        required
        placeholder={inputPlaceholder}
        className="border-input focus:ring-primary/30 h-7 w-32 rounded-md border px-2 text-xs focus:ring-2 focus:outline-none"
      />
      <Button type="submit" size="sm" className="h-7 px-2 text-xs">
        {submitLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(false)}
      >
        Cancelar
      </Button>
      {state.error ? (
        <span className="text-destructive w-full text-xs" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function AddSubjectRowForm({
  courseId,
  courseName,
  availableSubjects,
}: {
  courseId: string;
  courseName: string;
  availableSubjects: SubjectOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createCourseSubjectAction, {} as FormState);

  if (availableSubjects.length === 0 && !open) {
    return (
      <button
        type="button"
        disabled
        title={`Todas las asignaturas disponibles ya están enlazadas a ${courseName}`}
        className="text-muted-foreground/50 inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs"
      >
        <Plus className="h-3 w-3" /> Agregar asignatura
      </button>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs"
      >
        <Plus className="h-3 w-3" /> Agregar asignatura
      </button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="courseId" value={courseId} />
      <select
        name="subjectId"
        required
        defaultValue=""
        className="border-input bg-background h-7 w-44 rounded-md border px-2 text-xs"
      >
        <option value="" disabled>
          Selecciona…
        </option>
        {availableSubjects.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" className="h-7 px-2 text-xs">
        Enlazar
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen(false)}
      >
        Cancelar
      </Button>
      {state.error ? (
        <span className="text-destructive w-full text-xs" role="alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
