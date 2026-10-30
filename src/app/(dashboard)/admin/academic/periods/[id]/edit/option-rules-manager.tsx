"use client";

import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { createOptionRuleAction, deleteOptionRuleAction, updateOptionRuleAction } from "./actions";

export interface OptionRuleRow {
  id: string;
  courseId: string;
  subjectId: string;
  minOptions: number;
  maxOptions: number;
}

interface CatalogOption {
  id: string;
  name: string;
}

/**
 * Panel de gestión de reglas de OPCIONES DE RESPUESTA por
 * (Prueba × Grado × Asignatura).
 *
 * Sprint oct 2026 — `src/modules/option-rules/`. Sin regla, las preguntas de
 * esa prueba deben tener EXACTAMENTE 4 opciones (default estricto). La regla
 * abre el rango: un mínimo y un máximo configurables entre 2 y 8.
 *
 * El GRADO es parte de la clave: la excepción es para un año y un grado
 * concretos. Por eso primero se elige el grado y después la asignatura (que
 * se filtra por las asignaturas habilitadas en ese grado).
 *
 * UX espejo de `EvaluationRulesManager` (panel de reglas de conteo):
 * - Lista existente con botones editar / eliminar (window.confirm).
 * - Form inline para crear.
 * - Lockout anti-doble-submit con useTransition.
 */
export function OptionRulesManager({
  periodId,
  initialRules,
  courses,
  subjects,
  subjectsByCourse,
}: {
  periodId: string;
  initialRules: OptionRuleRow[];
  courses: CatalogOption[];
  subjects: CatalogOption[];
  subjectsByCourse: Record<string, string[]>;
}) {
  const [rules, setRules] = useState<OptionRuleRow[]>(initialRules);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [minOptions, setMinOptions] = useState<string>("");
  const [maxOptions, setMaxOptions] = useState<string>("");
  // Ref al input de mínimo para enfocarlo tras crear la regla y que el
  // docente pueda tipear la siguiente sin tocar el mouse.
  const minInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const r = await createOptionRuleAction(periodId, formData);
      if (!r.ok) {
        setError({ message: r.error ?? "Error", field: r.field });
        return;
      }
      // Optimista: append local de la nueva regla (el server ya revalidó la
      // ruta). Reconstruimos la fila desde el FormData.
      const newRule: OptionRuleRow = {
        id: r.id ?? `tmp-${Date.now()}`,
        courseId: String(formData.get("courseId") ?? ""),
        subjectId: String(formData.get("subjectId") ?? ""),
        minOptions: Number(formData.get("minOptions") ?? 0),
        maxOptions: Number(formData.get("maxOptions") ?? 0),
      };
      setRules((prev) => [...prev, newRule]);

      // Limpiamos SOLO los números; el select de asignatura mantiene su
      // valor → el docente puede seguir con la misma asignatura.
      const minInput = form.elements.namedItem("minOptions");
      if (minInput instanceof HTMLInputElement) minInput.value = "";
      const maxInput = form.elements.namedItem("maxOptions");
      if (maxInput instanceof HTMLInputElement) maxInput.value = "";
      setMinOptions("");
      setMaxOptions("");

      minInputRef.current?.focus();
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const handleDelete = (id: string, label: string) => {
    if (!window.confirm(`¿Eliminar la regla de "${label}"?`)) {
      return;
    }
    setDeletingId(id);
    startTransition(async () => {
      const r = await deleteOptionRuleAction(periodId, id);
      setDeletingId(null);
      if (!r.ok) {
        setError({ message: r.error ?? "Error" });
        return;
      }
      setRules((prev) => prev.filter((rule) => rule.id !== id));
    });
  };

  const handleEdit = (rule: OptionRuleRow) => {
    const nextMin = window.prompt(
      `Mínimo de opciones para esta regla (2–8):`,
      String(rule.minOptions),
    );
    if (nextMin === null) return;
    const min = Number(nextMin);
    if (!Number.isInteger(min) || min < 2 || min > 8) {
      setError({ message: "El mínimo debe ser un entero entre 2 y 8." });
      return;
    }
    const nextMax = window.prompt(
      `Máximo de opciones para esta regla (2–8):`,
      String(rule.maxOptions),
    );
    if (nextMax === null) return;
    const max = Number(nextMax);
    if (!Number.isInteger(max) || max < 2 || max > 8) {
      setError({ message: "El máximo debe ser un entero entre 2 y 8." });
      return;
    }
    if (min > max) {
      setError({ message: "El mínimo no puede ser mayor que el máximo." });
      return;
    }
    const fd = new FormData();
    fd.set("minOptions", String(min));
    fd.set("maxOptions", String(max));
    setError(null);
    startTransition(async () => {
      const r = await updateOptionRuleAction(periodId, rule.id, fd);
      if (!r.ok) {
        setError({ message: r.error ?? "Error" });
        return;
      }
      setRules((prev) =>
        prev.map((rr) => (rr.id === rule.id ? { ...rr, minOptions: min, maxOptions: max } : rr)),
      );
    });
  };

  const courseLabelFor = (courseId: string) => courses.find((x) => x.id === courseId)?.name ?? "—";

  const labelFor = (rule: OptionRuleRow) =>
    subjects.find((x) => x.id === rule.subjectId)?.name ?? "—";

  /** Etiqueta completa de la regla: grado + asignatura. */
  const fullLabelFor = (rule: OptionRuleRow) =>
    `${courseLabelFor(rule.courseId)} · ${labelFor(rule)}`;

  const describe = (rule: OptionRuleRow) =>
    rule.minOptions === rule.maxOptions
      ? `Permite exactamente ${rule.minOptions} ${rule.minOptions === 1 ? "opción" : "opciones"}`
      : `Permite entre ${rule.minOptions} y ${rule.maxOptions} opciones`;

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
        <h2 className="font-display text-base font-bold">Reglas de opciones de respuesta</h2>
        <p className="text-muted-foreground text-xs">
          Define cuántas opciones de respuesta pueden tener las preguntas de cada grado y asignatura
          en esta prueba. Sin regla, las preguntas deben tener exactamente 4 opciones.
        </p>
      </header>

      <form onSubmit={handleCreate} className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="option-rule-course" className="mb-1 block text-sm font-medium">
              Grado
            </label>
            <select
              id="option-rule-course"
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
            <label htmlFor="option-rule-subject" className="mb-1 block text-sm font-medium">
              Asignatura
            </label>
            <select
              id="option-rule-subject"
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
            <label htmlFor="option-rule-min" className="mb-1 block text-sm font-medium">
              Mínimo de opciones
            </label>
            <Input
              id="option-rule-min"
              name="minOptions"
              type="number"
              min={2}
              max={8}
              step={1}
              required
              disabled={isPending}
              placeholder="2"
              ref={minInputRef}
              value={minOptions}
              onChange={(e) => setMinOptions(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="option-rule-max" className="mb-1 block text-sm font-medium">
              Máximo de opciones
            </label>
            <Input
              id="option-rule-max"
              name="maxOptions"
              type="number"
              min={2}
              max={8}
              step={1}
              required
              disabled={isPending}
              placeholder="8"
              value={maxOptions}
              onChange={(e) => setMaxOptions(e.target.value)}
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
                <p className="truncate text-sm font-medium">{fullLabelFor(rule)}</p>
                <p className="text-muted-foreground text-xs">{describe(rule)}</p>
              </div>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleEdit(rule)}
                  disabled={isPending}
                  aria-label={`Editar opciones de ${fullLabelFor(rule)}`}
                >
                  Editar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleDelete(rule.id, fullLabelFor(rule))}
                  disabled={isPending || deletingId === rule.id}
                  aria-label={`Eliminar regla de ${fullLabelFor(rule)}`}
                >
                  Eliminar
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground mt-5 text-xs">
          No hay reglas de opciones para esta prueba. Sin regla, las preguntas de cualquier grado y
          asignatura deben tener exactamente 4 opciones.
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
