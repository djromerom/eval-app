"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import type { AdminFormState } from "@/components/admin/entity-form";
import type { Field } from "@/components/admin/entity-form";

interface BookletTypeRow {
  id: string;
  name: string;
  periodId: string;
}

interface PeriodRow {
  id: string;
  name: string;
  academicYearId: string;
  isCurrent: boolean;
}

interface ExistingEntry {
  id: string;
  title: string;
}

type Action = (state: AdminFormState, formData: FormData) => Promise<AdminFormState>;

/**
 * Wrapper client sobre `EntityForm` para crear formulaciones.
 *
 * Necesita ser client porque el select "Tipo de cuadernillo" se filtra
 * según la Prueba seleccionada en el propio form (ago 2026). El server
 * carga TODOS los BookletTypes de la institución una sola vez (tabla
 * chica, decenas de filas); el filtrado es client-side por `periodId`.
 *
 * Si la Prueba seleccionada no tiene tipos configurados, el select queda
 * disabled con hint (UX: el docente sabe que tiene que pedirle al admin
 * que agregue tipos antes de poder elegir uno).
 *
 * Renderizamos un <form action={formAction}> propio (no usamos
 * EntityForm) porque necesitamos manejar el estado de los dos selects
 * dependientes entre sí.
 *
 * Desde ago 2026 también maneja:
 * - Preselección/bloqueo del select de Prueba cuando hay una Prueba marcada
 *   como "actual" en el año académico del courseSubject elegido.
 * - Detección client-side de duplicados (mismo courseSubjectId + periodId)
 *   para redirigir al docente a la formulación existente en lugar de fallar
 *   con el error 409 "Ya existe una formulación…".
 */
export function CreateEvaluationForm({
  action,
  fields,
  submitLabel,
  disabledReason,
  bookletTypes,
  csYearMap,
  periods,
  existingMap,
}: {
  action: Action;
  fields: Field[];
  submitLabel: string;
  disabledReason?: string;
  bookletTypes: BookletTypeRow[];
  /** courseSubjectId → academicYearId (server precomputa el cruce). */
  csYearMap: Record<string, string>;
  /** Periodos con `isCurrent` y `academicYearId`. */
  periods: PeriodRow[];
  /** Mapa (`courseSubjectId|periodId|bookletTypeId`) → { id, title } de
   *  formulaciones ya existentes para el docente. Si la combinación
   *  seleccionada tiene match, se renderiza un link directo a esa formulación
   *  en lugar del botón "Formular" (ago 2026). Clave compuesta con `""` como
   *  sentinel de "sin periodo" / "sin tipo" para mantener 1:1 con la regla
   *  del repo. */
  existingMap: Record<string, ExistingEntry>;
}) {
  const [state, formAction] = useActionState<AdminFormState, FormData>(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  // Encontrar el periodo "actual" (uno por institución/año académico). Si
  // la institución no tiene ninguno marcado como `isCurrent`, no hay
  // preselección ni bloqueo y el form queda con todos los campos vacíos
  // (caso defensivo). (ago 2026 — pedido del docente: "Prueba solo la
  // actual por defecto y bloqueada, Asignatura solo del año marcado como
  // actual".)
  const currentPeriod = useMemo(() => periods.find((p) => p.isCurrent), [periods]);
  const currentAcademicYearId = currentPeriod?.academicYearId;

  // Definimos los fields arriba para poder usarlos en los useMemos de abajo
  // (filteredCsOptions, etc.) sin tener que duplicar el lookup.
  const periodField = fields.find((f) => f.name === "periodId");
  const csField = fields.find((f) => f.name === "courseSubjectId");

  // Mantenemos el estado de los dos selects que dependen entre sí.
  // periodId se inicializa con el periodo actual si existe (lazy initializer,
  // solo corre en el primer render): el docente ve Prueba preseleccionada y
  // bloqueada desde el mount, sin tener que tipear nada para "armar" la
  // formulación. bookletTypeId y courseSubjectId arrancan vacíos para que
  // el docente los elija explícitamente.
  const [periodId, setPeriodId] = useState(() => currentPeriod?.id ?? "");
  const [bookletTypeId, setBookletTypeId] = useState("");
  const [courseSubjectId, setCourseSubjectId] = useState("");

  // Filtramos los BookletTypes disponibles para la Prueba seleccionada.
  const filteredTypes = useMemo(
    () => (periodId ? bookletTypes.filter((bt) => bt.periodId === periodId) : []),
    [periodId, bookletTypes],
  );

  // Filtramos las Asignaturas disponibles al año académico del periodo
  // actual (ago 2026): el docente solo ve las Asignaturas del año
  // vigente, no las de años pasados. Si no hay periodo actual (caso
  // defensivo), mostramos todas las opciones. El filtro es client-side
  // porque el server ya pasa el csYearMap precomputado.
  const filteredCsOptions = useMemo(() => {
    const opts = csField?.options ?? [];
    if (!currentAcademicYearId) return opts;
    return opts.filter((opt) => csYearMap[opt.value] === currentAcademicYearId);
  }, [csField?.options, csYearMap, currentAcademicYearId]);

  // Cuando cambia el periodo, limpiamos el bookletTypeId.
  const handlePeriodChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPeriodId(e.target.value);
    setBookletTypeId("");
  };

  // periodLocked: si hay un periodo actual preseleccionado, la Prueba se
  // queda BLOQUEADA desde el mount (consistente con la preselección).
  // Sin periodo actual, el docente elige libremente cualquier Prueba y
  // cualquier Asignatura. (ago 2026)
  const periodLocked = !!currentPeriod;

  // Detección client-side de duplicados (ago 2026). Cuando el docente
  // selecciona una combinación (courseSubjectId, periodId, bookletTypeId) para
  // la que ya existe una formulación, en lugar de mostrar el botón "Formular"
  // enseñamos un link directo a la existente para que el docente entre
  // directamente. La clave compuesta usa "" como sentinel de "sin periodo" /
  // "sin tipo" (mismo shape que en el repo: `periodId ?? null`,
  // `bookletTypeId ?? null`). ago 2026: la clave incluye bookletTypeId para
  // que un docente con una formulación "Estándar" pueda crear la "Con Ajuste"
  // sin que el form lo redirija a la "Estándar".
  const existing = useMemo<ExistingEntry | null>(() => {
    if (!courseSubjectId) return null;
    const key = `${courseSubjectId}|${periodId || ""}|${bookletTypeId || ""}`;
    return existingMap[key] ?? null;
  }, [courseSubjectId, periodId, bookletTypeId, existingMap]);

  // Cuando cambia la asignatura, resincronizamos periodId con el periodo
  // actual del año del curso asociado (sigue siendo el mismo currentPeriod
  // gracias al filtro de filteredCsOptions, pero defendemos contra la
  // posibilidad de que el docente manipule el DOM).
  const handleCourseSubjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextCsId = e.target.value;
    setCourseSubjectId(nextCsId);
    setBookletTypeId("");

    const ay = csYearMap[nextCsId];
    if (ay) {
      const current = periods.find((p) => p.academicYearId === ay && p.isCurrent);
      setPeriodId(current ? current.id : "");
    } else {
      setPeriodId("");
    }
  };

  // Reseteo del form tras éxito (mismo patrón que EntityForm). Tras
  // guardar exitosamente, dejamos Prueba preseleccionada con el periodo
  // actual (no la vaciamos) para que el docente pueda crear otra
  // formulación sin re-pickear el periodo.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setCourseSubjectId("");
      setPeriodId(currentPeriod?.id ?? "");
      setBookletTypeId("");
    }
  }, [state.success, currentPeriod]);

  if (disabledReason) {
    return <p className="text-muted-foreground text-sm">{disabledReason}</p>;
  }

  if (!periodField || !csField) {
    return null;
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        // Si ya existe una formulación para la combinación seleccionada,
        // el botón "Formular" redirige directamente al editor unificado de
        // la existente en lugar de disparar el submit (que caería en 409).
        // Una sola CTA para ambas intenciones (crear nueva / abrir existente).
        if (existing) {
          e.preventDefault();
          window.location.href = `/teacher/evaluations/${existing.id}/unified?from=list`;
        }
      }}
    >
      <FieldBlock label={periodField.label} required={periodField.required}>
        {/* Importante: cuando la Prueba viene preseleccionada por ser la
          "actual" del año académico del courseSubject, el <select> queda
          `disabled`. **Los form controls disabled NO se serializan en
          FormData** (especificación HTML), así que si solo dejamos el
          select disabled el periodId nunca llega al server action y la
          nueva evaluación queda con periodId=null. Para evitarlo, en modo
          bloqueado renderizamos un <input type="hidden"> gemelo que
          siempre viaja con el submit, y le quitamos el `name` al select
          (solo es decorativo en ese modo). En modo editable el select
          conserva su `name` y el hidden input no se renderiza. */}
        <select
          id={periodField.name}
          name={periodLocked ? undefined : periodField.name}
          required={periodField.required && !periodLocked}
          className={`${selectClass} mb-0`}
          value={periodId}
          onChange={handlePeriodChange}
          disabled={periodLocked}
          aria-readonly={periodLocked ? true : undefined}
        >
          <option value="">Seleccione</option>
          {periodField.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {periodLocked && <input type="hidden" name={periodField.name} value={periodId} />}
      </FieldBlock>

      <FieldBlock label={csField.label} required={csField.required}>
        <select
          id={csField.name}
          name={csField.name}
          required={csField.required}
          className={selectClass}
          value={courseSubjectId}
          onChange={handleCourseSubjectChange}
        >
          <option value="">Seleccione</option>
          {filteredCsOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </FieldBlock>

      <FieldBlock label="Tipo de cuadernillo" required>
        <select
          id="bookletTypeId"
          name="bookletTypeId"
          required
          className={selectClass}
          value={bookletTypeId}
          onChange={(e) => setBookletTypeId(e.target.value)}
          disabled={!periodId || filteredTypes.length === 0}
        >
          <option value="">Seleccione</option>
          {filteredTypes.map((bt) => (
            <option key={bt.id} value={bt.id}>
              {bt.name}
            </option>
          ))}
        </select>
        {periodId && filteredTypes.length === 0 && (
          <p className="text-muted-foreground text-xs">
            Pídale al admin que configure tipos para esta prueba.
          </p>
        )}
      </FieldBlock>

      <div className="flex items-center gap-2">
        <SubmitButton label={submitLabel} />
      </div>
      {state.error ? (
        <p className="text-destructive w-full text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

const selectClass =
  "border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none";

function FieldBlock({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-muted-foreground block text-xs font-medium">
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
