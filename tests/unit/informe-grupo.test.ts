/**
 * Acceso y selección del Informe detallado por grupo (use case).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import {
  type DatosInformeGrupo,
  GetInformeGrupo,
  type InformeGrupoReader,
} from "@/modules/consultas/application/informe-grupo";
import type { LeaderScopeReader } from "@/modules/consultas/application/list-calificaciones";
import type { InformeGrupoOpciones } from "@/modules/consultas/domain/queries/informe-grupo/informe-grupo";

const master: AuthenticatedUser = { userId: "m", institutionId: "i1", roles: ["ECU_MASTER"] };
const lider: AuthenticatedUser = { userId: "l", institutionId: "i1", roles: ["ECU_LIDER"] };
const docente: AuthenticatedUser = { userId: "t", institutionId: "i1", roles: ["TEACHER"] };

const OPCIONES: InformeGrupoOpciones = {
  pruebas: [
    {
      id: "p-2026",
      name: "2026-2",
      academicYearId: "y26",
      year: 2026,
      isCurrent: true,
      yearIsCurrent: true,
    },
    {
      id: "p-2025",
      name: "2025-4",
      academicYearId: "y25",
      year: 2025,
      isCurrent: true,
      yearIsCurrent: false,
    },
  ],
  grupos: [
    { id: "g-1001", name: "1001", courseName: "10", academicYearId: "y26" },
    { id: "g-1101", name: "1101", courseName: "11", academicYearId: "y26" },
  ],
};

function datos(over: Partial<DatosInformeGrupo> = {}): DatosInformeGrupo {
  return {
    prueba: { id: "p-2026", name: "2026-2", academicYearId: "y26" },
    grupo: { id: "g-1001", name: "1001", courseName: "10", courseId: "c10", academicYearId: "y26" },
    estudiantes: [],
    cuadernillos: [],
    hojas: [],
    respuestas: [],
    inhabilitadas: new Set(),
    ...over,
  };
}

class ReaderFake implements InformeGrupoReader {
  opcionesPedidas: (string[] | undefined)[] = [];
  datosPedidos: [string, string][] = [];
  cargar: DatosInformeGrupo | null = datos();
  async listOpciones(_i: string, courseIds?: string[]) {
    this.opcionesPedidas.push(courseIds);
    // El líder solo ve los grupos de sus grados (aquí: el curso 10).
    return courseIds
      ? {
          ...OPCIONES,
          grupos: OPCIONES.grupos.filter((g) => courseIds.includes(`c${g.courseName}`)),
        }
      : OPCIONES;
  }
  async cargarDatos(_i: string, periodId: string, groupId: string) {
    this.datosPedidos.push([periodId, groupId]);
    return this.cargar;
  }
}

class ScopeFake implements LeaderScopeReader {
  constructor(private readonly courseIds: string[]) {}
  async listAssignedCourseIds() {
    return this.courseIds;
  }
}

let reader: ReaderFake;
let uc: GetInformeGrupo;

beforeEach(() => {
  reader = new ReaderFake();
  uc = new GetInformeGrupo(reader, new ScopeFake(["c10"]));
});

describe("GetInformeGrupo - acceso", () => {
  it("el docente no tiene acceso", async () => {
    const r = await uc.execute({ actor: docente });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("el master ve todos los grupos (sin recorte)", async () => {
    const r = await uc.execute({ actor: master });
    expect(r.ok).toBe(true);
    expect(reader.opcionesPedidas).toEqual([undefined]);
  });

  it("el líder queda acotado a sus grados", async () => {
    const r = await uc.execute({ actor: lider });
    expect(reader.opcionesPedidas).toEqual([["c10"]]);
    if (r.ok) expect(r.value.opciones.grupos.map((g) => g.id)).toEqual(["g-1001"]);
  });

  it("el líder que pide un grupo fuera de su alcance recibe FORBIDDEN y no se cargan datos", async () => {
    const r = await uc.execute({ actor: lider, periodId: "p-2026", groupId: "g-1101" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.informe).toBeNull();
      expect(r.value.error?.code).toBe("FORBIDDEN");
      // Conserva las opciones para que pueda elegir otro grupo.
      expect(r.value.opciones.grupos).toHaveLength(1);
    }
    expect(reader.datosPedidos).toEqual([]);
  });
});

describe("GetInformeGrupo - selección", () => {
  it("sin prueba preselecciona la actual del año actual; sin grupo no hay informe", async () => {
    const r = await uc.execute({ actor: master });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.seleccion).toEqual({ periodId: "p-2026", groupId: null });
      expect(r.value.informe).toBeNull();
      expect(r.value.error).toBeNull();
    }
  });

  it("con prueba y grupo arma el informe", async () => {
    const r = await uc.execute({ actor: master, periodId: "p-2026", groupId: "g-1001" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.informe?.grupo.name).toBe("1001");
      expect(r.value.error).toBeNull();
    }
    expect(reader.datosPedidos).toEqual([["p-2026", "g-1001"]]);
  });

  it("un grupo de otro año académico que la prueba da VALIDATION", async () => {
    reader.cargar = datos({ prueba: { id: "p-2025", name: "2025-4", academicYearId: "y25" } });
    const r = await uc.execute({ actor: master, periodId: "p-2025", groupId: "g-1001" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.informe).toBeNull();
      expect(r.value.error?.code).toBe("VALIDATION");
    }
  });

  it("una prueba que no existe da NOT_FOUND", async () => {
    const r = await uc.execute({ actor: master, periodId: "p-x", groupId: "g-1001" });
    if (r.ok) expect(r.value.error?.code).toBe("NOT_FOUND");
  });

  it("un grupo de otra institución (master) da NOT_FOUND", async () => {
    const r = await uc.execute({ actor: master, periodId: "p-2026", groupId: "g-ajeno" });
    if (r.ok) expect(r.value.error?.code).toBe("NOT_FOUND");
    expect(reader.datosPedidos).toEqual([]);
  });
});
