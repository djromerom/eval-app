"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createBundleAction, type BundleFormState } from "../actions";

interface CandidateEvaluation {
  id: string;
  title: string;
  status: string;
  totalQuestions: number;
  courseId: string;
  courseName: string;
  subjectName: string;
  /** Prueba de la formulación (nullable). Un cuadernillo agrupa
   *  formulaciones de UNA prueba: los candidatos se acotan a la prueba
   *  seleccionada. */
  periodId: string | null;
}

interface CourseOption {
  id: string;
  name: string;
}

interface PeriodOption {
  id: string;
  name: string;
  academicYearId: string;
  isCurrent: boolean;
}

interface BookletTypeOption {
  id: string;
  periodId: string;
  name: string;
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? "Creando…" : "Crear cuadernillo"}
    </Button>
  );
}

/**
 * Wizard de creación. Step 1: nombre + bookletNumber + (Prueba, Tipo opcional)
 * + grado. Step 2: selección de formulaciones (checkbox list con búsqueda por
 * título/asignatura). El submit envía un solo FormData al server action
 * `createBundleAction` con todos los `evaluationIds` seleccionados.
 *
 * Sprint Bundle-Period (sep 2026): el select de Prueba se preselecciona y
 * bloquea con el periodo actual del año académico vigente (mismo patrón que
 * `create-evaluation-form.tsx`). El select de Tipo de cuadernillo se filtra
 * en cliente por la Prueba seleccionada. "" en el Tipo = sin tipo (opcional:
 * si la Prueba seleccionada no tiene tipos configurados, el select queda
 * disabled con hint).
 */
export function CreateBundleWizard({
  evaluations,
  courses,
  periods,
  bookletTypes,
  currentPeriodId,
}: {
  evaluations: CandidateEvaluation[];
  courses: CourseOption[];
  periods: PeriodOption[];
  bookletTypes: BookletTypeOption[];
  /** Id de la prueba actual, resuelto en el servidor con la regla year-aware
   *  (`GetCurrentPeriod`). `null` = no hay prueba actual marcada. */
  currentPeriodId: string | null;
}) {
  const [state, formAction] = useActionState(createBundleAction, {} as BundleFormState);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  // "" = cuadernillo cross-course: admite formulaciones de cualquier grado.
  const [courseId, setCourseId] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  // Sprint Bundle-Period: preselección de la Prueba actual (mismo patrón que
  // create-evaluation-form.tsx). La prueba actual la resuelve el servidor
  // (`GetCurrentPeriod`, regla year-aware): buscar "la primera marcada" en
  // la lista podía devolver la de un año ya cerrado.
  const currentPeriod = useMemo(
    () => periods.find((p) => p.id === currentPeriodId) ?? null,
    [periods, currentPeriodId],
  );
  const [periodId, setPeriodId] = useState(() => currentPeriod?.id ?? "");
  const [bookletTypeId, setBookletTypeId] = useState("");
  const periodLocked = !!currentPeriod;
  // Fecha de la prueba (sep 2026). yyyy-mm-dd para <input type="date">.
  // "" = no asignar al crear (queda null en BD → no se imprime en la hoja).
  const [evaluationDate, setEvaluationDate] = useState("");

  // BookletTypes disponibles para la Prueba seleccionada.
  const filteredTypes = useMemo(
    () => (periodId ? bookletTypes.filter((bt) => bt.periodId === periodId) : []),
    [periodId, bookletTypes],
  );

  // Si cambia la Prueba seleccionada, descartamos el Tipo seleccionado si ya
  // no es válido. Caso edge: el admin elige Tipo y luego cambia de Prueba.
  useEffect(() => {
    if (!periodId) {
      if (bookletTypeId) setBookletTypeId("");
      return;
    }
    if (bookletTypeId && !filteredTypes.find((bt) => bt.id === bookletTypeId)) {
      setBookletTypeId("");
    }
  }, [periodId, filteredTypes, bookletTypeId]);

  // Filtro por curso (duro: el use case rechaza mezclas) + búsqueda libre.
  const filtered = evaluations.filter((e) => {
    // Un cuadernillo agrupa formulaciones de UNA prueba: los candidatos se
    // acotan a la prueba seleccionada (por defecto, la actual).
    if (periodId && e.periodId !== periodId) return false;
    if (courseId && e.courseId !== courseId) return false;
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      e.title.toLowerCase().includes(q) ||
      e.subjectName.toLowerCase().includes(q) ||
      e.courseName.toLowerCase().includes(q)
    );
  });

  /**
   * Al cambiar de curso descartamos la selección previa: esas formulaciones
   * ya no están visibles en la lista y el use case las rechazaría, así que
   * dejarlas marcadas produciría un error confuso al enviar.
   */
  function changeCourse(nextCourseId: string) {
    setCourseId(nextCourseId);
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Tras éxito, el server action redirige (redirect()), por lo que no llega aquí.
  // Si llega un error, lo mostramos y no tocamos selected.
  useEffect(() => {
    /* no-op: useActionState maneja el reset vía formRef si quisiéramos */
  }, [state]);

  const totalQuestions = evaluations
    .filter((e) => selected.has(e.id))
    .reduce((acc, e) => acc + e.totalQuestions, 0);

  return (
    <form ref={formRef} action={formAction} className="bg-card space-y-6 rounded-xl border p-6">
      {/* Step 1 — metadatos */}
      <section className="space-y-4">
        <h2 className="font-semibold">1. Datos del cuadernillo</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="name" className="text-sm font-medium">
              Nombre del cuadernillo
            </label>
            <Input
              id="name"
              name="name"
              required
              placeholder="Cuadernillo 11° — I periodo"
              minLength={3}
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="bookletNumber" className="text-sm font-medium">
              N° de cuadernillo (opcional)
            </label>
            <Input
              id="bookletNumber"
              name="bookletNumber"
              type="number"
              min={1}
              step={1}
              placeholder="1"
            />
          </div>
        </div>

        {/* Sprint Bundle-Period: Prueba preseleccionada y bloqueada cuando
            hay un periodo "actual" en la institución. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="periodId" className="text-sm font-medium">
              Prueba
            </label>
            <select
              id="periodId"
              // Cuando el periodo viene bloqueado, el <select> pierde el `name`
              // (los form controls disabled NO se serializan en FormData) y
              // añadimos un <input type="hidden"> gemelo. Cuando no hay
              // periodo actual, el select es editable y conserva su `name`.
              name={periodLocked ? undefined : "periodId"}
              required={!periodLocked}
              value={periodId}
              onChange={(e) => setPeriodId(e.target.value)}
              disabled={periodLocked}
              aria-readonly={periodLocked ? true : undefined}
              className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none disabled:opacity-60"
            >
              <option value="">Seleccione</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {periodLocked && <input type="hidden" name="periodId" value={periodId} />}
            <p className="text-muted-foreground text-xs">
              {currentPeriod
                ? "Prueba en curso del año académico vigente. Puedes cambiarla desde la edición del cuadernillo."
                : "Selecciona la Prueba a la que pertenece este cuadernillo."}
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="bookletTypeId" className="text-sm font-medium">
              Tipo de cuadernillo (opcional)
            </label>
            <select
              id="bookletTypeId"
              name="bookletTypeId"
              value={bookletTypeId}
              onChange={(e) => setBookletTypeId(e.target.value)}
              disabled={!periodId || filteredTypes.length === 0}
              className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none disabled:opacity-60"
            >
              <option value="">Sin tipo (todas las formulaciones)</option>
              {filteredTypes.map((bt) => (
                <option key={bt.id} value={bt.id}>
                  {bt.name}
                </option>
              ))}
            </select>
            {periodId && filteredTypes.length === 0 && (
              <p className="text-muted-foreground text-xs">
                La Prueba seleccionada no tiene tipos configurados.
              </p>
            )}
          </div>
        </div>

        {/* Fecha de la prueba (sep 2026): si está set, se imprime en la
            hoja de respuestas unificada del cuadernillo. Opcional al crear. */}
        <div className="space-y-1">
          <label htmlFor="evaluationDate" className="text-sm font-medium">
            Fecha de la prueba (opcional)
          </label>
          <input
            id="evaluationDate"
            name="evaluationDate"
            type="date"
            value={evaluationDate}
            onChange={(e) => setEvaluationDate(e.target.value)}
            className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none sm:max-w-xs"
          />
          <p className="text-muted-foreground text-xs">
            Si la defines, se imprime en la hoja de respuestas. Déjala vacía para no mostrar el
            campo.
          </p>
        </div>

        <div className="space-y-1">
          <label htmlFor="courseId" className="text-sm font-medium">
            Grado (opcional)
          </label>
          <select
            id="courseId"
            name="courseId"
            value={courseId}
            onChange={(e) => changeCourse(e.target.value)}
            className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
          >
            <option value="">Sin grado específico (varios grados)</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">
            {courseId
              ? "Solo se listan formulaciones de este grado, y el grado se preimprime en la portada."
              : "Sin grado, el cuadernillo admite formulaciones de cualquier grado y el estudiante escribe el suyo."}
          </p>
        </div>
      </section>

      {/* Step 2 — selección de formulaciones */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-semibold">
            2. Formulaciones ({selected.size} seleccionada{selected.size === 1 ? "" : "s"})
          </h2>
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar…"
            className="max-w-xs"
          />
        </div>

        {evaluations.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            No hay formulaciones aprobadas o publicadas disponibles para incluir.
          </p>
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto rounded-md border p-2">
            {filtered.length === 0 ? (
              <li className="text-muted-foreground p-4 text-center text-sm">
                {courseId
                  ? "No hay formulaciones de este grado. Elige otro o quita el filtro de grado."
                  : "Sin coincidencias."}
              </li>
            ) : (
              filtered.map((e) => (
                <li key={e.id}>
                  <label className="hover:bg-accent flex cursor-pointer items-start gap-3 rounded-md p-2 text-sm">
                    <input
                      type="checkbox"
                      name="evaluationIds"
                      value={e.id}
                      checked={selected.has(e.id)}
                      onChange={() => toggle(e.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium">{e.title}</div>
                      <div className="text-muted-foreground text-xs">
                        {e.subjectName} · {e.courseName} · {e.totalQuestions} preguntas · {e.status}
                      </div>
                    </div>
                  </label>
                </li>
              ))
            )}
          </ul>
        )}

        {selected.size > 0 ? (
          <p className="text-muted-foreground text-xs">
            Total de preguntas estimado: <strong>{totalQuestions}</strong> (~{" "}
            {Math.ceil((totalQuestions * 2.5) / 60)} h de aplicación a ritmo ICFES).
          </p>
        ) : null}
      </section>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}

      <div className="flex items-center justify-end gap-2">
        <SubmitButton disabled={selected.size === 0} />
      </div>
    </form>
  );
}
