/**
 * DeleteBatch — use case de eliminación de lote entero.
 *
 * Reglas validadas (en orden):
 *   1. Rol: TEACHER | ECU_LIDER. ECU_MASTER NO está contemplado.
 *   2. Batch existe y es de la institución del actor. Si no → NOT_FOUND.
 *   3. Actor tiene acceso al batch (filtro multi-target idéntico al de
 *      getBatchesAction:254): dueño de evaluation / bundle institucional /
 *      uploadedBy para unclassified. Si no → FORBIDDEN.
 *   4. deleteBatch borra fila + archivos físicos + cascade.
 *
 * Decisión de diseño: NO se valida el estado del lote. El docente
 * aceptó que se borren incluso lotes con hojas GRADED.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://localhost:5432/test";
  process.env.AUTH_SECRET = "test-auth-secret-1234567890123";
  process.env.QR_SIGNING_SECRET = "test-secret-at-least-16-chars!!";
});

import type { ScanningRepository } from "@/modules/scanning/domain/answer-sheet";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";
import { DeleteBatch } from "@/modules/scanning/application/delete-batch";

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
const OTHER_INST_LIDER: AuthenticatedUser = {
  userId: "user-lider",
  institutionId: "inst-2",
  roles: ["ECU_LIDER"],
};

interface BatchAccessSeed {
  institutionId: string;
  uploadedBy: string;
  evaluation?: { teacherId: string } | null;
  bundle?: { institutionId: string } | null;
}

function makeRepo(opts: { batches?: Map<string, BatchAccessSeed> } = {}) {
  const batches = opts.batches ?? new Map<string, BatchAccessSeed>();
  const deletes: string[] = [];
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
    async getAnswerSheet() {
      return null;
    },
    async updateSheetStatus() {},
    async saveDecodedQr() {
      return { studentId: null, duplicada: false };
    },
    async findSheetIdByQrSheetUuid() {
      return null;
    },
    async findDuplicateSheet() {
      return null;
    },
    async saveAnswers() {},
    async updateBatchProgress() {},
    async deleteSheet(_sheetId) {
      return { batchId: null };
    },
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
    async deleteBatch(batchId) {
      const b = batches.get(batchId);
      if (!b) return { institutionId: null };
      deletes.push(batchId);
      batches.delete(batchId);
      return { institutionId: b.institutionId };
    },
    async recordDeletionAudit(input) {
      audits.push(input);
    },
  };

  return { repo, batches, deletes, audits };
}

describe("DeleteBatch — permisos y validaciones", () => {
  it("TEACHER dueño (evaluation) → ok y delete llamado", async () => {
    const { repo, batches, deletes } = makeRepo({
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
    });
    void batches;

    const useCase = new DeleteBatch(repo);
    const r = await useCase.execute({ actor: TEACHER, batchId: "batch-1" });

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.batchId).toBe("batch-1");
    expect(deletes).toEqual(["batch-1"]);
  });

  it("ECU_LIDER mismo institution + bundle → ok (institucional, no dueño)", async () => {
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-b",
          {
            institutionId: "inst-1",
            uploadedBy: "otro-docente",
            evaluation: null,
            bundle: { institutionId: "inst-1" },
          },
        ],
      ]),
    });

    const useCase = new DeleteBatch(repo);
    const r = await useCase.execute({ actor: ECU_LIDER, batchId: "batch-b" });

    expect(r.ok).toBe(true);
    expect(deletes).toEqual(["batch-b"]);
  });

  it("TEACHER dueño con hojas GRADED → ok (no se filtra por estado)", async () => {
    // El use case NO pregunta al repo cuántas hojas hay ni en qué estado
    // están — el docente aceptó "cualquier estado". El borrado es total.
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-graded",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId,
            evaluation: { teacherId: TEACHER.userId },
          },
        ],
      ]),
    });

    const useCase = new DeleteBatch(repo);
    const r = await useCase.execute({
      actor: TEACHER,
      batchId: "batch-graded",
    });

    expect(r.ok).toBe(true);
    expect(deletes).toEqual(["batch-graded"]);
  });

  it("Otro TEACHER (no dueño) sobre evaluation ajeno → FORBIDDEN", async () => {
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
    });

    const useCase = new DeleteBatch(repo);
    const r = await useCase.execute({
      actor: OTHER_TEACHER,
      batchId: "batch-1",
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
            institutionId: "inst-2",
            uploadedBy: "cualquiera",
            evaluation: { teacherId: "cualquiera" },
          },
        ],
      ]),
    });

    const useCase = new DeleteBatch(repo);
    const r = await useCase.execute({ actor: TEACHER, batchId: "batch-1" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
    expect(deletes).toEqual([]);
  });

  it("ECU_LIDER de OTRA institución → NOT_FOUND (mismo path que TEACHER otra inst)", async () => {
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-1",
          {
            institutionId: "inst-1",
            uploadedBy: "cualquiera",
            // Bundle de inst-1 — pero el actor es de inst-2.
            evaluation: null,
            bundle: { institutionId: "inst-1" },
          },
        ],
      ]),
    });

    const useCase = new DeleteBatch(repo);
    const r = await useCase.execute({
      actor: OTHER_INST_LIDER,
      batchId: "batch-1",
    });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
    expect(deletes).toEqual([]);
  });

  it("ECU_MASTER → FORBIDDEN (no está en los roles permitidos)", async () => {
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
    });

    const useCase = new DeleteBatch(repo);
    const r = await useCase.execute({ actor: ECU_MASTER, batchId: "batch-1" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN");
    expect(deletes).toEqual([]);
  });

  it("Batch vacío (0 hojas, 0 unclassified) → ok (no se filtra por tamaño)", async () => {
    // Un lote que se creó por error y quedó vacío tiene que poder limpiarse.
    // El use case no pregunta "tiene hojas?" antes de borrar.
    const { repo, deletes } = makeRepo({
      batches: new Map([
        [
          "batch-empty",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId,
            evaluation: { teacherId: TEACHER.userId },
          },
        ],
      ]),
    });

    const useCase = new DeleteBatch(repo);
    const r = await useCase.execute({
      actor: TEACHER,
      batchId: "batch-empty",
    });

    expect(r.ok).toBe(true);
    expect(deletes).toEqual(["batch-empty"]);
  });

  it("TEACHER dueño → registra audit log con action BATCH_DELETED y entityType ScanBatch", async () => {
    const { repo, audits } = makeRepo({
      batches: new Map([
        [
          "batch-audit",
          {
            institutionId: "inst-1",
            uploadedBy: TEACHER.userId,
            evaluation: { teacherId: TEACHER.userId },
          },
        ],
      ]),
    });

    await new DeleteBatch(repo).execute({
      actor: TEACHER,
      batchId: "batch-audit",
    });

    expect(audits).toHaveLength(1);
    const audit = audits[0]!;
    expect(audit.actorUserId).toBe(TEACHER.userId);
    expect(audit.actorRoles).toEqual(["TEACHER"]);
    expect(audit.action).toBe("BATCH_DELETED");
    expect(audit.entityType).toBe("ScanBatch");
    expect(audit.entityId).toBe("batch-audit");
    expect(audit.entityShortId).toBe("batch-au");
  });

  it("ECU_LIDER mismo institution + bundle → registra audit log", async () => {
    const { repo, audits } = makeRepo({
      batches: new Map([
        [
          "batch-b",
          {
            institutionId: "inst-1",
            uploadedBy: "otro-docente",
            evaluation: null,
            bundle: { institutionId: "inst-1" },
          },
        ],
      ]),
    });

    await new DeleteBatch(repo).execute({
      actor: ECU_LIDER,
      batchId: "batch-b",
    });

    expect(audits).toHaveLength(1);
    const audit = audits[0]!;
    expect(audit.actorUserId).toBe(ECU_LIDER.userId);
    expect(audit.actorRoles).toEqual(["ECU_LIDER"]);
    expect(audit.action).toBe("BATCH_DELETED");
  });

  it("FORBIDDEN → NO se registra audit log (no hubo borrado)", async () => {
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
    });

    await new DeleteBatch(repo).execute({
      actor: OTHER_TEACHER, // no es dueño
      batchId: "batch-1",
    });

    expect(audits).toEqual([]);
  });
});
