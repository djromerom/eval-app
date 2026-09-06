"use client";

import { useState } from "react";
import { Calendar, ChevronRight, MoreHorizontal, Pencil, Plus, Star } from "lucide-react";
import Link from "next/link";
import type { AcademicYear } from "@/modules/academic/domain/types";
import { CourseActions } from "./course-actions";

export interface PeriodRow {
  id: string;
  name: string;
  order: number;
  formattedRange: string;
  /** Si esta prueba es la "actual" de su año académico (ago 2026).
   *  Renderiza un badge discreto al lado del nombre. */
  isCurrent: boolean;
}

export interface CourseRow {
  id: string;
  name: string;
  code: string;
  groups: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  availableSubjects: { value: string; label: string }[];
}

export interface YearCardProps {
  year: AcademicYear;
  /** Estado inicial: por defecto `true` para el año marcado como `isCurrent`
   *  (o el más reciente si ninguno está marcado), `false` para el resto.
   *  El usuario puede toggle desde el header (que es un botón completo). */
  defaultExpanded: boolean;
  periodCount: number;
  courseCount: number;
  formattedRange: string;
  /** Solo el nombre del mes en formato "ene 15" / "nov 30" — se usa en el
   *  header colapsado para que ocupe una sola línea. */
  shortRange: string;
  periods: PeriodRow[];
  courses: CourseRow[];
}

/**
 * Card por año académico. Colapsable: cada card guarda su propio estado de
 * expansión.
 *
 * Patrón UX: el header COMPLETO es un botón (no solo el chevron). Cuando
 * está colapsado se ve compacto (1 línea) — sin botones extra. Al expandir
 * aparecen los botones de acción Agregar periodo/curso/menu y el detalle
 * (2 columnas Periodos/Cursos).
 *
 * Las filas de periodo incluyen un link "Editar" que abre el drawer
 * `/admin/academic/periods/[id]/edit` (Fase 11).
 */
export function YearCard({
  year,
  defaultExpanded,
  periodCount,
  courseCount,
  formattedRange,
  shortRange,
  periods,
  courses,
}: YearCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <section className="bg-card rounded-2xl border">
      {/* Header — cuando está colapsado es un <button> completo. */}
      {!isExpanded ? (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          aria-expanded={false}
          aria-label={`Expandir año ${year.year}`}
          className="hover:bg-muted/30 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors"
        >
          <div className="bg-primary/10 text-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold">
            <Calendar className="h-3.5 w-3.5" />
            {year.year}
          </div>
          {year.isCurrent ? (
            <span className="bg-primary text-primary-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tracking-wide uppercase">
              Actual
            </span>
          ) : null}
          <div className="flex-1">
            <p className="text-foreground text-sm font-bold">Año académico {year.year}</p>
            <p className="text-muted-foreground text-xs">
              {shortRange} · {periodCount} {periodCount === 1 ? "prueba" : "pruebas"} ·{" "}
              {courseCount} {courseCount === 1 ? "grado" : "grados"}
            </p>
          </div>
          <ChevronRight className="text-muted-foreground h-5 w-5" />
        </button>
      ) : (
        <>
          <header className="bg-primary/5 flex items-center gap-3 rounded-t-2xl p-4">
            <div className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold">
              <Calendar className="h-3.5 w-3.5" />
              {year.year}
            </div>
            {year.isCurrent ? (
              <span className="bg-primary text-primary-foreground inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tracking-wide uppercase">
                Actual
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              aria-expanded={true}
              aria-label={`Contraer año ${year.year}`}
              className="flex-1 text-left"
            >
              <p className="text-foreground text-sm font-bold">Año académico {year.year}</p>
              <p className="text-muted-foreground text-xs">{formattedRange}</p>
            </button>

            <div className="flex items-center gap-2">
              <AddButton label="Agregar prueba" />
              <AddButton label="Agregar grado" />
              {!year.isCurrent ? (
                <Link
                  href={`/admin/academic/years/${year.id}/set-current`}
                  aria-label={`Marcar ${year.year} como año académico actual`}
                  className="border-input bg-background hover:bg-muted inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"
                >
                  <Star className="text-muted-foreground h-3.5 w-3.5" />
                  Marcar como actual
                </Link>
              ) : null}
              <button
                type="button"
                aria-label="Más acciones"
                className="border-input bg-background inline-flex h-9 w-9 items-center justify-center rounded-lg border"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="text-muted-foreground h-4 w-4" />
              </button>
            </div>
          </header>

          <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-2">
            {/* Columna Periodos */}
            <div className="bg-muted/40 space-y-3 rounded-xl p-4">
              <ColumnHeader title="Pruebas" count={periods.length} />
              {periods.length === 0 ? (
                <p className="text-muted-foreground text-xs">Sin pruebas configuradas.</p>
              ) : (
                <ul className="space-y-2">
                  {periods.map((p) => (
                    <li
                      key={p.id}
                      className="bg-card flex items-center gap-2 rounded-lg border p-2.5"
                    >
                      <span className="bg-primary/10 text-primary inline-flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold">
                        {p.order}
                      </span>
                      <div className="flex-1">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          {p.name}
                          {p.isCurrent && (
                            <span className="bg-primary/15 text-primary inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase">
                              Actual
                            </span>
                          )}
                        </p>
                        <p className="text-muted-foreground text-xs">{p.formattedRange}</p>
                      </div>
                      <Link
                        href={`/admin/academic/periods/${p.id}/edit`}
                        aria-label={`Editar ${p.name}`}
                        className="hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md border"
                      >
                        <Pencil className="text-muted-foreground h-3.5 w-3.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Columna Grados */}
            <div className="bg-muted/40 space-y-3 rounded-xl p-4">
              <ColumnHeader title="Grados" count={courses.length} />
              {courses.length === 0 ? (
                <p className="text-muted-foreground text-xs">Sin grados configurados.</p>
              ) : (
                <ul className="space-y-2">
                  {courses.map((c) => (
                    <li key={c.id} className="bg-card rounded-lg border p-3">
                      <CourseActions
                        courseId={c.id}
                        courseName={c.name}
                        courseCode={c.code}
                        groups={c.groups}
                        subjects={c.subjects}
                        availableSubjects={c.availableSubjects}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function AddButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="border-input bg-background inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold"
    >
      <Plus className="text-muted-foreground h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function ColumnHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="text-foreground text-sm font-semibold">{title}</p>
      <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-bold">
        {count}
      </span>
    </div>
  );
}
