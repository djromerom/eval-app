import { beforeEach, describe, expect, it } from "vitest";
import { ImportStudents } from "@/modules/students/application/students";
import { parseStudentsCsv } from "@/modules/students/infrastructure/csv";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import type {
  CreateStudentData,
  Student,
  StudentRepository,
  StudentRosterPatch,
} from "@/modules/students/domain/student";
import type {
  Group,
  GroupRepository,
  Period,
  PeriodRepository,
} from "@/modules/academic/domain/types";
import type {
  BookletType,
  BookletTypeRepository,
  CreateBookletTypeData,
  UpdateBookletTypeData,
} from "@/modules/booklet-types/domain/booklet-type";

class InMemoryStudents implements StudentRepository {
  items: Student[] = [];
  async findById(institutionId: string, id: string) {
    return this.items.find((s) => s.institutionId === institutionId && s.id === id) ?? null;
  }
  async findByCode(institutionId: string, code: string) {
    return this.items.find((s) => s.institutionId === institutionId && s.code === code) ?? null;
  }
  async findByCodeIncludingHistory(_institutionId: string, _code: string): Promise<Student | null> {
    return null;
  }
  async findByGroup() {
    return [];
  }
  async findAll(institutionId: string) {
    return this.items.filter((s) => s.institutionId === institutionId);
  }
  async create(institutionId: string, data: CreateStudentData) {
    const s: Student = { id: `s-${this.items.length + 1}`, institutionId, isActive: true, ...data };
    this.items.push(s);
    return s;
  }
  async createMany(institutionId: string, data: CreateStudentData[]) {
    for (const d of data) await this.create(institutionId, d);
    return data.length;
  }
  async changeCode() {}
  async update(
    institutionId: string,
    id: string,
    data: {
      groupId: string;
      lastName1: string;
      lastName2: string;
      firstName1: string;
      firstName2: string;
      idType: string;
      idNumber: string;
      enrollmentYear: number;
      isActive: boolean;
    },
  ) {
    const s = this.items.find((x) => x.institutionId === institutionId && x.id === id);
    if (!s) {
      const err = new Error("Not found") as Error & { code: string };
      err.code = "P2025";
      throw err;
    }
    Object.assign(s, data);
    return s;
  }
  async softDelete(institutionId: string, id: string) {
    const s = this.items.find((x) => x.institutionId === institutionId && x.id === id);
    if (!s) {
      const err = new Error("Not found") as Error & { code: string };
      err.code = "P2025";
      throw err;
    }
    s.isActive = false;
  }
  /** Aplica el parche como el repo real: solo los campos presentes, nunca
   *  `code`, `groupId`, `isActive` ni `deletedAt`. */
  async applyRosterPatches(institutionId: string, patches: StudentRosterPatch[]) {
    let n = 0;
    for (const p of patches) {
      const s = this.items.find((x) => x.institutionId === institutionId && x.id === p.id);
      if (!s) continue;
      if (p.lastName1 !== undefined) s.lastName1 = p.lastName1;
      if (p.lastName2 !== undefined) s.lastName2 = p.lastName2;
      if (p.firstName1 !== undefined) s.firstName1 = p.firstName1;
      if (p.firstName2 !== undefined) s.firstName2 = p.firstName2;
      if (p.idType !== undefined) s.idType = p.idType;
      if (p.idNumber !== undefined) s.idNumber = p.idNumber;
      if (p.enrollmentYear !== undefined) s.enrollmentYear = p.enrollmentYear;
      if (p.grade !== undefined) s.grade = p.grade;
      if (p.bookletTypeId !== undefined) s.bookletTypeId = p.bookletTypeId;
      n++;
    }
    return n;
  }
}

class InMemoryGroups implements GroupRepository {
  constructor(private readonly groups: Group[]) {}
  async findAll(institutionId: string) {
    return this.groups.filter((g) => g.institutionId === institutionId);
  }
  async findById(institutionId: string, id: string) {
    return this.groups.find((g) => g.institutionId === institutionId && g.id === id) ?? null;
  }
  async create(): Promise<Group> {
    throw new Error("no usado");
  }
  async delete(): Promise<void> {
    // no usado en este test
  }
}

class InMemoryBookletTypes implements BookletTypeRepository {
  /** Test-only: pre-cargar matches de bookletType por nombre para tests
   *  específicos; por defecto vacío para no interferir con los tests
   *  legacy de CSV. */
  items: BookletType[] = [];
  async findById() {
    return null;
  }
  async listByPeriod(_institutionId: string, periodId: string) {
    return this.items.filter((b) => b.institutionId === _institutionId && b.periodId === periodId);
  }
  async listByInstitution() {
    return [];
  }
  async findByName(_institutionId: string, name: string) {
    const trimmed = name.trim().toLowerCase();
    return this.items.filter(
      (b) => b.institutionId === _institutionId && b.name.trim().toLowerCase() === trimmed,
    );
  }
  async findByNameAndPeriod(_institutionId: string, name: string, periodId: string) {
    const trimmed = name.trim().toLowerCase();
    return this.items.filter(
      (b) =>
        b.institutionId === _institutionId &&
        b.periodId === periodId &&
        b.name.trim().toLowerCase() === trimmed,
    );
  }
  async create(_institutionId: string, _data: CreateBookletTypeData): Promise<BookletType> {
    throw new Error("no usado");
  }
  async update(
    _institutionId: string,
    _id: string,
    _data: UpdateBookletTypeData,
  ): Promise<BookletType | null> {
    return null;
  }
  async delete() {
    /* noop */
  }
}

class InMemoryPeriods implements PeriodRepository {
  constructor(private readonly items: Period[] = []) {}
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
  async create(): Promise<Period> {
    throw new Error("no usado");
  }
  async update(): Promise<Period | null> {
    return null;
  }
  async delete(): Promise<void> {
    /* noop */
  }
  async setCurrent(): Promise<void> {
    /* noop */
  }
  // Sprint Bundle-Period (sep 2026): CreateBundle lo usa para inyectar el
  // periodo actual del año académico vigente cuando el form no trae periodId.
  async findCurrent(institutionId: string, academicYearId: string) {
    return (
      this.items.find(
        (p) =>
          p.institutionId === institutionId && p.academicYearId === academicYearId && p.isCurrent,
      ) ?? null
    );
  }
}

const admin: AuthenticatedUser = { userId: "u", institutionId: "i1", roles: ["ECU_MASTER"] };
const groups: Group[] = [{ id: "g1", institutionId: "i1", courseId: "c1", name: "11-03" }];

const CSV = `apellido1;apellido2;nombre1;nombre2;tipo_doc;num_doc;codigo;grupo;anio_ingreso
Pérez;Gómez;Ana;;T.I.;123;EST-001;11-03;2026
García;;Luis;Carlos;C.C.;456;EST-002;11-03;2026`;

describe("parseStudentsCsv", () => {
  it("parsea encabezados con tildes y separador ;", () => {
    const { rows, missing } = parseStudentsCsv(CSV);
    expect(missing).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      lastName1: "Pérez",
      lastName2: "Gómez",
      firstName1: "Ana",
      firstName2: "",
      code: "EST-001",
      groupName: "11-03",
    });
    expect(rows[0]!.enrollmentYear).toBe(2026);
  });

  it("acepta columnas legacy 'nombre' y parte por whitespace", () => {
    const { rows, missing } = parseStudentsCsv(
      `nombre;tipo_doc;num_doc;codigo;grupo;anio_ingreso
Pérez Gómez Ana;T.I.;1;EST-1;11-03;2026`,
    );
    expect(missing).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      lastName1: "Pérez",
      lastName2: "Gómez",
      firstName1: "Ana",
      firstName2: "",
    });
  });

  it("reporta columnas faltantes", () => {
    const { missing } = parseStudentsCsv("apellido1,codigo\nPérez,EST-1");
    expect(missing).toContain("firstName1");
    expect(missing).toContain("groupName");
    expect(missing).toContain("idType");
  });

  it("expone las columnas presentes en el encabezado", () => {
    const { present } = parseStudentsCsv(
      `apellido1;nombre1;codigo;grupo;prueba;tipo_cuadernillo
Pérez;Ana;EST-1;11-03;2026-3;Estándar`,
    );
    expect(present).toEqual(
      expect.arrayContaining([
        "lastName1",
        "firstName1",
        "code",
        "groupName",
        "periodName",
        "bookletTypeName",
      ]),
    );
    expect(present).not.toContain("idType");
    expect(present).not.toContain("enrollmentYear");
  });
});

describe("ImportStudents", () => {
  let students: InMemoryStudents;
  let bookletTypes: InMemoryBookletTypes;
  let uc: ImportStudents;
  beforeEach(() => {
    students = new InMemoryStudents();
    bookletTypes = new InMemoryBookletTypes();
    uc = new ImportStudents(
      students,
      new InMemoryGroups(groups),
      new InMemoryPeriods(),
      bookletTypes,
    );
  });

  it("importa filas válidas y reporta errores por fila", async () => {
    const { rows } = parseStudentsCsv(
      `apellido1;apellido2;nombre1;nombre2;tipo_doc;num_doc;codigo;grupo;anio_ingreso
Pérez;;Ana;;T.I.;1;EST-001;11-03;2026
Sin;;Grupo;;C.C.;2;EST-002;99-99;2026
Dup;;Otro;;C.C.;3;EST-001;11-03;2026`,
    );
    const r = await uc.execute({ actor: admin, rows });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.created).toBe(1);
      expect(r.value.errors).toHaveLength(2);
      expect(r.value.errors[0]!.message).toContain("Grupo");
      expect(r.value.errors[1]!.message).toContain("Código");
    }
  });

  it("rechaza a un no-ADMIN", async () => {
    const { rows } = parseStudentsCsv(CSV);
    const r = await uc.execute({ actor: { ...admin, roles: ["TEACHER"] }, rows });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });
});

/**
 * Modo "actualizar": el archivo de roster del docente trae el código de
 * estudiantes que YA existen en la BD. La fila no debe duplicar al
 * estudiante sino actualizarlo, y SOLO con las columnas que el archivo
 * trae. Ni el código ni el grupo pueden cambiar (la historia de las
 * pruebas anteriores depende de ellos).
 */
describe("ImportStudents (modo actualizar)", () => {
  const groupsP3: Group[] = [{ id: "g1", institutionId: "i1", courseId: "c1", name: "11-03" }];
  const groupsP2: Group[] = [{ id: "g0", institutionId: "i1", courseId: "c1", name: "11-02" }];
  const periodP3: Period = {
    id: "p3",
    institutionId: "i1",
    academicYearId: "ay1",
    name: "2026-3",
    order: 3,
    startDate: new Date("2026-08-01"),
    endDate: new Date("2026-12-20"),
    isCurrent: true,
  };

  let students: InMemoryStudents;
  let bookletTypes: InMemoryBookletTypes;
  let uc: ImportStudents;

  beforeEach(() => {
    students = new InMemoryStudents();
    // Estudiante que YA existe (apuntó al cuadernillo del 2026-2).
    students.items.push({
      id: "s1",
      institutionId: "i1",
      groupId: "g0",
      lastName1: "Pérez",
      lastName2: "Gómez",
      firstName1: "Ana",
      firstName2: "",
      idType: "T.I.",
      idNumber: "1",
      code: "EST-001",
      enrollmentYear: 2026,
      isActive: true,
      grade: "G11",
      bookletTypeId: "bt-2026-2",
    });
    bookletTypes = new InMemoryBookletTypes();
    bookletTypes.items.push({
      id: "bt-2026-3",
      institutionId: "i1",
      periodId: "p3",
      name: "Estándar",
      description: null,
      order: 1,
    });
    uc = new ImportStudents(
      students,
      new InMemoryGroups([...groupsP2, ...groupsP3]),
      new InMemoryPeriods([periodP3]),
      bookletTypes,
    );
  });

  it("actualiza al estudiante existente en vez de duplicarlo", async () => {
    const { rows, present } = parseStudentsCsv(
      `apellido1;apellido2;nombre1;nombre2;codigo;grupo;prueba;tipo_cuadernillo
Pérez;;Ana;María;EST-001;11-03;2026-3;Estándar`,
    );
    const r = await uc.execute({ actor: admin, rows, present });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(0);
    expect(r.value.updated).toBe(1);
    expect(r.value.errors).toHaveLength(0);
    expect(students.items).toHaveLength(1);
    const s = students.items[0]!;
    expect(s.bookletTypeId).toBe("bt-2026-3");
    expect(s.firstName2).toBe("María");
    // Lo que NO se toca:
    expect(s.code).toBe("EST-001");
    expect(s.groupId).toBe("g0");
    expect(s.idType).toBe("T.I.");
    expect(s.idNumber).toBe("1");
    expect(s.enrollmentYear).toBe(2026);
    expect(s.grade).toBe("G11");
    expect(s.isActive).toBe(true);
  });

  it("no mueve al estudiante de grupo y lo avisa", async () => {
    const { rows, present } = parseStudentsCsv(
      `apellido1;nombre1;codigo;grupo;prueba;tipo_cuadernillo
Pérez;Ana;EST-001;11-03;2026-3;Estándar`,
    );
    const r = await uc.execute({ actor: admin, rows, present });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.updated).toBe(1);
    expect(r.value.warnings).toHaveLength(1);
    expect(r.value.warnings[0]!.message).toContain("no coincide");
    expect(students.items[0]!.groupId).toBe("g0");
  });

  it("solo escribe las columnas que trae el archivo", async () => {
    const { rows, present } = parseStudentsCsv(
      `apellido1;nombre1;codigo;grupo
Pérez;Ana;EST-001;11-03`,
    );
    const r = await uc.execute({ actor: admin, rows, present });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.updated).toBe(1);
    const s = students.items[0]!;
    // Sin columna de cuadernillo → el tipo de la P3 NO se escribe.
    expect(s.bookletTypeId).toBe("bt-2026-2");
    expect(s.idType).toBe("T.I.");
  });

  it("rechaza la fila si trae cuadernillo sin la columna PRUEBA", async () => {
    const { rows, present } = parseStudentsCsv(
      `apellido1;nombre1;codigo;grupo;tipo_cuadernillo
Pérez;Ana;EST-001;11-03;Estándar`,
    );
    const r = await uc.execute({ actor: admin, rows, present });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.updated).toBe(0);
    expect(r.value.errors).toHaveLength(1);
    expect(r.value.errors[0]!.message).toContain("Falta la Prueba");
    expect(students.items[0]!.bookletTypeId).toBe("bt-2026-2");
  });

  it("resuelve el tipo de cuadernillo por prefijo (planilla institucional)", async () => {
    // La planilla escribe "Con ajuste razonable"; el tipo de la Prueba se
    // llama "Con Ajuste".
    bookletTypes.items.push({
      id: "bt-2026-3-ajuste",
      institutionId: "i1",
      periodId: "p3",
      name: "Con Ajuste",
      description: null,
      order: 2,
    });
    const { rows, present } = parseStudentsCsv(
      `apellido1;nombre1;codigo;grupo;prueba;tipo_cuadernillo
Pérez;Ana;EST-001;11-03;2026-3;Con ajuste razonable`,
    );
    const r = await uc.execute({ actor: admin, rows, present });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.updated).toBe(1);
    expect(r.value.errors).toHaveLength(0);
    expect(students.items[0]!.bookletTypeId).toBe("bt-2026-3-ajuste");
  });

  it("lee la planilla institucional tal cual (ID, SEGUBD APELLIDO, CUADERNILLO)", async () => {
    const { rows, present, missing } = parseStudentsCsv(
      `GRUPO;ID;PRIMER APELLIDO;SEGUBD APELLIDO;PRIMER NOMBRE;SEGUNDO NOMBRE;CUADERNILLO;PRUEBA
11-03;EST-001;Pérez;Gómez;Ana;María;Estándar;2026-3`,
    );
    // Sin columna de documento ni año de ingreso: no bloquea porque el
    // estudiante ya existe (solo hacen falta para crear de cero).
    expect(missing).toContain("idType");
    expect(missing).toContain("idNumber");
    expect(missing).toContain("enrollmentYear");
    expect(present).toContain("code");
    const r = await uc.execute({ actor: admin, rows, present });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.updated).toBe(1);
    expect(r.value.errors).toHaveLength(0);
    const s = students.items[0]!;
    expect(s.lastName1).toBe("Pérez");
    expect(s.lastName2).toBe("Gómez");
    expect(s.firstName1).toBe("Ana");
    expect(s.firstName2).toBe("María");
    expect(s.bookletTypeId).toBe("bt-2026-3");
  });

  it("crea el estudiante nuevo si el código no existe", async () => {
    const { rows, present } = parseStudentsCsv(
      `apellido1;apellido2;nombre1;nombre2;tipo_doc;num_doc;codigo;grupo;anio_ingreso
Nuevo;;Luis;Carlos;C.C.;456;EST-777;11-03;2026`,
    );
    const r = await uc.execute({ actor: admin, rows, present });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(1);
    expect(r.value.updated).toBe(0);
    expect(students.items).toHaveLength(2);
  });

  it("no crea un estudiante nuevo si el código es un código antiguo (historial)", async () => {
    const { rows, present } = parseStudentsCsv(
      `apellido1;apellido2;nombre1;nombre2;tipo_doc;num_doc;codigo;grupo;anio_ingreso
Nuevo;;Luis;Carlos;C.C.;456;EST-VIEJO;11-03;2026`,
    );
    // El doble en memoria simula el historial: "EST-VIEJO" es el código
    // antiguo del estudiante que hoy se llama EST-001.
    students.findByCodeIncludingHistory = async (institutionId: string, code: string) =>
      code === "EST-VIEJO"
        ? (students.items.find((s) => s.institutionId === institutionId) ?? null)
        : null;
    const r = await uc.execute({ actor: admin, rows, present });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.created).toBe(0);
    expect(r.value.errors).toHaveLength(1);
    expect(r.value.errors[0]!.message).toContain("código antiguo");
    expect(students.items).toHaveLength(1);
  });
});
