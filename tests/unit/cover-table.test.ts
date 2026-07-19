import { describe, expect, it } from "vitest";
import { computeCoverTable, formatDuration } from "@/modules/bundles/domain/cover-table";
import type { BundleItemDetail } from "@/modules/bundles/domain/bundle";

function item(
  partial: Partial<BundleItemDetail> & {
    subjectName: string;
    parentSubjectName: string | null;
    subjectIsArea?: boolean;
    totalQuestions: number;
  },
): BundleItemDetail {
  return {
    id: partial.id ?? `item-${Math.random()}`,
    bundleId: partial.bundleId ?? "b-1",
    evaluationId: partial.evaluationId ?? `ev-${Math.random()}`,
    order: partial.order ?? 1,
    evaluationTitle: partial.evaluationTitle ?? "T",
    evaluationStatus: partial.evaluationStatus ?? "APPROVED",
    totalQuestions: partial.totalQuestions,
    durationMinutes: partial.durationMinutes ?? null,
    subjectName: partial.subjectName,
    subjectIsArea: partial.subjectIsArea ?? false,
    parentSubjectId: partial.parentSubjectId ?? null,
    parentSubjectName: partial.parentSubjectName,
  };
}

describe("computeCoverTable — agrupa por parent subject", () => {
  it("devuelve tabla vacía sin items", () => {
    const t = computeCoverTable([]);
    expect(t.areas).toEqual([]);
    expect(t.totalQuestions).toBe(0);
    expect(t.totalMinutes).toBe(0);
    expect(t.totalEvaluations).toBe(0);
  });

  it("agrupa items por parent subject (Ciencias Naturales = Bio+Fis+Qui)", () => {
    const items: BundleItemDetail[] = [
      item({
        subjectName: "Biología",
        parentSubjectName: "Ciencias Naturales",
        totalQuestions: 33,
      }),
      item({ subjectName: "Física", parentSubjectName: "Ciencias Naturales", totalQuestions: 11 }),
      item({ subjectName: "Química", parentSubjectName: "Ciencias Naturales", totalQuestions: 11 }),
    ];
    const t = computeCoverTable(items);
    expect(t.areas).toHaveLength(1);
    expect(t.areas[0]!.name).toBe("Ciencias Naturales");
    expect(t.areas[0]!.subjects.map((s) => s.name).sort()).toEqual([
      "Biología",
      "Física",
      "Química",
    ]);
    expect(t.areas[0]!.totalQuestions).toBe(55);
    // Sprint 7: area.totalMinutes = suma de los subject.minutes.
    // Bio: round(33*2.5)=83; Fis: round(11*2.5)=28; Qui: round(11*2.5)=28 → 139.
    // (Antes era round(55*2.5)=138 — rounding-level distinto. Este es el nuevo
    // comportamiento: totalMinutes interno-consistente con subjects.)
    expect(t.areas[0]!.totalMinutes).toBe(139);
    expect(t.totalQuestions).toBe(55);
    expect(t.totalMinutes).toBe(139);
    expect(t.totalEvaluations).toBe(3);
  });

  it("suma questions cuando hay 2 items del mismo subject (ej: 2 parciales de Bio)", () => {
    const items: BundleItemDetail[] = [
      item({
        subjectName: "Biología",
        parentSubjectName: "Ciencias Naturales",
        totalQuestions: 10,
      }),
      item({
        subjectName: "Biología",
        parentSubjectName: "Ciencias Naturales",
        totalQuestions: 15,
      }),
    ];
    const t = computeCoverTable(items);
    expect(t.areas[0]!.subjects[0]!.questions).toBe(25);
    expect(t.areas[0]!.totalQuestions).toBe(25);
  });

  it("subject sin parent aparece como área propia", () => {
    const items: BundleItemDetail[] = [
      item({ subjectName: "Inglés", parentSubjectName: null, totalQuestions: 20 }),
    ];
    const t = computeCoverTable(items);
    expect(t.areas).toHaveLength(1);
    expect(t.areas[0]!.name).toBe("Inglés");
    expect(t.areas[0]!.subjects[0]!.name).toBe("Inglés");
    expect(t.areas[0]!.subjects[0]!.questions).toBe(20);
  });

  it("ignora items con subjectIsArea=true (defensa contra data inconsistente)", () => {
    const items: BundleItemDetail[] = [
      item({
        subjectName: "Ciencias Naturales",
        parentSubjectName: null,
        subjectIsArea: true,
        totalQuestions: 100,
      }),
      item({
        subjectName: "Biología",
        parentSubjectName: "Ciencias Naturales",
        totalQuestions: 30,
      }),
    ];
    const t = computeCoverTable(items);
    expect(t.areas).toHaveLength(1);
    expect(t.areas[0]!.name).toBe("Ciencias Naturales");
    expect(t.areas[0]!.totalQuestions).toBe(30);
  });

  it("ordena áreas y subjects alfabéticamente", () => {
    const items: BundleItemDetail[] = [
      item({
        subjectName: "Zoológico",
        parentSubjectName: "Ciencias Naturales",
        totalQuestions: 5,
      }),
      item({
        subjectName: "Astronomía",
        parentSubjectName: "Ciencias Naturales",
        totalQuestions: 5,
      }),
      item({ subjectName: "Inglés", parentSubjectName: null, totalQuestions: 10 }),
    ];
    const t = computeCoverTable(items);
    expect(t.areas.map((a) => a.name)).toEqual(["Ciencias Naturales", "Inglés"]);
    expect(t.areas[0]!.subjects.map((s) => s.name)).toEqual(["Astronomía", "Zoológico"]);
  });

  it("acepta minutesPerQuestion custom (ej: 3 min por pregunta)", () => {
    const items: BundleItemDetail[] = [
      item({ subjectName: "Matemáticas", parentSubjectName: null, totalQuestions: 20 }),
    ];
    const t = computeCoverTable(items, 3);
    expect(t.areas[0]!.totalMinutes).toBe(60);
    expect(t.totalMinutes).toBe(60);
  });
});

describe("computeCoverTable — Sprint 7: durationMinutes explícito", () => {
  it("usa durationMinutes del item cuando está seteado, no el cálculo heurístico", () => {
    const items: BundleItemDetail[] = [
      // 33 preguntas pero el docente capturó 90 min explícitamente.
      item({
        subjectName: "Biología",
        parentSubjectName: "Ciencias Naturales",
        totalQuestions: 33,
        durationMinutes: 90,
      }),
    ];
    const t = computeCoverTable(items);
    expect(t.areas[0]!.subjects[0]!.minutes).toBe(90);
    expect(t.areas[0]!.totalMinutes).toBe(90);
    expect(t.totalMinutes).toBe(90);
  });

  it("mezcla items con y sin durationMinutes: cada uno usa su valor real", () => {
    const items: BundleItemDetail[] = [
      // Item A: 20 preg con duración explícita de 45 min.
      item({
        subjectName: "Biología",
        parentSubjectName: "Ciencias Naturales",
        totalQuestions: 20,
        durationMinutes: 45,
      }),
      // Item B: 10 preg sin duración explícita → cae a round(10*2.5)=25.
      item({
        subjectName: "Física",
        parentSubjectName: "Ciencias Naturales",
        totalQuestions: 10,
      }),
    ];
    const t = computeCoverTable(items);
    expect(t.areas[0]!.subjects.find((s) => s.name === "Biología")!.minutes).toBe(45);
    expect(t.areas[0]!.subjects.find((s) => s.name === "Física")!.minutes).toBe(25);
    // Total: 45 + 25 = 70 (consistente con la suma de subjects).
    expect(t.areas[0]!.totalMinutes).toBe(70);
    expect(t.totalMinutes).toBe(70);
  });

  it("durationMinutes=null en todos los items = comportamiento legacy (heurístico)", () => {
    const items: BundleItemDetail[] = [
      item({
        subjectName: "Biología",
        parentSubjectName: "Ciencias Naturales",
        totalQuestions: 10,
      }),
    ];
    // Sin durationMinutes y minutesPerQuestion=2 → round(10*2)=20.
    const t = computeCoverTable(items, 2);
    expect(t.areas[0]!.subjects[0]!.minutes).toBe(20);
    expect(t.totalMinutes).toBe(20);
  });
});

describe("formatDuration", () => {
  it("< 60 min → solo minutos", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(59)).toBe("59 min");
  });
  it("≥ 60 min → horas + minutos", () => {
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(75)).toBe("1h 15min");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(275)).toBe("4h 35min"); // caso del ejemplo real
  });
});
