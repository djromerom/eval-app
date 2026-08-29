"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  createEvaluationRuleAction,
  deleteEvaluationRuleAction,
  updateEvaluationRuleAction,
} from "./actions";

export interface EvaluationRuleRow {
  id: string;
  courseId: string;
  subjectId: string;
  bookletTypeId: string | null;
  exactQuestions: number;
}

interface CatalogOption {
  id: string;
  name: string;
}

/**
 * Panel de gestión de reglas de conteo exacto por
 * (Prueba × Grado × Asignatura × Tipo de cuadernillo).
 *
 * Sprint ago 2026 — `src/modules/evaluation-rules/`. Cuando hay regla
 * activa para una evaluación, el editor unificado muestra un banner soft
 * con el delta y `ChangeEvaluationStatus` / `AddQuestion` / `DeleteQuestion`
 * / `DuplicateQuestion` bloquean transiciones que rompan el conteo exacto.
 *
 * UX espejo de `BookletTypesManager`:
 * - Lista existente con botón eliminar (window.confirm).
 * - Form inline para crear / editar.
 * - Lockout anti-doble-submit con useTransition.
 *
 * Filtrado dinámico: cuando el admin elige un grado en el `<select>` de
 * curso, el dropdown de asignaturas se reduce a las que están habilitadas
 * para ese grado vía `CourseSubject` (evita proponer, p. ej., Tecnología
 * para 11° si el colegio no la oferta en ese grado). El mapa
 * `subjectsByCourse` llega server-side desde la página del drawer; si para
 * un curso no hay mapeo, hacemos fallback al listado completo (defensa).
 */
export function EvaluationRulesManager({
  periodId,
  initialRules,
  courses,
  subjects,
  subjectsByCourse,
  bookletTypes,
}: {
  periodId: string;
  initialRules: EvaluationRuleRow[];
  courses: CatalogOption[];
  subjects: CatalogOption[];
  /** Mapa courseId → subjectIds habilitados para ese grado. */
  subjectsByCourse: Record<string, string[]>;
  bookletTypes: CatalogOption[];
}) {
  const [rules, setRules] = useState<EvaluationRuleRow[]>(initialRules);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [selectedBookletTypeId, setSelectedBookletTypeId] = useState<string>("");
  // Ref al input de conteo exacto para enfocarlo tras crear la regla y
  // que el docente pueda tipear el siguiente número sin tocar el mouse.
  const exactInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    // `e.currentTarget` se vuelve null cuando React recicla el SyntheticEvent
    // después de que el handler termina. Como `startTransition` corre el callback
    // async después, capturamos la referencia al form acá.
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const r = await createEvaluationRuleAction(periodId, formData);
      if (!r.ok) {
        setError({ message: r.error ?? "Error", field: r.field });
        return;
      }
      // Optimista: append local de la nueva regla. Reconstruimos la fila
      // desde el FormData porque el server solo devuelve el id. Esto evita
      // el `window.location.reload()` que tiraba al docente al top del
      // drawer (matando el flow de carga consecutiva de varias reglas).
      const newRule: EvaluationRuleRow = {
        id: r.id ?? `tmp-${Date.now()}`,
        courseId: String(formData.get("courseId") ?? ""),
        subjectId: String(formData.get("subjectId") ?? ""),
        bookletTypeId: String(formData.get("bookletTypeId") ?? "") || null,
        exactQuestions: Number(formData.get("exactQuestions") ?? 0),
      };
      setRules((prev) => [...prev, newRule]);

      // Limpiamos SOLO el conteo exacto y reseteamos el booklet type (si
      // quedó algo en el DOM por default). Los selects controlados de curso
      // y asignatura mantienen su valor → el docente puede tipear el
      // siguiente conteo y volver a submitear sin reseleccionar nada.
      const exactInput = form.elements.namedItem("exactQuestions");
      if (exactInput instanceof HTMLInputElement) exactInput.value = "";
      setSelectedBookletTypeId("");

      // Devolvemos foco al input y scroll suave al form para que el docente
      // pueda tipear el siguiente número sin tocar el mouse.
      exactInputRef.current?.focus();
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const handleDelete = (id: string, label: string) => {
    if (
      !window.confirm(
        `¿Eliminar la regla "${label}"? Las evaluaciones que estén en DRAFT y no la cumplan podrán crearse/editarse libremente.`,
      )
    ) {
      return;
    }
    setDeletingId(id);
    startTransition(async () => {
      const r = await deleteEvaluationRuleAction(periodId, id);
      setDeletingId(null);
      if (!r.ok) {
        setError({ message: r.error ?? "Error" });
        return;
      }
      setRules((prev) => prev.filter((rule) => rule.id !== id));
    });
  };

  const handleEditExact = (rule: EvaluationRuleRow) => {
    const next = window.prompt(
      `Conteo exacto para esta regla (1–500):`,
      String(rule.exactQuestions),
    );
    if (next === null) return;
    const n = Number(next);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      setError({ message: "El conteo exacto debe ser un entero entre 1 y 500." });
      return;
    }
    const fd = new FormData();
    fd.set("exactQuestions", String(n));
    setError(null);
    startTransition(async () => {
      const r = await updateEvaluationRuleAction(periodId, rule.id, fd);
      if (!r.ok) {
        setError({ message: r.error ?? "Error" });
        return;
      }
      setRules((prev) => prev.map((rr) => (rr.id === rule.id ? { ...rr, exactQuestions: n } : rr)));
    });
  };

  const labelFor = (rule: EvaluationRuleRow) => {
    const c = courses.find((x) => x.id === rule.courseId)?.name ?? "—";
    const s = subjects.find((x) => x.id === rule.subjectId)?.name ?? "—";
    const bt = rule.bookletTypeId
      ? (bookletTypes.find((x) => x.id === rule.bookletTypeId)?.name ?? "—")
      : "—";
    return `${c} · ${s} · ${bt}`;
  };

  // Asignaturas filtradas según el grado seleccionado. Si el grado no tiene
  // mapeo, mostramos todas (fallback defensivo — puede pasar con cursos sin
  // asignaturas habilitadas explícitamente).
  const allowedSubjectIds = selectedCourseId ? subjectsByCourse[selectedCourseId] : undefined;
  const filteredSubjects =
    allowedSubjectIds && allowedSubjectIds.length > 0
      ? subjects.filter((s) => allowedSubjectIds.includes(s.id))
      : subjects;

  const handleCourseChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextCourse = e.target.value;
    setSelectedCourseId(nextCourse);
    // Si la asignatura ya elegida no está habilitada para el nuevo grado,
    // la limpiamos para evitar que el form la envíe silenciosamente.
    if (
      selectedSubjectId &&
      nextCourse &&
      subjectsByCourse[nextCourse] &&
      !subjectsByCourse[nextCourse]!.includes(selectedSubjectId)
    ) {
      setSelectedSubjectId("");
    }
  };

  return (
    <section className="mt-8 border-t pt-6">
      <header className="mb-4 space-y-1">
        <h2 className="font-display text-base font-bold">Reglas de conteo</h2>
        <p className="text-muted-foreground text-xs">
          Define el número exacto de preguntas que deben tener las evaluaciones de esta prueba según
          el grado, la asignatura y el tipo de cuadernillo. Sin regla = modo libre.
        </p>
      </header>

      <form onSubmit={handleCreate} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="rule-course" className="mb-1 block text-sm font-medium">
              Grado
            </label>
            <select
              id="rule-course"
              name="courseId"
              required
              disabled={isPending || courses.length === 0}
              className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              value={selectedCourseId}
              onChange={handleCourseChange}
            >
              <option value="" disabled>
                Selecciona…
              </option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rule-subject" className="mb-1 block text-sm font-medium">
              Asignatura
            </label>
            <select
              id="rule-subject"
              name="subjectId"
              required
              disabled={isPending || subjects.length === 0}
              className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
            >
              <option value="" disabled>
                {selectedCourseId ? "Selecciona…" : "Elegí un grado primero"}
              </option>
              {filteredSubjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="rule-booklet-type" className="mb-1 block text-sm font-medium">
              Tipo de cuadernillo
            </label>
            <select
              id="rule-booklet-type"
              name="bookletTypeId"
              required
              disabled={isPending}
              className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
              value={selectedBookletTypeId}
              onChange={(e) => setSelectedBookletTypeId(e.target.value)}
            >
              <option value="" disabled>
                Selecciona…
              </option>
              {bookletTypes.map((bt) => (
                <option key={bt.id} value={bt.id}>
                  {bt.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rule-exact" className="mb-1 block text-sm font-medium">
              Conteo exacto
            </label>
            <Input
              id="rule-exact"
              name="exactQuestions"
              type="number"
              min={1}
              max={500}
              step={1}
              required
              disabled={isPending}
              placeholder="50"
              ref={exactInputRef}
            />
          </div>
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={isPending || courses.length === 0 || subjects.length === 0}
          className="w-full"
        >
          {isPending ? "Agregando…" : "Agregar regla"}
        </Button>
      </form>

      {rules.length > 0 ? (
        <ul className="mt-5 space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center justify-between gap-2 rounded-md border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{labelFor(rule)}</p>
                <p className="text-muted-foreground text-xs">
                  Exige exactamente {rule.exactQuestions} preguntas
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleEditExact(rule)}
                  disabled={isPending}
                  aria-label={`Editar conteo de ${labelFor(rule)}`}
                >
                  Editar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleDelete(rule.id, labelFor(rule))}
                  disabled={isPending || deletingId === rule.id}
                  aria-label={`Eliminar regla ${labelFor(rule)}`}
                >
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-5 text-xs">
          No hay reglas para esta prueba. Agregá una para exigir un conteo exacto de preguntas en
          las evaluaciones que coincidan con grado, asignatura y tipo de cuadernillo.
        </p>
      )}

      {error && (
        <p className="text-destructive mt-3 text-xs" role="alert">
          {error.message}
        </p>
      )}
    </section>
  );
}
