/**
 * Función pura: computa la tabla de áreas de la portada del bundle
 * agrupando las questions de los items por `subject.parentSubject`
 * (jerarquía Subject ⊃ Biología/Física/Química).
 *
 * Ver docs/compendios.md §"Portada del bundle" + decisión 10
 * (Subject.parentSubjectId agregado) + Sprint 7 (durationMinutes).
 */
import { DEFAULT_MINUTES_PER_QUESTION } from "./bundle-rules";
import type { BundleItemDetail } from "./bundle";

export interface CoverArea {
  /** Nombre del área raíz (parent subject) si el subject hoja tiene parent.
   *  Si el subject es raíz, este nombre es el del subject mismo. */
  name: string;
  /** Lista de subjects hoja dentro del área (para sub-fila en la portada). */
  subjects: Array<{
    name: string;
    questions: number;
    minutes: number;
  }>;
  /** Suma de questions de todos los subjects del área. */
  totalQuestions: number;
  /** Suma de los minutos de los subjects del área (cada subject lleva
   *  su propio `minutes`, capturado en Settings o calculado si null). */
  totalMinutes: number;
}

export interface CoverTable {
  areas: CoverArea[];
  totalQuestions: number;
  totalMinutes: number;
  /** Total de items en el bundle. */
  totalEvaluations: number;
}

/**
 * Computa la tabla de áreas a partir de los items del bundle.
 *
 * Reglas:
 *   - Cada item es un subject hoja (no puede ser un área).
 *   - Si el subject tiene parentSubject, se agrupa bajo el nombre del parent.
 *   - Si el subject NO tiene parentSubject (es raíz), aparece como área
 *     propia con un solo subject hijo (él mismo).
 *   - Las áreas se ordenan por nombre alfabético para consistencia visual.
 *   - Los subjects dentro de cada área también se ordenan alfabéticamente.
 *   - Las áreas sin items (subject hoja sin questions) se ignoran.
 *
 * Duración estimada (Sprint 7):
 *   - Si el item tiene `durationMinutes` capturado por el docente en Settings,
 *     se usa ESE valor para los minutos del subject/área y del total.
 *   - Si no, cae al cálculo viejo: `totalQuestions * minutesPerQuestion`
 *     (con `minutesPerQuestion = DEFAULT_MINUTES_PER_QUESTION` por defecto).
 *   - Esto preserva el comportamiento para evaluations existentes: el
 *     docente no se ve forzado a capturar la duración al adoptarse el Sprint 7.
 */
export function computeCoverTable(
  items: BundleItemDetail[],
  minutesPerQuestion: number = DEFAULT_MINUTES_PER_QUESTION,
): CoverTable {
  if (items.length === 0) {
    return {
      areas: [],
      totalQuestions: 0,
      totalMinutes: 0,
      totalEvaluations: 0,
    };
  }

  const byArea = new Map<
    string,
    {
      areaName: string;
      subjects: Map<string, { name: string; questions: number; minutes: number }>;
    }
  >();

  for (const item of items) {
    // subjectIsArea=true no debería aparecer (los items son subjects hoja).
    // Si aparece por inconsistencia de datos, lo saltamos con un warning.
    if (item.subjectIsArea) continue;

    const areaName = item.parentSubjectName ?? item.subjectName ?? "Sin área";
    const subjectName = item.subjectName ?? "Sin asignatura";
    const questions = item.totalQuestions;
    // Sprint 7: si el docente capturó duración explícita por evaluation,
    // gana sobre la heurística `questions * minutesPerQuestion`.
    const minutes = item.durationMinutes ?? Math.round(questions * minutesPerQuestion);

    if (!byArea.has(areaName)) {
      byArea.set(areaName, { areaName, subjects: new Map() });
    }
    const area = byArea.get(areaName)!;
    // Si dos items comparten el mismo subject (ej: dos parciales de Bio),
    // sumamos questions y minutos por separado. Importante: NO se mezclan
    // preguntas+minutos heterogéneos — para mantener coherencia con el PDF
    // de referencia real (cada evaluación con su tiempo).
    const existing = area.subjects.get(subjectName);
    if (existing) {
      existing.questions += questions;
      existing.minutes += minutes;
    } else {
      area.subjects.set(subjectName, { name: subjectName, questions, minutes });
    }
  }

  const areas: CoverArea[] = Array.from(byArea.values())
    .sort((a, b) => a.areaName.localeCompare(b.areaName, "es"))
    .map((area) => {
      const subjects = Array.from(area.subjects.values())
        .sort((a, b) => a.name.localeCompare(b.name, "es"))
        .map((s) => ({
          name: s.name,
          questions: s.questions,
          minutes: s.minutes,
        }));
      const totalQuestions = subjects.reduce((acc, s) => acc + s.questions, 0);
      const totalMinutes = subjects.reduce((acc, s) => acc + s.minutes, 0);
      return {
        name: area.areaName,
        subjects,
        totalQuestions,
        totalMinutes,
      };
    });

  const totalQuestions = areas.reduce((acc, a) => acc + a.totalQuestions, 0);
  const totalMinutes = areas.reduce((acc, a) => acc + a.totalMinutes, 0);
  return {
    areas,
    totalQuestions,
    totalMinutes,
    totalEvaluations: items.length,
  };
}

/**
 * Formatea minutos como "Xh Ymin" para mostrar en la portada.
 * - < 60 min: "Ymin"
 * - >= 60 min: "Xh Ymin" (Y puede ser 0)
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}
