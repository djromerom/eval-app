/**
 * Clasificar a mano una hoja sin clasificar (card del lote): se elige
 * cuadernillo y estudiante, se crea la AnswerSheet y se manda a calificar.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import { ClassifyUnclassifiedScan } from "@/modules/scanning/application/classify-unclassified-scan";
import {
  EstudianteConHojaError,
  type CuadernilloParaClasificar,
  type HojaSinClasificar,
  type OmrJobQueue,
  type UnclassifiedScanRepository,
} from "@/modules/scanning/domain/unclassified-scan";

const docente: AuthenticatedUser = { userId: "u-doc", institutionId: "inst-1", roles: ["TEACHER"] };

class InMemoryRepo implements UnclassifiedScanRepository {
  hojas = new Map<string, HojaSinClasificar>();
  bundles = new Map<string, CuadernilloParaClasificar & { institutionId: string }>();
  /** studentId → cursos en los que está activo. */
  estudiantes = new Map<string, { institutionId: string; courseId: string }>();
  calificadas: { id: string; bundleId: string; studentId: string; scanBatchId: string | null }[] =
    [];
  creadas: { sheetId: string; batchId: string; bundleId: string; studentId: string }[] = [];
  noEncoladas: string[] = [];
  /** Simula que otra persona la clasificó entre la validación y la escritura. */
  ganaOtro = false;
  /** Simula que otra clasificación del mismo estudiante ganó la carrera. */
  duplicadaEnTx: { id: string; scanBatchId: string | null } | null = null;

  async findById(institutionId: string, id: string) {
    const h = this.hojas.get(id);
    return h && h.institutionId === institutionId ? h : null;
  }
  async findBundle(institutionId: string, bundleId: string) {
    const b = this.bundles.get(bundleId);
    return b && b.institutionId === institutionId ? b : null;
  }
  async studentInCourses(institutionId: string, studentId: string, courseIds: string[]) {
    const s = this.estudiantes.get(studentId);
    return !!s && s.institutionId === institutionId && courseIds.includes(s.courseId);
  }
  /** Como el repo real: bloquean las calificadas y también las creadas por
   *  una clasificación a mano, aunque todavía no tengan nota. */
  async findBlockingSheetOf(bundleId: string, studentId: string) {
    const calificada = this.calificadas.find(
      (c) => c.bundleId === bundleId && c.studentId === studentId,
    );
    if (calificada) return calificada;
    const aMano = this.creadas.find((c) => c.bundleId === bundleId && c.studentId === studentId);
    return aMano ? { id: aMano.sheetId, scanBatchId: aMano.batchId } : null;
  }
  async resolverEnHoja(args: {
    hoja: HojaSinClasificar;
    bundleId: string;
    studentId: string;
    resolvedBy: string;
  }) {
    if (this.ganaOtro) return "ALREADY_RESOLVED" as const;
    if (this.duplicadaEnTx) return { duplicada: this.duplicadaEnTx };
    const creada = {
      sheetId: `sheet-${this.creadas.length + 1}`,
      batchId: "lote-destino",
      bundleId: args.bundleId,
      studentId: args.studentId,
    };
    this.creadas.push(creada);
    this.hojas.set(args.hoja.id, { ...args.hoja, resolvedAt: new Date() });
    return { sheetId: creada.sheetId, batchId: creada.batchId };
  }
  async marcarNoEncolada(sheetId: string) {
    this.noEncoladas.push(sheetId);
  }
}

class FakeQueue implements OmrJobQueue {
  jobs: Parameters<OmrJobQueue["enqueue"]>[0][] = [];
  falla = false;
  async enqueue(job: Parameters<OmrJobQueue["enqueue"]>[0]) {
    if (this.falla) throw new Error("Redis caído");
    this.jobs.push(job);
  }
}

let repo: InMemoryRepo;
let queue: FakeQueue;
let useCase: ClassifyUnclassifiedScan;

beforeEach(() => {
  repo = new InMemoryRepo();
  queue = new FakeQueue();
  useCase = new ClassifyUnclassifiedScan(repo, queue);
  repo.hojas.set("h-1", {
    id: "h-1",
    institutionId: "inst-1",
    scanBatchId: "lote-origen",
    filePath: "scans/lote-origen/sin-clasificar/hoja_1.tif",
    originalFilename: "hoja.tif",
    reason: "qr-ilegible",
    resolvedAt: null,
  });
  repo.bundles.set("b-1", {
    id: "b-1",
    institutionId: "inst-1",
    status: "READY",
    courseIds: ["curso-11"],
  });
  repo.estudiantes.set("stu-1", { institutionId: "inst-1", courseId: "curso-11" });
});

const clasificar = (overrides: Partial<Parameters<ClassifyUnclassifiedScan["execute"]>[0]> = {}) =>
  useCase.execute({
    actor: docente,
    unclassifiedScanId: "h-1",
    bundleId: "b-1",
    studentId: "stu-1",
    ...overrides,
  });

describe("ClassifyUnclassifiedScan", () => {
  it("crea la hoja con cuadernillo y estudiante y la manda a calificar", async () => {
    const r = await clasificar();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ sheetId: "sheet-1", batchId: "lote-destino" });
    expect(repo.creadas).toEqual([
      { sheetId: "sheet-1", batchId: "lote-destino", bundleId: "b-1", studentId: "stu-1" },
    ]);
    expect(queue.jobs).toEqual([
      {
        answerSheetId: "sheet-1",
        scanBatchId: "lote-destino",
        institutionId: "inst-1",
        imagePath: "scans/lote-origen/sin-clasificar/hoja_1.tif",
      },
    ]);
  });

  it.each([["ECU_LIDER"], ["ECU_MASTER"]] as const)("%s también puede", async (rol) => {
    const r = await clasificar({ actor: { ...docente, roles: [rol] } });
    expect(r.ok).toBe(true);
  });

  it("SUPER_ADMIN sin rol de colegio no puede", async () => {
    const r = await clasificar({ actor: { ...docente, roles: ["SUPER_ADMIN"] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
  });

  it("una hoja de otra institución no existe", async () => {
    const r = await clasificar({ actor: { ...docente, institutionId: "inst-2" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
    expect(repo.creadas).toHaveLength(0);
  });

  it("una hoja ya clasificada no se vuelve a clasificar", async () => {
    await clasificar();
    const r = await clasificar();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ALREADY_RESOLVED");
    expect(repo.creadas).toHaveLength(1);
  });

  it("si otra persona la clasificó a la vez, no se crea una segunda hoja", async () => {
    repo.ganaOtro = true;
    const r = await clasificar();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ALREADY_RESOLVED");
    expect(queue.jobs).toHaveLength(0);
  });

  it("el cuadernillo tiene que estar LISTO", async () => {
    repo.bundles.set("b-1", { ...repo.bundles.get("b-1")!, status: "DRAFT" });
    const r = await clasificar();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BUNDLE_NOT_READY");
  });

  it("un cuadernillo de otra institución no sirve", async () => {
    repo.bundles.set("b-ajeno", {
      id: "b-ajeno",
      institutionId: "inst-2",
      status: "READY",
      courseIds: ["curso-11"],
    });
    const r = await clasificar({ bundleId: "b-ajeno" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("BUNDLE_NOT_READY");
  });

  it("un cuadernillo sin formulaciones no tiene curso", async () => {
    repo.bundles.set("b-1", { ...repo.bundles.get("b-1")!, courseIds: [] });
    const r = await clasificar();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("EMPTY_BUNDLE");
  });

  it("el estudiante tiene que estar en un curso del cuadernillo", async () => {
    repo.estudiantes.set("stu-1", { institutionId: "inst-1", courseId: "curso-10" });
    const r = await clasificar();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("STUDENT_NOT_IN_COURSE");
  });

  it("si ya tiene otra hoja calificada del cuadernillo, se bloquea y se enlaza", async () => {
    repo.calificadas.push({ id: "otra", bundleId: "b-1", studentId: "stu-1", scanBatchId: "l-9" });
    const r = await clasificar();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("DUPLICATE_STUDENT");
      expect(r.error).toBeInstanceOf(EstudianteConHojaError);
      expect((r.error as EstudianteConHojaError).otraHoja).toEqual({ id: "otra", batchId: "l-9" });
    }
    expect(repo.creadas).toHaveLength(0);
  });

  it("una hoja clasificada a mano bloquea al mismo estudiante aunque aún no tenga nota", async () => {
    repo.hojas.set("h-2", { ...repo.hojas.get("h-1")!, id: "h-2" });
    expect((await clasificar()).ok).toBe(true);
    const r = await clasificar({ unclassifiedScanId: "h-2" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("DUPLICATE_STUDENT");
      expect((r.error as EstudianteConHojaError).otraHoja).toEqual({
        id: "sheet-1",
        batchId: "lote-destino",
      });
    }
    expect(repo.creadas).toHaveLength(1);
    expect(queue.jobs).toHaveLength(1);
  });

  it("si otra clasificación del mismo estudiante gana la carrera, no se encola nada", async () => {
    repo.duplicadaEnTx = { id: "rival", scanBatchId: "l-2" };
    const r = await clasificar();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("DUPLICATE_STUDENT");
      expect((r.error as EstudianteConHojaError).otraHoja).toEqual({ id: "rival", batchId: "l-2" });
    }
    expect(queue.jobs).toHaveLength(0);
  });

  it("si la cola no responde, la hoja queda creada para Reprocesar", async () => {
    queue.falla = true;
    const r = await clasificar();
    expect(r.ok).toBe(true);
    expect(repo.creadas).toHaveLength(1);
    expect(repo.noEncoladas).toEqual(["sheet-1"]);
  });
});
