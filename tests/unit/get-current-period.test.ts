import { describe, expect, it } from "vitest";

import { GetCurrentPeriod } from "@/modules/academic/application/periods";
import type {
  AcademicYear,
  AcademicYearRepository,
  CreatePeriodData,
  Period,
  PeriodRepository,
  UpdatePeriodData,
} from "@/modules/academic/domain/types";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";

/**
 * `GetCurrentPeriod` — resolución de la PRUEBA ACTUAL (nov 2026).
 *
 * El módulo de revisión del coordinador y "Mis formulaciones" filtran por
 * la prueba vigente. La marca `Period.isCurrent` es POR AÑO ACADÉMICO
 * (una por año), así que la resolución tiene que desempatar:
 *   1. la actual del año académico actual;
 *   2. si ese año no tiene ninguna, la actual del año más reciente que
 *      tenga una;
 *   3. si ninguna está marcada, `null` (el caller no filtra).
 */

const leader: AuthenticatedUser = {
  userId: "u-leader",
  institutionId: "inst1",
  roles: ["ECU_LIDER"],
};

function year(id: string, value: number, isCurrent = false): AcademicYear {
  return {
    id,
    institutionId: "inst1",
    year: value,
    startDate: new Date(`${value}-01-01`),
    endDate: new Date(`${value}-12-31`),
    isCurrent,
  };
}

function period(
  id: string,
  name: string,
  academicYearId: string,
  order: number,
  isCurrent = false,
): Period {
  return {
    id,
    institutionId: "inst1",
    academicYearId,
    name,
    order,
    startDate: new Date("2026-01-01"),
    endDate: new Date("2026-12-31"),
    isCurrent,
  };
}

class FakeYears implements AcademicYearRepository {
  constructor(private readonly items: AcademicYear[]) {}
  async findAll(): Promise<AcademicYear[]> {
    return this.items;
  }
  async findById(_i: string, id: string): Promise<AcademicYear | null> {
    return this.items.find((y) => y.id === id) ?? null;
  }
  async findByYear(_i: string, value: number): Promise<AcademicYear | null> {
    return this.items.find((y) => y.year === value) ?? null;
  }
  async create(): Promise<AcademicYear> {
    throw new Error("no usado");
  }
  async setCurrent(): Promise<void> {
    throw new Error("no usado");
  }
  async findCurrent(): Promise<AcademicYear | null> {
    return this.items.find((y) => y.isCurrent) ?? null;
  }
}

class FakePeriods implements PeriodRepository {
  constructor(private readonly items: Period[]) {}
  async findAll(): Promise<Period[]> {
    return this.items;
  }
  async findById(_i: string, id: string): Promise<Period | null> {
    return this.items.find((p) => p.id === id) ?? null;
  }
  async findByName(_i: string, name: string): Promise<Period | null> {
    return this.items.find((p) => p.name === name) ?? null;
  }
  async create(_i: string, _d: CreatePeriodData): Promise<Period> {
    throw new Error("no usado");
  }
  async update(_i: string, _id: string, _d: UpdatePeriodData): Promise<Period | null> {
    throw new Error("no usado");
  }
  async delete(): Promise<void> {
    throw new Error("no usado");
  }
  async setCurrent(): Promise<void> {
    throw new Error("no usado");
  }
  async findCurrent(_i: string, academicYearId: string): Promise<Period | null> {
    return this.items.find((p) => p.academicYearId === academicYearId && p.isCurrent) ?? null;
  }
}

describe("GetCurrentPeriod — prueba actual", () => {
  it("devuelve la actual del año académico actual", async () => {
    const years = new FakeYears([year("ay-2025", 2025, true), year("ay-2026", 2026)]);
    const periods = new FakePeriods([
      period("p-2025-2", "2025-2", "ay-2025", 2, true),
      period("p-2026-2", "2026-2", "ay-2026", 2, true),
    ]);
    const res = await new GetCurrentPeriod(periods, years).execute({ actor: leader });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value?.id).toBe("p-2025-2");
  });

  it("si el año actual no tiene prueba marcada, cae a la del año más reciente", async () => {
    const years = new FakeYears([year("ay-2025", 2025), year("ay-2026", 2026, true)]);
    const periods = new FakePeriods([
      period("p-2025-2", "2025-2", "ay-2025", 2, true),
      period("p-2026-1", "2026-1", "ay-2026", 1, false),
    ]);
    const res = await new GetCurrentPeriod(periods, years).execute({ actor: leader });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value?.id).toBe("p-2025-2");
  });

  it("con varias pruebas marcadas en distintos años gana la del año más reciente", async () => {
    const years = new FakeYears([
      year("ay-2025", 2025),
      year("ay-2026", 2026),
      year("ay-2027", 2027),
    ]);
    const periods = new FakePeriods([
      period("p-2025-2", "2025-2", "ay-2025", 2, true),
      period("p-2027-1", "2027-1", "ay-2027", 1, true),
      period("p-2026-2", "2026-2", "ay-2026", 2, true),
    ]);
    const res = await new GetCurrentPeriod(periods, years).execute({ actor: leader });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value?.id).toBe("p-2027-1");
  });

  it("devuelve null si ninguna prueba está marcada", async () => {
    const years = new FakeYears([year("ay-2026", 2026, true)]);
    const periods = new FakePeriods([period("p-2026-2", "2026-2", "ay-2026", 2, false)]);
    const res = await new GetCurrentPeriod(periods, years).execute({ actor: leader });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBeNull();
  });

  it("devuelve null si la institución no tiene años ni periodos", async () => {
    const res = await new GetCurrentPeriod(new FakePeriods([]), new FakeYears([])).execute({
      actor: leader,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBeNull();
  });

  it("rechaza a un usuario sin roles de la institución", async () => {
    const outsider: AuthenticatedUser = {
      userId: "u-otro",
      institutionId: "inst2",
      roles: [],
    };
    const res = await new GetCurrentPeriod(new FakePeriods([]), new FakeYears([])).execute({
      actor: outsider,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("FORBIDDEN");
  });
});
