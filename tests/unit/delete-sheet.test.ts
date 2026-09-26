/**
 * DeleteSheet — use case de eliminación de hoja escaneada.
 *
 * Reglas validadas (en orden):
 *   1. Rol: TEACHER | ECU_LIDER. ECU_MASTER NO está contemplado (la
 *      lista de lotes del docente no les muestra cosas); si lo prueba,
 *      el use case devuelve FORBIDDEN.
 *   2. Batch existe y es de la institución del actor. Si no → NOT_FOUND
 *      (no leak de ids de otras instituciones).
 *   3. Actor tiene acceso al batch (filtro multi-target idéntico al de
 *      getBatchesAction:254): dueño de evaluation / bundle institucional /
 *      uploadedBy para unclassified. Si no → FORBIDDEN.
 *   4. Hoja existe en la institución del actor. Si no → NOT_FOUND.
 *   5. Hoja en REVIEW. Si no → INVALID_STATE.
 *   6. deleteSheet corrobora el status (defensa final) y borra.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/test";
  process.env.AUTH_SECRET = "test-auth-secret-1234567890123";
  process.env.QR_SIGNING_SECRET = "test-secret-at-least-16-chars!!";
});

import type { ScanningRepository } from "@/modules/scanning/domain/answer-sheet";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import { DeleteSheet } from "@/modules/scanning/application/delete-sheet";

const TEACHER: AuthenticatedUser = {
  userId: "user-teacher",
  institutionId: "inst-1",
  roles: ["TEACHER"],
};
const OTHER_TEACHER: AuthenticatedUser = {
  userId: "user-other",
  institutionId: "inst-1",
  roles: ["TEACHER"],
};
const ECU_LIDER: AuthenticatedUser = {
  userId: "user-lider",
  institutionId: "inst-1",
  roles: ["ECU_LIDER"],
};
const ECU_MASTER: AuthenticatedUser = {
  userId: "user-master",
  institutionId: "inst-1",
  roles: ["ECU_MASTER"],
};
const OTHER_INST: AuthenticatedUser = {
  userId: "user-teacher",
  institutionId: "inst-2",
  roles: ["TEACHER"],
};

interface BatchAccessSeed {
  institutionId: string;
  uploadedBy: string;
  evaluation?: { teacherId: string } | null;
  bundle?: { institutionId: string } | null;
}

function makeRepo(
  opts: {
    batches?: Map<string, BatchAccessSeed>;
    sheets?: Map<
      string,
      {
        institutionId: string;
        status: "PENDING" | "SCANNED" | "PROCESSING" | "GRADED" | "REVIEW" | "COMPLETED";
        scanBatchId: string | null;
        scannedImage: string | null;
        processedImage: string | null;
      }
    >;
  } = {},
) {
  const batches = opts.batches ?? new Map<string, BatchAccessSeed>();
  const sheets = opts.sheets ?? new Map();
  const deletes: string[] = [];
  const errors: string[] = [];
  const audits: Array<{
    actorUserId: string;
    actorRoles: readonly string[];
    action: string;
    entityType: string;
    entityId: string;
    entityShortId: string;
    metadata?: Record<string, unknown>;
  }> = [];

  const repo: ScanningRepository = {
    async getScanBatch() {
      return null;
    },
    async getAnswerSheet(_i, sheetId) {
      const s = sheets.get(sheetId);
      if (!s) return null;
      return {
        id: sheetId,
        institutionId: s.institutionId,
        evaluationId: null,
        bundleId: null,
        scanBatchId: s.scanBatchId,
        studentId: null,
        studentName: null,
        studentCode: null,
        qrContent: "",
        qrSignature: "",
        scannedImage: s.scannedImage,
        status: s.status,
        score: null,
        totalCorrect: null,
        totalQuestions: null,
      };
    },
    async updateSheetStatus() {},
    async saveDecodedQr() {
      return { studentId: null, duplicada: false };
    },
    async findSheetIdByQrSheetUuid() {
      return null;
    },
    async saveAnswers() {},
    async updateBatchProgress() {},
    async findBatchAccess(batchId) {
      const b = batches.get(batchId);
      if (!b) return null;
      return {
        institutionId: b.institutionId,
        uploadedBy: b.uploadedBy,
        evaluation: b.evaluation ?? null,
        bundle: b.bundle ?? null,
      };
    },
    async deleteSheet(sheetId) {
      const s = sheets.get(sheetId);
      if (!s) return { batchId: null };
      if (s.status !== "REVIEW") {
        // Defensa final del repo: no borrar fuera de REVIEW aunque el use
        // case haya fallado en chequear. Para los tests ASSERT este
        // mensaje: si llegamos acá, fue porque el use case NO bloqueó a
        // tiempo.
        errors.push(`deleteSheet aceptó hoja no-REVIEW: ${sheetId}/${s.status}`);
        throw new Error(`deleteSheet rechazó la hoja ${sheetId}: status=${s.status}`);
      }
      deletes.push(sheetId);
      const batchId = s.scanBatchId;
      sheets.delete(sheetId);
      return { batchId };
    },
    async deleteBatch(_batchId) {
      return { institutionId: null };
    },
    async recordDeletionAudit(input) {
      audits.push(input);
    },
  };

  return { repo, batches, sheets, deletes, errors, audits };
}

describe("DeleteSheet — permisos y validaciones", () => {
  it("REVIEW + dueño (TEACHER del evaluation) → ok y delete llamado", async () => {
    const { repo, batches, sheets, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-1",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId,
            evaluation: { teacherId: TEACHER.userId },
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-1",
          {
            institutionId: "inst-1",
            status: "REVIEW",
            scanBatchId: "batch-1",
            scannedImage: "scans/batch-1/sheet_001.png",
            processedImage: null,
          },
        ],
      ]),
    });
    void batches;

    const useCase = new DeleteSheet(repo);
    const r = await useCase.execute({
      actor: TEACHER,
      batchId: "batch-1",
      sheetId: "sheet-1",
    });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.batchId).toBe("batch-1");
    expect(deletes).toEqual(["sheet-1"]);
    expect(sheets.has("sheet-1")).toBe(false);
  });

  it("ECU_LIDER puede borrar de un batch de bundle institucional (no es dueño)", async () => {
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-b",
          {
            institutionId: "inst-1",
            uploadedBy: "otro-docente",
            // batch de bundle → owner es la institución, no un docente.
            evaluation: null,
            bundle: { institutionId: "inst-1" },
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-b",
          {
            institutionId: "inst-1",
            status: "REVIEW",
            scanBatchId: "batch-b",
            scannedImage: null,
            processedImage: null,
          },
        ],
      ]),
    });

    const useCase = new DeleteSheet(repo);
    const r = await useCase.execute({
      actor: ECU_LIDER,
      batchId: "batch-b",
      sheetId: "sheet-b",
    });

    expect(r.ok).toBe(true);
    expect(deletes).toEqual(["sheet-b"]);
  });

  it("GRADED → INVALID_STATE (no se borra)", async () => {
    const { repo, deletes, errors } = makeRepo({
      batches: new Map([
        [
          "batch-1",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId,
            evaluation: { teacherId: TEACHER.userId },
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-1",
          {
            institutionId: "inst-1",
            status: "GRADED",
            scanBatchId: "batch-1",
            scannedImage: null,
            processedImage: null,
          },
        ],
      ]),
    });

    const useCase = new DeleteSheet(repo);
    const r = await useCase.execute({
      actor: TEACHER,
      batchId: "batch-1",
      sheetId: "sheet-1",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("INVALID_STATE");
      expect(r.error.message).toMatch(/revisi/i);
    }
    expect(deletes).toEqual([]);
    expect(errors).toEqual([]); // la defensa del repo no se disparó
  });

  it("Otro TEACHER (no dueño) sobre evaluation ajeno → FORBIDDEN", async () => {
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-1",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId,
            evaluation: { teacherId: TEACHER.userId }, // dueño: TEACHER
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-1",
          {
            institutionId: "inst-1",
            status: "REVIEW",
            scanBatchId: "batch-1",
            scannedImage: null,
            processedImage: null,
          },
        ],
      ]),
    });

    const useCase = new DeleteSheet(repo);
    const r = await useCase.execute({
      actor: OTHER_TEACHER, // no es el dueño
      batchId: "batch-1",
      sheetId: "sheet-1",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(deletes).toEqual([]);
  });

  it("Batch de otra institución → NOT_FOUND (no leak)", async () => {
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-1",
          {
            institutionId: "inst-2", // otra institución
            uploadedBy: "cualquiera",
            evaluation: { teacherId: "cualquiera" },
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-1",
          {
            institutionId: "inst-2",
            status: "REVIEW",
            scanBatchId: "batch-1",
            scannedImage: null,
            processedImage: null,
          },
        ],
      ]),
    });

    const useCase = new DeleteSheet(repo);
    const r = await useCase.execute({
      actor: TEACHER, // inst-1
      batchId: "batch-1",
      sheetId: "sheet-1",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
    expect(deletes).toEqual([]);
  });

  it("Batch inexistente → NOT_FOUND", async () => {
    const { repo, deletes } = makeRepo();

    const useCase = new DeleteSheet(repo);
    const r = await useCase.execute({
      actor: TEACHER,
      batchId: "no-existe",
      sheetId: "no-importa",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
    expect(deletes).toEqual([]);
  });

  it("Hoja inexistente (batch válido) → NOT_FOUND", async () => {
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-1",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId,
            evaluation: { teacherId: TEACHER.userId },
          },
        ],
      ]),
      sheets: new Map(),
    });

    const useCase = new DeleteSheet(repo);
    const r = await useCase.execute({
      actor: TEACHER,
      batchId: "batch-1",
      sheetId: "no-existe",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
    expect(deletes).toEqual([]);
  });

  it("ECU_MASTER → FORBIDDEN (no está en los roles permitidos para esta acción)", async () => {
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-1",
          {
            institutionId: "inst-1",
            uploadedBy: ECU_MASTER.userId,
            evaluation: null,
            bundle: { institutionId: "inst-1" },
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-1",
          {
            institutionId: "inst-1",
            status: "REVIEW",
            scanBatchId: "batch-1",
            scannedImage: null,
            processedImage: null,
          },
        ],
      ]),
    });

    const useCase = new DeleteSheet(repo);
    const r = await useCase.execute({
      actor: ECU_MASTER,
      batchId: "batch-1",
      sheetId: "sheet-1",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(deletes).toEqual([]);
  });

  it("Batch unclassified (sin evaluation/bundle): sólo el uploader puede borrar", async () => {
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-u",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId, // TEACHER lo subió
            evaluation: null,
            bundle: null,
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-u",
          {
            institutionId: "inst-1",
            status: "REVIEW",
            scanBatchId: "batch-u",
            scannedImage: null,
            processedImage: null,
          },
        ],
      ]),
    });

    // TEACHER (uploader) → ok.
    let r = await new DeleteSheet(repo).execute({
      actor: TEACHER,
      batchId: "batch-u",
      sheetId: "sheet-u",
    });
    expect(r.ok).toBe(true);
    expect(deletes).toEqual(["sheet-u"]);

    // Re-seed para el segundo escenario.
    const {
      repo: repo2,
      deletes: deletes2,
      sheets: sheets2,
    } = makeRepo({
      batches: new Map([
        [
          "batch-u",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId,
            evaluation: null,
            bundle: null,
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-u2",
          {
            institutionId: "inst-1",
            status: "REVIEW",
            scanBatchId: "batch-u",
            scannedImage: null,
            processedImage: null,
          },
        ],
      ]),
    });
    void sheets2;

    // OTHER_TEACHER (no uploader) → FORBIDDEN.
    r = await new DeleteSheet(repo2).execute({
      actor: OTHER_TEACHER,
      batchId: "batch-u",
      sheetId: "sheet-u2",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(deletes2).toEqual([]);
  });

  it("Misma hoja, distinta institución del actor → NOT_FOUND", async () => {
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-1",
          {
            institutionId: "inst-2",
            uploadedBy: OTHER_INST.userId,
            evaluation: { teacherId: OTHER_INST.userId },
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-1",
          {
            institutionId: "inst-2",
            status: "REVIEW",
            scanBatchId: "batch-1",
            scannedImage: null,
            processedImage: null,
          },
        ],
      ]),
    });

    const useCase = new DeleteSheet(repo);
    const r = await useCase.execute({
      actor: TEACHER, // inst-1
      batchId: "batch-1",
      sheetId: "sheet-1",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
    expect(deletes).toEqual([]);
  });

  it("REVIEW + dueño → registra audit log con actor, action y metadata correctos", async () => {
    const { repo, audits } = makeRepo({
      batches: new Map([
        [
          "batch-1",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId,
            evaluation: { teacherId: TEACHER.userId },
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-audit",
          {
            institutionId: "inst-1",
            status: "REVIEW",
            scanBatchId: "batch-1",
            scannedImage: null,
            processedImage: null,
          },
        ],
      ]),
    });

    await new DeleteSheet(repo).execute({
      actor: TEACHER,
      batchId: "batch-1",
      sheetId: "sheet-audit",
    });

    expect(audits).toHaveLength(1);
    const audit = audits[0]!;
    expect(audit.actorUserId).toBe(TEACHER.userId);
    expect(audit.actorRoles).toEqual(["TEACHER"]);
    expect(audit.action).toBe("SHEET_DELETED");
    expect(audit.entityType).toBe("AnswerSheet");
    expect(audit.entityId).toBe("sheet-audit");
    expect(audit.entityShortId).toBe("sheet-au");
  });

  it("GRADED → NO se registra audit log (no hubo borrado)", async () => {
    const { repo, audits } = makeRepo({
      batches: new Map([
        [
          "batch-1",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId,
            evaluation: { teacherId: TEACHER.userId },
          },
        ],
      ]),
      sheets: new Map([
        [
          "sheet-1",
          {
            institutionId: "inst-1",
            status: "GRADED",
            scanBatchId: "batch-1",
            scannedImage: null,
            processedImage: null,
          },
        ],
      ]),
    });

    await new DeleteSheet(repo).execute({
      actor: TEACHER,
      batchId: "batch-1",
      sheetId: "sheet-1",
    });

    expect(audits).toEqual([]);
  });
});
