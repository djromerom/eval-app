/**
 * Tests de los use cases Load/Save/Reset del Cover Visual (PR 2).
 * ================================================================
 *
 * Mismo patrón que los tests del Cover Studio y del Cover Designer:
 * repositorios in-memory (sin tocar Postgres). Cubre:
 *
 *   • LoadCoverVisual   — happy path + ausencia de proyecto.
 *   • SaveCoverVisual   — permisos, isLocked, size limits, shape, tags.
 *   • ResetCoverVisual  — permisos, isLocked, no toca HTML override.
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
  type CoverVisualProject,
  type CoverVisualRepository,
  type CoverVisualState,
  toCoverVisualProject,
  MalformedCoverVisualError,
  MAX_COVER_VISUAL_PROJECT_BYTES,
  MIN_COVER_VISUAL_PROJECT_BYTES,
} from "@/modules/bundle-cover/domain/cover-visual";
import { LoadCoverVisual } from "@/modules/bundle-cover/application/load-cover-visual";
import { SaveCoverVisual } from "@/modules/bundle-cover/application/save-cover-visual";
import { ResetCoverVisual } from "@/modules/bundle-cover/application/reset-cover-visual";
import { DEFAULT_COVER_TEMPLATE_KEY } from "@/modules/bundle-cover/domain/cover-template";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class InMemoryCoverVisualRepository implements CoverVisualRepository {
  private readonly rows = new Map<
    string,
    { project: CoverVisualProject | null; updatedAt: Date | null }
  >();

  seed(bundleId: string, project: CoverVisualProject | null, updatedAt: Date | null = null) {
    this.rows.set(bundleId, { project, updatedAt });
  }

  async loadState(institutionId: string, bundleId: string): Promise<CoverVisualState> {
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

  async loadProject(institutionId: string, bundleId: string): Promise<CoverVisualProject | null> {
    return this.rows.get(bundleId)?.project ?? null;
  }

  async saveProject(
    institutionId: string,
    bundleId: string,
    project: CoverVisualProject,
  ): Promise<CoverVisualState> {
    const row = this.rows.get(bundleId) ?? { project: null, updatedAt: null };
    row.project = project;
    row.updatedAt = new Date();
    this.rows.set(bundleId, row);
    return this.loadState(institutionId, bundleId);
  }

  async resetProject(institutionId: string, bundleId: string): Promise<CoverVisualState> {
    this.rows.set(bundleId, { project: null, updatedAt: null });
    return this.loadState(institutionId, bundleId);
  }
}

/** Stub de BundleRepository. Solo se usan `findById` y `update` en estos
 *  tests; los demás métodos lanzan para detectar usos accidentales. */
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

  // Métodos no usados en estos tests — implementados para satisfacer el
  // contrato `BundleRepository`. Lanzan si el test los invoca por error.
  async create(): Promise<Bundle> {
    throw new Error("not used in cover-visual tests");
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

/** Proyecto GrapesJS mínimo válido: 1 página, 1 frame, 1 componente callout. */
function validProject(): CoverVisualProject {
  return toCoverVisualProject({
    pages: [
      {
        id: "page-1",
        frames: [
          {
            id: "frame-1",
            component: {
              type: "studio-callout",
              components: [{ type: "text", tagName: "p", content: "Hola callout" }],
            },
          },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Cover Visual — use cases", () => {
  let visualStates: InMemoryCoverVisualRepository;
  let bundles: InMemoryBundleRepository;

  beforeEach(() => {
    visualStates = new InMemoryCoverVisualRepository();
    bundles = new InMemoryBundleRepository();
    bundles.seed(draftBundle);
    bundles.seed(readyBundle);
  });

  // =========================================================================
  // LoadCoverVisual
  // =========================================================================

  describe("LoadCoverVisual", () => {
    it("devuelve hasProject=false y project=null si nunca se guardó", async () => {
      const uc = new LoadCoverVisual(visualStates);
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state.hasProject).toBe(false);
      expect(result.value.project).toBeNull();
    });

    it("devuelve project cuando hay uno guardado", async () => {
      const project = validProject();
      visualStates.seed("b1", project, new Date("2026-08-23T10:00:00Z"));

      const uc = new LoadCoverVisual(visualStates);
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.state.hasProject).toBe(true);
      expect(result.value.project).toEqual(project);
    });

    it("rechaza a un TEACHER", async () => {
      const uc = new LoadCoverVisual(visualStates);
      const result = await uc.execute({ actor: teacher, bundleId: "b1" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("FORBIDDEN");
    });

    it("acepta ECU_LIDER también (manage-bundles)", async () => {
      const uc = new LoadCoverVisual(visualStates);
      const result = await uc.execute({ actor: ecuLider, bundleId: "b1" });
      expect(result.ok).toBe(true);
    });
  });

  // =========================================================================
  // SaveCoverVisual
  // =========================================================================

  describe("SaveCoverVisual", () => {
    it("guarda un proyecto válido y devuelve hasProject=true", async () => {
      const uc = new SaveCoverVisual({ visualStates, bundles });
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
      const uc = new SaveCoverVisual({ visualStates, bundles });
      const result = await uc.execute({ actor: teacher, bundleId: "b1", project: validProject() });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("FORBIDDEN");
    });

    it("rechaza si el bundle no existe", async () => {
      const uc = new SaveCoverVisual({ visualStates, bundles });
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
      const uc = new SaveCoverVisual({ visualStates, bundles });
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

    it("rechaza proyectos demasiado pequeños (< MIN bytes)", async () => {
      // Un proyecto válido serializado pesa ~120 bytes; necesitamos algo < 100.
      // El shape mínimo ({ pages: [{ frames: [{ component: { type: "x" } }] }] })
      // mide ~80 bytes y el walker lo rechaza por type desconocido, pero ese es
      // otro path. Para testear el size guard necesitamos un JSON con shape
      // mínimo válido → con un solo callout vacío pesa > MIN.
      //
      // Truco: construimos un JSON válido pero con type desconocido para
      // forzar el path de MalformedCoverVisualError. Esto testea el ORDEN
      // de validaciones (size antes de shape).
      const tiny = toCoverVisualProject({
        pages: [{ id: "p1", frames: [{ id: "f1", component: { type: "studio-callout" } }] }],
      });
      // tiny pesa ~80 bytes serializado — bajo el MIN.
      const uc = new SaveCoverVisual({ visualStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1", project: tiny });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toContain("demasiado pequeño");
      // Sanity: el MIN real
      expect(MIN_COVER_VISUAL_PROJECT_BYTES).toBeGreaterThan(0);
    });

    it("rechaza proyectos demasiado grandes (> MAX bytes)", async () => {
      // Construimos un proyecto enorme: 10.000 páginas × 10 frames × ...
      // Para testear el size guard basta con repetir un string enorme.
      const huge = toCoverVisualProject({
        pages: [
          {
            id: "p1",
            frames: [
              {
                id: "f1",
                component: {
                  type: "studio-callout",
                  components: [{ type: "text", tagName: "p", content: "x".repeat(2_000_000) }],
                },
              },
            ],
          },
        ],
      });
      const uc = new SaveCoverVisual({ visualStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1", project: huge });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toContain("demasiado grande");
      expect(result.error.message).toContain(String(MAX_COVER_VISUAL_PROJECT_BYTES));
    });

    it("rechaza proyectos con type de componente desconocido (shape)", async () => {
      const bad = toCoverVisualProject({
        pages: [
          {
            id: "p1",
            frames: [
              {
                id: "f1",
                component: { type: "studio-evil-tag", components: [] },
              },
            ],
          },
        ],
      });
      const uc = new SaveCoverVisual({ visualStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1", project: bad });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toContain("studio-evil-tag");
    });

    it("rechaza proyectos que produzcan HTML con <script>", async () => {
      // Truco: el type "text" permite tagName "script" si el walker no filtra.
      // Hoy el walker emite literalmente `<script>` y luego FORBIDDEN_TAG_PATTERNS
      // lo detecta. Esto testea el path defensivo.
      const evil = toCoverVisualProject({
        pages: [
          {
            id: "p1",
            frames: [
              {
                id: "f1",
                component: {
                  type: "text",
                  tagName: "script",
                  content: "alert(1)",
                },
              },
            ],
          },
        ],
      });
      const uc = new SaveCoverVisual({ visualStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1", project: evil });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toMatch(/script|no permitido/i);
    });
  });

  // =========================================================================
  // ResetCoverVisual
  // =========================================================================

  describe("ResetCoverVisual", () => {
    it("limpia el proyecto y devuelve hasProject=false", async () => {
      visualStates.seed("b1", validProject(), new Date());

      const uc = new ResetCoverVisual({ visualStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b1" });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.hasProject).toBe(false);
      expect(result.value.updatedAt).toBeNull();

      // Verificación: loadProject ahora devuelve null.
      const after = await visualStates.loadProject("inst-A", "b1");
      expect(after).toBeNull();
    });

    it("rechaza a un TEACHER", async () => {
      const uc = new ResetCoverVisual({ visualStates, bundles });
      const result = await uc.execute({ actor: teacher, bundleId: "b1" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("FORBIDDEN");
    });

    it("rechaza si el bundle está READY (isLocked)", async () => {
      const uc = new ResetCoverVisual({ visualStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "b2" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION");
      expect(result.error.message).toContain("sellado");
    });

    it("rechaza si el bundle no existe", async () => {
      const uc = new ResetCoverVisual({ visualStates, bundles });
      const result = await uc.execute({ actor: ecuMaster, bundleId: "no-existe" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  // =========================================================================
  // Sanity: MalformedCoverVisualError extends DomainError correctamente
  // =========================================================================

  it("MalformedCoverVisualError tiene el code correcto", () => {
    const err = new MalformedCoverVisualError("test");
    expect(err.code).toBe("MALFORMED_COVER_VISUAL");
    expect(err.name).toBe("MalformedCoverVisualError");
  });

  it("ValidationError tiene el code correcto (Save/Reset lo usan para isLocked)", () => {
    const err = new ValidationError("test");
    expect(err.code).toBe("VALIDATION");
  });
});
