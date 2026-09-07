import { beforeEach, describe, expect, it } from "vitest";

import {
  CreateBookletType,
  DeleteBookletType,
  ListBookletTypesByInstitution,
  ListBookletTypesByPeriod,
  UpdateBookletType,
} from "@/modules/booklet-types/application/manage-booklet-types";
import type {
  BookletType,
  BookletTypeRepository,
  CreateBookletTypeData,
  UpdateBookletTypeData,
} from "@/modules/booklet-types/domain/booklet-type";
import type { CreatePeriodData, Period, PeriodRepository } from "@/modules/academic/domain/types";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";

// ---------------------------------------------------------------------------
// Actores
// ---------------------------------------------------------------------------

const admin: AuthenticatedUser = {
  userId: "u1",
  institutionId: "inst1",
  roles: ["ECU_MASTER"],
};
const teacher: AuthenticatedUser = {
  userId: "t1",
  institutionId: "inst1",
  roles: ["TEACHER"],
};

// ---------------------------------------------------------------------------
// Fakes (in-memory)
// ---------------------------------------------------------------------------

class InMemoryBookletTypes implements BookletTypeRepository {
  /** @see Map<id, {b, createdAt}> para mantener un orden estable secundario. */
  private byId = new Map<string, BookletType & { createdAt: number }>();
  /** Secuencia monotónica para simular `createdAt`. */
  private seq = 0;

  /** Inyectable para tests específicos. */
  p2002OnCreate = false;

  async findById(institutionId: string, id: string) {
    const b = this.byId.get(id);
    if (!b || b.institutionId !== institutionId) return null;
    const { createdAt: _c, ...rest } = b;
    return rest;
  }

  async listByPeriod(institutionId: string, periodId: string) {
    return Array.from(this.byId.values())
      .filter((b) => b.institutionId === institutionId && b.periodId === periodId)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
      .map(({ createdAt: _c, ...rest }) => rest);
  }

  async listByInstitution(institutionId: string) {
    return Array.from(this.byId.values())
      .filter((b) => b.institutionId === institutionId)
      .sort((a, b) => {
        if (a.periodId !== b.periodId) return a.periodId.localeCompare(b.periodId);
        return a.order - b.order || a.createdAt - b.createdAt;
      })
      .map(({ createdAt: _c, ...rest }) => rest);
  }

  async findByName(institutionId: string, name: string) {
    const trimmed = name.trim().toLowerCase();
    return Array.from(this.byId.values())
      .filter((b) => b.institutionId === institutionId && b.name.trim().toLowerCase() === trimmed)
      .map(({ createdAt: _c, ...rest }) => rest);
  }

  async findByNameAndPeriod(institutionId: string, name: string, periodId: string) {
    const trimmed = name.trim().toLowerCase();
    return Array.from(this.byId.values())
      .filter(
        (b) =>
          b.institutionId === institutionId &&
          b.periodId === periodId &&
          b.name.trim().toLowerCase() === trimmed,
      )
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
      .map(({ createdAt: _c, ...rest }) => rest);
  }

  async create(institutionId: string, data: CreateBookletTypeData) {
    if (this.p2002OnCreate) {
      const err = new Error("Unique constraint") as Error & { code: string };
      err.code = "P2002";
      throw err;
    }
    const order =
      data.order ??
      Array.from(this.byId.values()).filter(
        (b) => b.institutionId === institutionId && b.periodId === data.periodId,
      ).length;
    this.seq += 1;
    const id = `bt-${this.seq}`;
    const b: BookletType & { createdAt: number } = {
      id,
      institutionId,
      periodId: data.periodId,
      name: data.name,
      description: data.description ?? null,
      order,
      createdAt: this.seq,
    };
    this.byId.set(id, b);
    const { createdAt: _c, ...rest } = b;
    return rest;
  }

  async update(
    institutionId: string,
    id: string,
    data: UpdateBookletTypeData,
  ): Promise<BookletType | null> {
    const current = this.byId.get(id);
    if (!current || current.institutionId !== institutionId) return null;
    if (data.name !== undefined && data.name !== current.name) {
      const dup = Array.from(this.byId.values()).find(
        (b) =>
          b.institutionId === institutionId &&
          b.periodId === current.periodId &&
          b.id !== id &&
          b.name === data.name,
      );
      if (dup) {
        const err = new Error("Unique constraint") as Error & { code: string };
        err.code = "P2002";
        throw err;
      }
    }
    const next: BookletType & { createdAt: number } = {
      ...current,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
    };
    this.byId.set(id, next);
    const { createdAt: _c, ...rest } = next;
    return rest;
  }

  async delete(institutionId: string, id: string) {
    const current = this.byId.get(id);
    if (!current || current.institutionId !== institutionId) {
      const err = new Error("Not found") as Error & { code: string };
      err.code = "P2025";
      throw err;
    }
    this.byId.delete(id);
  }
}

class InMemoryPeriods implements PeriodRepository {
  items: Period[] = [];
  async findAll(institutionId: string, academicYearId?: string) {
    return this.items.filter(
      (p) =>
        p.institutionId === institutionId &&
        (!academicYearId || p.academicYearId === academicYearId),
    );
  }
  async findById(institutionId: string, id: string) {
    return this.items.find((p) => p.institutionId === institutionId && p.id === id) ?? null;
  }
  async findByName(institutionId: string, name: string) {
    const trimmed = name.trim().toLowerCase();
    const matches = this.items.filter(
      (p) => p.institutionId === institutionId && p.name.trim().toLowerCase() === trimmed,
    );
    matches.sort((a, b) => a.order - b.order);
    return matches[0] ?? null;
  }
  async create(institutionId: string, data: CreatePeriodData) {
    const p: Period = {
      id: `p-${this.items.length + 1}`,
      institutionId,
      ...data,
      isCurrent: false,
    };
    this.items.push(p);
    return p;
  }
  async update() {
    return null;
  }
  async delete() {
    /* noop */
  }
  async setCurrent(
    _institutionId: string,
    _academicYearId: string,
    _periodId: string,
    _isCurrent: boolean,
  ) {
    /* noop — los tests de booklet-types no ejercitan el flip de isCurrent */
  }
  async findCurrent(_institutionId: string, _academicYearId: string): Promise<Period | null> {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreateBookletType", () => {
  let bookletTypes: InMemoryBookletTypes;
  let periods: InMemoryPeriods;
  let uc: CreateBookletType;
  const periodId = "p1";

  beforeEach(() => {
    bookletTypes = new InMemoryBookletTypes();
    periods = new InMemoryPeriods();
    periods.items.push({
      id: periodId,
      institutionId: "inst1",
      academicYearId: "ay1",
      name: "I Periodo",
      order: 1,
      startDate: new Date(),
      endDate: new Date(),
      isCurrent: false,
    });
    uc = new CreateBookletType(bookletTypes, periods);
  });

  it("crea un tipo válido", async () => {
    const r = await uc.execute({
      actor: admin,
      periodId,
      data: { name: "Estándar" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("Estándar");
      expect(r.value.institutionId).toBe("inst1");
      expect(r.value.periodId).toBe(periodId);
    }
  });

  it("rechaza nombre vacío con VALIDATION", async () => {
    const r = await uc.execute({
      actor: admin,
      periodId,
      data: { name: "   " },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza nombre demasiado largo (>50) con VALIDATION", async () => {
    const r = await uc.execute({
      actor: admin,
      periodId,
      data: { name: "x".repeat(51) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("VALIDATION");
  });

  it("rechaza nombre duplicado en la misma Prueba con CONFLICT (pre-check)", async () => {
    const first = await uc.execute({
      actor: admin,
      periodId,
      data: { name: "Estándar" },
    });
    expect(first.ok).toBe(true);

    const dup = await uc.execute({
      actor: admin,
      periodId,
      data: { name: "Estándar" },
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe("CONFLICT");
  });

  it("atrapa P2002 desde el repo y lo convierte a CONFLICT", async () => {
    // Simula carrera entre dos requests concurrentes: pre-check pasa,
    // pero el repo lanza P2002 al persistir.
    bookletTypes.p2002OnCreate = true;
    const r = await uc.execute({
      actor: admin,
      periodId,
      data: { name: "Nuevo" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("rechaza la creación si la Prueba no existe con NOT_FOUND", async () => {
    const r = await uc.execute({
      actor: admin,
      periodId: "no-existe",
      data: { name: "Estándar" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("solo ECU_MASTER puede crear (TEACHER → FORBIDDEN)", async () => {
    const r = await uc.execute({
      actor: teacher,
      periodId,
      data: { name: "Estándar" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("ListBookletTypesByPeriod", () => {
  let bookletTypes: InMemoryBookletTypes;
  let uc: ListBookletTypesByPeriod;
  const periodId = "p1";

  beforeEach(() => {
    bookletTypes = new InMemoryBookletTypes();
    uc = new ListBookletTypesByPeriod(bookletTypes);
  });

  it("filtra por Prueba y ordena por order asc", async () => {
    await bookletTypes.create("inst1", { periodId, name: "A", order: 2 });
    await bookletTypes.create("inst1", { periodId, name: "B", order: 1 });
    await bookletTypes.create("inst2", { periodId, name: "C", order: 0 });

    const r = await uc.execute({ actor: admin, periodId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toHaveLength(2);
      expect(r.value.map((b) => b.name)).toEqual(["B", "A"]);
    }
  });

  it("cualquier rol con sesión puede listar", async () => {
    const r = await uc.execute({ actor: teacher, periodId });
    expect(r.ok).toBe(true);
  });
});

describe("ListBookletTypesByInstitution", () => {
  let bookletTypes: InMemoryBookletTypes;
  let uc: ListBookletTypesByInstitution;

  beforeEach(() => {
    bookletTypes = new InMemoryBookletTypes();
    uc = new ListBookletTypesByInstitution(bookletTypes);
  });

  it("trae todos los tipos de la institución del actor", async () => {
    await bookletTypes.create("inst1", { periodId: "p1", name: "A" });
    await bookletTypes.create("inst1", { periodId: "p2", name: "B" });
    await bookletTypes.create("inst2", { periodId: "p1", name: "C" });

    const r = await uc.execute({ actor: admin });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(2);
  });
});

describe("UpdateBookletType", () => {
  let bookletTypes: InMemoryBookletTypes;
  let uc: UpdateBookletType;
  const periodId = "p1";

  beforeEach(async () => {
    bookletTypes = new InMemoryBookletTypes();
    await bookletTypes.create("inst1", {
      periodId,
      name: "Estándar",
      description: "Para todos",
    });
    uc = new UpdateBookletType(bookletTypes);
  });

  it("edita el nombre", async () => {
    const r = await uc.execute({
      actor: admin,
      id: "bt-1",
      data: { name: "General" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.name).toBe("General");
  });

  it("limpia description con null explícito", async () => {
    const r = await uc.execute({
      actor: admin,
      id: "bt-1",
      data: { description: null },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.description).toBeNull();
  });

  it("rechaza nombre colisión en la misma Prueba", async () => {
    await bookletTypes.create("inst1", { periodId, name: "Especial" });
    const r = await uc.execute({
      actor: admin,
      id: "bt-1",
      data: { name: "Especial" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("CONFLICT");
  });

  it("rechaza si el tipo no existe", async () => {
    const r = await uc.execute({
      actor: admin,
      id: "no-existe",
      data: { name: "X" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("solo ECU_MASTER puede editar", async () => {
    const r = await uc.execute({
      actor: teacher,
      id: "bt-1",
      data: { name: "Otro" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

describe("DeleteBookletType", () => {
  let bookletTypes: InMemoryBookletTypes;
  let uc: DeleteBookletType;

  beforeEach(async () => {
    bookletTypes = new InMemoryBookletTypes();
    await bookletTypes.create("inst1", { periodId: "p1", name: "Estándar" });
    uc = new DeleteBookletType(bookletTypes);
  });

  it("elimina un tipo existente", async () => {
    const r = await uc.execute({ actor: admin, id: "bt-1" });
    expect(r.ok).toBe(true);
    const after = await bookletTypes.listByInstitution("inst1");
    expect(after).toHaveLength(0);
  });

  it("rechaza si el tipo no existe", async () => {
    const r = await uc.execute({ actor: admin, id: "no-existe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });

  it("solo ECU_MASTER puede eliminar", async () => {
    const r = await uc.execute({ actor: teacher, id: "bt-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});
