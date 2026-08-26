/**
 * Tests de los use cases Load/Save/Reset del Cover HTML (PR 5 — ago 2026).
 * ========================================================================
 *
 * Mismo patrón que `cover-visual-usecases.test.ts`: repositorios
 * in-memory (sin tocar Postgres). Cubre:
 *
 *   • LoadCoverHtml   — happy path + ausencia de proyecto.
 *   • SaveCoverHtml   — permisos, isLocked, size limits, tags peligrosos.
 *   • ResetCoverHtml  — permisos, isLocked, no toca visual ni HTML override.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import { NotFoundError, ValidationError } from "@/shared/domain/result";
import {
  type Bundle,
  type BundleDetail,
  type BundleItem,
  type BundleItemDetail,
  type BundleRepository,
} from "@/modules/bundles/domain/bundle";
import {
  type CoverLiveProject,
  type CoverLiveRepository,
  type CoverLiveState,
  toCoverLiveProject,
  MalformedCoverLiveError,
  MAX_COVER_LIVE_PROJECT_BYTES,
  MIN_COVER_LIVE_PROJECT_BYTES,
} from "@/modules/cover-html/domain/cover-html";
import { LoadCoverHtml } from "@/modules/cover-html/application/load-cover-html";
import { SaveCoverHtml } from "@/modules/cover-html/application/save-cover-html";
import { ResetCoverHtml } from "@/modules/cover-html/application/reset-cover-html";
import { DEFAULT_COVER_TEMPLATE_KEY } from "@/modules/bundle-cover/domain/cover-template";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class InMemoryCoverLiveRepository implements CoverLiveRepository {
  private readonly rows = new Map<
    string,
    { project: CoverLiveProject | null; updatedAt: Date | null }
  >();

  seed(bundleId: string, project: CoverLiveProject | null, updatedAt: Date | null = null) {
    this.rows.set(bundleId, { project, updatedAt });
  }

  async loadState(institutionId: string, bundleId: string): Promise<CoverLiveState> {
    const row = this.rows.get(bundleId);
    if (!row) {
      return {
        bundleId,
        hasProject: false,
        updatedAt: null,
        fallbackKey: DEFAULT_COVER_TEMPLATE_KEY,
        fallbackSource: "BUILT_IN",
      };
    }
    return {
      bundleId,
      hasProject: row.project != null,
      updatedAt: row.updatedAt,
      fallbackKey: DEFAULT_COVER_TEMPLATE_KEY,
      fallbackSource: "BUILT_IN",
    };
  }

  async loadProject(institutionId: string, bundleId: string): Promise<CoverLiveProject | null> {
    return this.rows.get(bundleId)?.project ?? null;
  }

  async saveProject(
    institutionId: string,
    bundleId: string,
    project: CoverLiveProject,
  ): Promise<CoverLiveState> {
    const row = this.rows.get(bundleId) ?? { project: null, updatedAt: null };
    row.project = project;
    row.updatedAt = new Date();
    this.rows.set(bundleId, row);
    return this.loadState(institutionId, bundleId);
  }

  async resetProject(institutionId: string, bundleId: string): Promise<CoverLiveState> {
    this.rows.set(bundleId, { project: null, updatedAt: null });
    return this.loadState(institutionId, bundleId);
  }
}

class InMemoryBundleRepository implements BundleRepository {
  private readonly bundles = new Map<string, Bundle>();

  seed(bundle: Bundle) {
    this.bundles.set(bundle.id, bundle);
  }

  async findById(institutionId: string, id: string): Promise<Bundle | null> {
    const b = this.bundles.get(id);
    if (!b || b.institutionId !== institutionId) return null;
    return b;
  }

  async update(institutionId: string, id: string, data: Partial<Bundle>): Promise<Bundle> {
    const b = this.bundles.get(id);
    if (!b) throw new NotFoundError("Cuadernillo", id);
    const updated = { ...b, ...data };
    this.bundles.set(id, updated);
    return updated;
  }

  // Métodos no usados — lanzan si el test los invoca por error.
  async create(): Promise<Bundle> {
    throw new Error("not used");
  }
  async findDetail(): Promise<BundleDetail | null> {
    throw new Error("not used");
  }
  async findAll(): Promise<Bundle[]> {
    throw new Error("not used");
  }
  async findByCourseIds(): Promise<Bundle[]> {
    throw new Error("not used");
  }
  async delete(): Promise<void> {
    throw new Error("not used");
  }
  async listItemsOrdered(): Promise<BundleItemDetail[]> {
    throw new Error("not used");
  }
  async addItem(): Promise<BundleItem> {
    throw new Error("not used");
  }
  async removeItem(): Promise<boolean> {
    throw new Error("not used");
  }
  async reorderItems(): Promise<void> {
    throw new Error("not used");
  }
  async setStatus(): Promise<void> {
    throw new Error("not used");
  }
  async findEvaluationsByIds(): Promise<never[]> {
    throw new Error("not used");
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ecuMaster: AuthenticatedUser = {
  userId: "user-1",
  institutionId: "inst-A",
  roles: ["ECU_MASTER"],
};

const ecuLider: AuthenticatedUser = {
  userId: "user-2",
  institutionId: "inst-A",
  roles: ["ECU_LIDER"],
};

const teacher: AuthenticatedUser = {
  userId: "user-3",
  institutionId: "inst-A",
  roles: ["TEACHER"],
};

const draftBundle: Bundle = {
  id: "b1",
  institutionId: "inst-A",
  name: "Test",
  bookletNumber: 1,
  courseId: null,
  courseName: null,
  status: "DRAFT",
  theme: {},
  coverContent: null,
  createdById: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const readyBundle: Bundle = { ...draftBundle, id: "b2", status: "READY" };

function validProject(
  html = "<h1>Mi portada institucional</h1><p>Texto con padding suficiente para superar MIN.</p>",
): CoverLiveProject {
  return toCoverLiveProject({ html, previewMode: false });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Cover HTML — use cases", () => {
  let liveStates: InMemoryCoverLiveRepository;
  let bundles: InMemoryBundleRepository;

  beforeEach(() => {
    liveStates = new InMemoryCoverLiveRepository();
    bundles = new InMemoryBundleRepository();
    bundles.seed(draftBundle);
    bundles.seed(readyBundle);
  });

  // =========================================================================
  // LoadCoverHtml
  // =========================================================================

  describe("LoadCoverHtml", () => {
    it("devuelve hasProject=false y project=null si nunca se guardó", async () => {
      const uc = new LoadCoverHtml(liveStates);
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state.hasProject).toBe(false);
      expect(result.value.project).toBeNull();
    });

    it("devuelve project cuando hay HTML guardado", async () => {
      const project = validProject("<h1>Hola</h1><p>Mundo</p>");
      liveStates.seed("b1", project, new Date("2026-08-23T10:00:00Z"));

      const uc = new LoadCoverHtml(liveStates);
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state.hasProject).toBe(true);
      expect(result.value.project).toEqual(project);
    });

    it("rechaza a un TEACHER", async () => {
      const uc = new LoadCoverHtml(liveStates);
      const result = await uc.execute({ actor: teacher, bundleId: "b1" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("FORBIDDEN");
    });

    it("acepta ECU_LIDER también (manage-bundles)", async () => {
      const uc = new LoadCoverHtml(liveStates);
      const result = await uc.execute({ actor: ecuLider, bundleId: "b1" });
      expect(result.ok).toBe(true);
    });
  });

  // =========================================================================
  // SaveCoverHtml
  // =========================================================================

  describe("SaveCoverHtml", () => {
    it("guarda un HTML válido y devuelve hasProject=true", async () => {
      const uc = new SaveCoverHtml({ liveStates, bundles });
      const result = await uc.execute({
        actor: ecuMaster,
        bundleId: "b1",
        project: validProject(),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.hasProject).toBe(true);
      expect(result.value.updatedAt).toBeInstanceOf(Date);
    });

    it("rechaza a un TEACHER", async () => {
      const uc = new SaveCoverHtml({ liveStates, bundles });
      const result = await uc.execute({ actor: teacher, bundleId: "b1", project: validProject() });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("FORBIDDEN");
    });

    it("rechaza si el bundle no existe", async () => {
      const uc = new SaveCoverHtml({ liveStates, bundles });
      const result = await uc.execute({
        actor: ecuMaster,
        bundleId: "no-existe",
        project: validProject(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("rechaza si el bundle está READY (isLocked)", async () => {
      const uc = new SaveCoverHtml({ liveStates, bundles });
      const result = await uc.execute({
        actor: ecuMaster,
        bundleId: "b2",
        project: validProject(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toContain("sellado");
    });

    it("rechaza HTML demasiado pequeño (< MIN bytes)", async () => {
      // "<x></x>" pesa ~7 bytes — bajo el MIN de 50.
      const tiny = validProject("<x></x>");
      const uc = new SaveCoverHtml({ liveStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1", project: tiny });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toContain("demasiado pequeño");
      expect(MIN_COVER_LIVE_PROJECT_BYTES).toBeGreaterThan(0);
    });

    it("rechaza HTML demasiado grande (> MAX bytes)", async () => {
      // 250KB de padding supera el MAX de 200KB.
      const huge = validProject("x".repeat(250_000));
      const uc = new SaveCoverHtml({ liveStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1", project: huge });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toContain("demasiado grande");
      expect(result.error.message).toContain(String(MAX_COVER_LIVE_PROJECT_BYTES));
    });

    it("rechaza HTML con <script>", async () => {
      const evil = validProject(
        `<h1>Título de la portada</h1>
<p>Párrafo con suficiente contenido para superar el MIN de 50 bytes del size guard.</p>
<script>alert(1)</script>`,
      );
      const uc = new SaveCoverHtml({ liveStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1", project: evil });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toMatch(/script|no permitido/i);
    });

    it("rechaza HTML con javascript: url", async () => {
      const evil = validProject(
        `<h1>Portada con link malicioso</h1>
<p>Texto suficiente para superar el size guard antes del check de tags.</p>
<a href="javascript:alert(1)">click</a>`,
      );
      const uc = new SaveCoverHtml({ liveStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1", project: evil });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toContain("javascript");
    });

    it("rechaza HTML con <iframe>", async () => {
      const evil = validProject(
        `<h1>Portada con iframe embebido</h1>
<p>Texto de padding para superar el size guard antes del check de tags.</p>
<iframe src="evil.com"></iframe>`,
      );
      const uc = new SaveCoverHtml({ liveStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1", project: evil });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
    });
  });

  // =========================================================================
  // ResetCoverHtml
  // =========================================================================

  describe("ResetCoverHtml", () => {
    it("limpia el HTML live y devuelve hasProject=false", async () => {
      liveStates.seed("b1", validProject(), new Date());

      const uc = new ResetCoverHtml({ liveStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.hasProject).toBe(false);
      expect(result.value.updatedAt).toBeNull();

      const after = await liveStates.loadProject("inst-A", "b1");
      expect(after).toBeNull();
    });

    it("rechaza a un TEACHER", async () => {
      const uc = new ResetCoverHtml({ liveStates, bundles });
      const result = await uc.execute({ actor: teacher, bundleId: "b1" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("FORBIDDEN");
    });

    it("rechaza si el bundle está READY (isLocked)", async () => {
      const uc = new ResetCoverHtml({ liveStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b2" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toContain("sellado");
    });

    it("rechaza si el bundle no existe", async () => {
      const uc = new ResetCoverHtml({ liveStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "no-existe" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  // =========================================================================
  // Sanity: MalformedCoverLiveError + ValidationError tienen el code correcto
  // =========================================================================

  it("MalformedCoverLiveError tiene el code correcto", () => {
    const err = new MalformedCoverLiveError("test");
    expect(err.code).toBe("MALFORMED_COVER_LIVE");
    expect(err.name).toBe("MalformedCoverLiveError");
  });

  it("ValidationError tiene el code correcto", () => {
    const err = new ValidationError("test");
    expect(err.code).toBe("VALIDATION");
  });
});
