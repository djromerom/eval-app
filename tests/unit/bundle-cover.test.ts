import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_COVER_TEMPLATE_BODY_BYTES,
  MIN_COVER_TEMPLATE_BODY_BYTES,
  toCoverTemplateKey,
  type CoverTemplateKey,
  type CoverTemplateLoader,
  type CoverTemplateRepository,
  type CoverTemplateState,
  DEFAULT_COVER_TEMPLATE_KEY,
} from "@/modules/bundle-cover/domain/cover-template";
import { NotFoundError } from "@/shared/domain/result";
import { ChangeCoverTemplateKey } from "@/modules/bundle-cover/application/change-cover-template-key";
import { LoadCoverDesigner } from "@/modules/bundle-cover/application/load-cover-designer";
import { PreviewCover } from "@/modules/bundle-cover/application/preview-cover";
import { ResetCoverTemplate } from "@/modules/bundle-cover/application/reset-cover-template";
import { SaveCoverTemplate } from "@/modules/bundle-cover/application/save-cover-template";
import { BuildCoverContext } from "@/modules/bundle-cover/application/cover-context";
import { RenderCover } from "@/modules/bundle-cover/application/render-cover";
import { RenderCoverVisual } from "@/modules/bundle-cover/application/render-cover-visual";
import type {
  CoverVisualProject,
  CoverVisualRepository,
  CoverVisualState,
} from "@/modules/bundle-cover/domain/cover-visual";
import type {
  Bundle,
  BundleDetail,
  BundleItem,
  BundleItemDetail,
  BundleRepository,
} from "@/modules/bundles/domain/bundle";
import type { Institution, InstitutionRepository } from "@/modules/institutions/domain/institution";
import type { AuthenticatedUser } from "@/shared/application/authenticated-user";

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

class InMemoryCoverTemplateRepository implements CoverTemplateRepository {
  /** key: bundleId → body override + key + updatedAt. */
  private readonly rows = new Map<
    string,
    { key: CoverTemplateKey | null; body: string | null; updatedAt: Date | null }
  >();

  /** Configura un bundle con overrides en el test. */
  seed(
    bundleId: string,
    key: CoverTemplateKey | null,
    body: string | null,
    updatedAt: Date | null = null,
  ) {
    this.rows.set(bundleId, { key, body, updatedAt });
  }

  async loadState(institutionId: string, bundleId: string): Promise<CoverTemplateState> {
    const row = this.rows.get(bundleId);
    if (!row) throw new NotFoundError("Bundle", bundleId);
    const effectiveKey = row.key ?? DEFAULT_COVER_TEMPLATE_KEY;
    const hasOverride = row.body != null && row.body.length > 0;
    return {
      bundleId,
      key: effectiveKey,
      source: hasOverride ? "OVERRIDE" : "BUILT_IN",
      hasOverride,
      updatedAt: row.updatedAt,
    };
  }

  async loadBody(institutionId: string, bundleId: string): Promise<string | null> {
    const row = this.rows.get(bundleId);
    if (!row) throw new NotFoundError("Bundle", bundleId);
    return row.body;
  }

  async saveOverride(
    institutionId: string,
    bundleId: string,
    body: string,
  ): Promise<CoverTemplateState> {
    const row = this.rows.get(bundleId);
    if (!row) throw new NotFoundError("Bundle", bundleId);
    row.body = body;
    row.updatedAt = new Date();
    return this.loadState(institutionId, bundleId);
  }

  async resetOverride(institutionId: string, bundleId: string): Promise<CoverTemplateState> {
    const row = this.rows.get(bundleId);
    if (!row) throw new NotFoundError("Bundle", bundleId);
    row.body = null;
    row.updatedAt = null;
    return this.loadState(institutionId, bundleId);
  }

  async setKey(
    institutionId: string,
    bundleId: string,
    key: CoverTemplateKey | null,
  ): Promise<CoverTemplateState> {
    const row = this.rows.get(bundleId);
    if (!row) throw new NotFoundError("Bundle", bundleId);
    row.key = key;
    return this.loadState(institutionId, bundleId);
  }
}

class InMemoryCoverTemplateLoader implements CoverTemplateLoader {
  private readonly store = new Map<CoverTemplateKey, string>();

  seed(key: CoverTemplateKey, body: string) {
    this.store.set(key, body);
  }

  async loadBuiltIn(key: CoverTemplateKey): Promise<string> {
    const body = this.store.get(key);
    if (!body) throw new NotFoundError("Plantilla de portada", key);
    return body;
  }

  async listAvailableKeys(): Promise<CoverTemplateKey[]> {
    return [...this.store.keys()].sort();
  }
}

/**
 * Stub minimalista del CoverVisualRepository para los tests de
 * PreviewCover en este archivo. Por defecto no hay proyecto visual
 * (loadProject → null), así que PreviewCover cae al camino tradicional
 * (built-in / HTML override). Si un test quiere probar el branch del
 * visual, hace `visualStates.seed(...)` con un JSON.
 */
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
      // Estado "vacío" sin sembrar = hasProject=false.
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

class InMemoryBundleRepository implements BundleRepository {
  private readonly bundles = new Map<string, BundleDetail>();

  seed(detail: BundleDetail) {
    this.bundles.set(detail.id, detail);
  }

  async findDetail(institutionId: string, id: string): Promise<BundleDetail | null> {
    const b = this.bundles.get(id);
    if (!b || b.institutionId !== institutionId) return null;
    return b;
  }

  async findById(institutionId: string, id: string) {
    const b = await this.findDetail(institutionId, id);
    if (!b) return null;
    const { items, ...rest } = b;
    return rest;
  }
  async findAll() {
    return [];
  }
  async findByCourseIds() {
    return [];
  }
  async findEvaluationsByIds() {
    return [];
  }
  // No usado en los tests de bundle-cover (no creamos bundles nuevos,
  // solo los sembramos via seed()). Devolvemos un Bundle stub para
  // satisfacer el tipo — si algo llega a invocar create() en estos tests,
  // fallará ruidosamente con el error.
  async create(): Promise<Bundle> {
    throw new Error("create() no usado en bundle-cover tests");
  }
  async update(): Promise<Bundle> {
    throw new Error("update() no usado en bundle-cover tests");
  }
  async delete() {}
  async listItemsOrdered() {
    return [];
  }
  async addItem(): Promise<BundleItem> {
    throw new Error("addItem() no usado en bundle-cover tests");
  }
  async removeItem() {
    return false;
  }
  async reorderItems() {}
  async setStatus() {}
}

class InMemoryInstitutionRepository implements InstitutionRepository {
  private readonly items = new Map<string, Institution>();
  seed(i: Institution) {
    this.items.set(i.id, i);
  }
  async findById(id: string) {
    return this.items.get(id) ?? null;
  }
  async findBySlug(slug: string) {
    return [...this.items.values()].find((i) => i.slug === slug) ?? null;
  }
  async findByCode(code: string) {
    return [...this.items.values()].find((i) => i.code === code) ?? null;
  }
  async findAll() {
    return [...this.items.values()];
  }
  async create(): Promise<Institution> {
    throw new Error("create() no usado en bundle-cover tests");
  }
  async setActive() {}
  async setCoverContent(id: string, coverContent: Record<string, unknown> | null) {
    const inst = this.items.get(id);
    if (inst) inst.coverContent = coverContent;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ecuMaster: AuthenticatedUser = {
  userId: "u-ecu-master",
  institutionId: "inst-1",
  roles: ["ECU_MASTER"],
};

const teacher: AuthenticatedUser = {
  userId: "u-teacher",
  institutionId: "inst-1",
  roles: ["TEACHER"],
};

const institution: Institution = {
  id: "inst-1",
  name: "INSTITUCIÓN EDUCATIVA DEMO",
  slug: "demo",
  code: "DEMO",
  logo: "/logo.png",
  theme: null,
  coverContent: null,
  isActive: true,
  createdAt: new Date(),
};

const item: BundleItemDetail = {
  id: "item-1",
  bundleId: "b1",
  evaluationId: "e1",
  order: 1,
  evaluationTitle: "Biología 6°",
  evaluationStatus: "APPROVED",
  totalQuestions: 60,
  durationMinutes: 90,
  subjectName: "Biología",
  subjectIsArea: false,
  parentSubjectId: "area-cn",
  parentSubjectName: "Ciencias Naturales",
  courseId: "c-6",
  courseName: "6°",
};

const item2: BundleItemDetail = {
  ...item,
  id: "item-2",
  evaluationId: "e2",
  order: 2,
  evaluationTitle: "Física 6°",
  totalQuestions: 50,
  durationMinutes: 75,
  subjectName: "Física",
};

const bundle: BundleDetail = {
  id: "b1",
  institutionId: "inst-1",
  name: "ECU 6°",
  bookletNumber: 2,
  courseId: "c-6",
  courseName: "6°",
  status: "DRAFT",
  theme: null,
  coverContent: null,
  createdById: ecuMaster.userId,
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [item, item2],
  totalQuestions: 110,
};

const SECONDARIA_V1 = `<html><head><title>{{bundle.name}}</title></head><body>
<header>{{institution.name}} — {{bundle.name}} ({{bundle.grade}})</header>
<section>{{story.title}}</section>
<section>{{bundle.totalQuestions}} preguntas — {{bundle.totalTime}}</section>
<ul>{{#subjects}}<li>{{name}}</li>{{/subjects}}</ul>
<div>{{cover.instructions.title}}</div>
<div>{{cover.callout.text}}</div>
<div>{{cover.howToMark.question}} — {{cover.howToMark.exampleLabel}}</div>
<div>{{cover.prohibited.title}}: {{cover.prohibited.body}}</div>
</body></html>`;

const PRIMARIA_V1 = `<html><body><h1>{{bundle.name}}</h1></body></html>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bundle-cover", () => {
  let states: InMemoryCoverTemplateRepository;
  let loader: InMemoryCoverTemplateLoader;
  let bundles: InMemoryBundleRepository;
  let institutionsRepo: InMemoryInstitutionRepository;

  beforeEach(() => {
    states = new InMemoryCoverTemplateRepository();
    loader = new InMemoryCoverTemplateLoader();
    bundles = new InMemoryBundleRepository();
    institutionsRepo = new InMemoryInstitutionRepository();
    bundles.seed(bundle);
    institutionsRepo.seed(institution);
    loader.seed(toCoverTemplateKey("secundaria-v1"), SECONDARIA_V1);
    loader.seed(toCoverTemplateKey("primaria-v1"), PRIMARIA_V1);
  });

  // -------------------- BuildCoverContext --------------------

  describe("BuildCoverContext", () => {
    it("compila el contexto desde bundle + institución + defaults", async () => {
      const uc = new BuildCoverContext(bundles, institutionsRepo);
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const c = res.value;
      expect(c.institution.name).toBe("INSTITUCIÓN EDUCATIVA DEMO");
      expect(c.bundle.name).toBe("ECU 6°");
      expect(c.bundle.grade).toBe("6°");
      expect(c.bundle.bookletCode).toBe("ABR2");
      expect(c.bundle.totalQuestions).toBe(110);
      expect(c.bundle.totalTime).toMatch(/\d+ horas?/);
      expect(c.subjects.map((s) => s.name)).toEqual(["Ciencias Naturales"]); // colapsa por parent
      expect(c.cover.instructions.title).toBe("Instrucciones");
      expect(c.cover.prohibited.title).toBe("Prohibido");
      expect(c.cover.howToMark.circles.length).toBe(4);
    });

    it("usa el coverContent resuelto cuando se inyecta un loader (PR 2)", async () => {
      // Loader stub que simula overrides reales desde BD: cambia
      // instructionsTitle, calloutText y howToMarkExample.
      const loadCoverContent = async () => {
        const { mergeCoverContent } = await import("@/modules/bundle-cover/domain/cover-content");
        return mergeCoverContent(
          {},
          {
            instructionsTitle: "Indicaciones para el estudiante",
            calloutText: "Marque con esfero negro",
            howToMarkExample: "Si la correcta es C",
          },
        );
      };
      const uc = new BuildCoverContext(bundles, institutionsRepo, loadCoverContent);
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const c = res.value;
      expect(c.cover.instructions.title).toBe("Indicaciones para el estudiante");
      expect(c.cover.callout.text).toBe("Marque con esfero negro");
      expect(c.cover.howToMark.example).toBe("Si la correcta es C");
      // defaults no tocados
      expect(c.cover.prohibited.title).toBe("Prohibido");
      expect(c.cover.howToMark.exampleLabel).toBe("MARQUE ASÍ");
    });

    it("deduplica subjects por nombre parent", async () => {
      // Si dos items comparten el mismo parent, el subject raíz colapsa.
      const item3: BundleItemDetail = {
        ...item2,
        id: "item-3",
        subjectName: "Química",
      };
      bundles.seed({ ...bundle, items: [item, item2, item3] });
      const uc = new BuildCoverContext(bundles, institutionsRepo);
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.subjects.map((s) => s.name)).toEqual(["Ciencias Naturales"]);
    });

    it("falla si el bundle no existe", async () => {
      const uc = new BuildCoverContext(bundles, institutionsRepo);
      const res = await uc.execute({ actor: ecuMaster, bundleId: "no-existe" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe("NOT_FOUND");
    });
  });

  // -------------------- RenderCover (Mustache + DOMPurify) --------------------

  describe("RenderCover", () => {
    it("sustituye variables Mustache", () => {
      const render = new RenderCover();
      const out = render.execute({
        template: SECONDARIA_V1,
        context: {
          institution: { name: "DEMO", logo: null, legalFooter: "x", primaryColor: "#000" },
          bundle: {
            name: "ECU 6°",
            grade: "6°",
            bookletCode: "ABR2",
            periodLabel: "Único",
            totalQuestions: 110,
            totalTime: "2 horas 45 minutos",
          },
          session: { name: "Primera sesión", labelShort: "P1" },
          story: { title: null, description: null, illustration: null },
          subjects: [{ name: "Biología" }],
          cover: {
            instructions: { title: "Instrucciones", items: ["a"], itemsAfter: ["b"] },
            callout: { text: "Use lápiz negro" },
            howToMark: {
              question: "¿Cómo marcar?",
              example: "Si B",
              exampleLabel: "MARQUE ASÍ",
              circles: [],
            },
            prohibited: { title: "Prohibido", body: "Sin celulares" },
          },
        },
        key: DEFAULT_COVER_TEMPLATE_KEY,
        source: "BUILT_IN",
      });
      expect(out.html).toContain("DEMO");
      expect(out.html).toContain("ECU 6°");
      expect(out.html).toContain("6°");
      expect(out.html).toContain("110 preguntas");
      expect(out.html).toContain("Biología");
      expect(out.html).not.toContain("{{bundle.name}}");
    });

    it("elimina <script> inyectado en un override (XSS)", () => {
      const render = new RenderCover();
      const xss = `<html><body><h1>Hola</h1><script>alert('xss')</script><p>fin</p></body></html>`;
      const out = render.execute({
        template: xss,
        context: {
          institution: { name: "x", logo: null, legalFooter: "x", primaryColor: "#000" },
          bundle: {
            name: "x",
            grade: "x",
            bookletCode: "x",
            periodLabel: "x",
            totalQuestions: 0,
            totalTime: "x",
          },
          session: { name: "x", labelShort: "x" },
          story: { title: null, description: null, illustration: null },
          subjects: [],
          cover: {
            instructions: { title: "x", items: [], itemsAfter: [] },
            callout: { text: "x" },
            howToMark: { question: "x", example: "x", exampleLabel: "x", circles: [] },
            prohibited: { title: "x", body: "x" },
          },
        },
        key: DEFAULT_COVER_TEMPLATE_KEY,
        source: "OVERRIDE",
      });
      expect(out.html).not.toContain("<script");
      expect(out.html).not.toContain("alert(");
      // El resto del contenido se conserva.
      expect(out.html).toContain("Hola");
      expect(out.html).toContain("fin");
    });

    it("elimina <iframe>, <object>, <embed>", () => {
      const render = new RenderCover();
      const malicious = `<html><body><iframe src="evil"></iframe><object data="x"></object><embed src="x"><p>safe</p></body></html>`;
      const out = render.execute({
        template: malicious,
        context: {
          institution: { name: "x", logo: null, legalFooter: "x", primaryColor: "#000" },
          bundle: {
            name: "x",
            grade: "x",
            bookletCode: "x",
            periodLabel: "x",
            totalQuestions: 0,
            totalTime: "x",
          },
          session: { name: "x", labelShort: "x" },
          story: { title: null, description: null, illustration: null },
          subjects: [],
          cover: {
            instructions: { title: "x", items: [], itemsAfter: [] },
            callout: { text: "x" },
            howToMark: { question: "x", example: "x", exampleLabel: "x", circles: [] },
            prohibited: { title: "x", body: "x" },
          },
        },
        key: DEFAULT_COVER_TEMPLATE_KEY,
        source: "OVERRIDE",
      });
      expect(out.html).not.toContain("<iframe");
      expect(out.html).not.toContain("<object");
      expect(out.html).not.toContain("<embed");
      expect(out.html).toContain("safe");
    });

    it("elimina javascript: URLs en href/src", () => {
      const render = new RenderCover();
      const xss = `<html><body><a href="javascript:alert(1)">click</a><img src="javascript:alert(2)" /></body></html>`;
      const out = render.execute({
        template: xss,
        context: {
          institution: { name: "x", logo: null, legalFooter: "x", primaryColor: "#000" },
          bundle: {
            name: "x",
            grade: "x",
            bookletCode: "x",
            periodLabel: "x",
            totalQuestions: 0,
            totalTime: "x",
          },
          session: { name: "x", labelShort: "x" },
          story: { title: null, description: null, illustration: null },
          subjects: [],
          cover: {
            instructions: { title: "x", items: [], itemsAfter: [] },
            callout: { text: "x" },
            howToMark: { question: "x", example: "x", exampleLabel: "x", circles: [] },
            prohibited: { title: "x", body: "x" },
          },
        },
        key: DEFAULT_COVER_TEMPLATE_KEY,
        source: "OVERRIDE",
      });
      expect(out.html).not.toMatch(/javascript:/i);
    });
  });

  // -------------------- SaveCoverTemplate --------------------

  describe("SaveCoverTemplate", () => {
    it("guarda el override y devuelve el nuevo state", async () => {
      states.seed("b1", null, null);
      const uc = new SaveCoverTemplate(states);
      const body =
        "<html><body>Plantilla personalizada con " +
        "x".repeat(MIN_COVER_TEMPLATE_BODY_BYTES) +
        "</body></html>";
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1", body });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.source).toBe("OVERRIDE");
      expect(res.value.hasOverride).toBe(true);
      expect(res.value.updatedAt).toBeInstanceOf(Date);
    });

    it("rechaza body demasiado corto", async () => {
      const uc = new SaveCoverTemplate(states);
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1", body: "x" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe("VALIDATION");
    });

    it("rechaza body demasiado largo", async () => {
      const uc = new SaveCoverTemplate(states);
      const body = "x".repeat(MAX_COVER_TEMPLATE_BODY_BYTES + 1);
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1", body });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe("VALIDATION");
    });

    it("rechaza body con <script>", async () => {
      const uc = new SaveCoverTemplate(states);
      const body =
        "<html><body><h1>x</h1>" +
        "x".repeat(MIN_COVER_TEMPLATE_BODY_BYTES) +
        "<script>alert(1)</script></body></html>";
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1", body });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.message).toMatch(/script/);
    });

    it("rechaza body con javascript: URL", async () => {
      const uc = new SaveCoverTemplate(states);
      const body =
        "<html><body>" +
        "x".repeat(MIN_COVER_TEMPLATE_BODY_BYTES) +
        '<a href="javascript:alert(1)">x</a></body></html>';
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1", body });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.message).toMatch(/javascript/);
    });

    it("rechaza cuando el actor no es ECU_MASTER / ECU_LIDER", async () => {
      const uc = new SaveCoverTemplate(states);
      const body = "<html><body>" + "x".repeat(MIN_COVER_TEMPLATE_BODY_BYTES) + "</body></html>";
      const res = await uc.execute({ actor: teacher, bundleId: "b1", body });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe("FORBIDDEN");
    });
  });

  // -------------------- ResetCoverTemplate --------------------

  describe("ResetCoverTemplate", () => {
    it("limpia el override y vuelve a BUILT_IN", async () => {
      states.seed("b1", null, "<html><body>custom</body></html>", new Date());
      const uc = new ResetCoverTemplate(states);
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.source).toBe("BUILT_IN");
      expect(res.value.hasOverride).toBe(false);
      expect(res.value.updatedAt).toBeNull();
    });
  });

  // -------------------- ChangeCoverTemplateKey --------------------

  describe("ChangeCoverTemplateKey", () => {
    it("cambia la variante si la key existe en el FS", async () => {
      states.seed("b1", null, null);
      const uc = new ChangeCoverTemplateKey(states, async (k) =>
        (await loader.listAvailableKeys()).includes(k),
      );
      const res = await uc.execute({
        actor: ecuMaster,
        bundleId: "b1",
        key: toCoverTemplateKey("primaria-v1"),
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.key).toBe("primaria-v1");
    });

    it("rechaza key que no existe", async () => {
      const uc = new ChangeCoverTemplateKey(states, async (k) =>
        (await loader.listAvailableKeys()).includes(k),
      );
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1", key: "inventada-v99" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe("VALIDATION");
    });

    it("rechaza key con patrón inválido", async () => {
      const uc = new ChangeCoverTemplateKey(states, async () => true);
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1", key: "INVALID KEY" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe("VALIDATION");
    });

    it("null vuelve a DEFAULT_COVER_TEMPLATE_KEY", async () => {
      states.seed("b1", toCoverTemplateKey("primaria-v1"), null);
      const uc = new ChangeCoverTemplateKey(states, async (k) =>
        (await loader.listAvailableKeys()).includes(k),
      );
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1", key: null });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.key).toBe("secundaria-v1");
    });
  });

  // -------------------- PreviewCover (composición) --------------------

  // Resolver no-op para los tests: los assets se quedan como paths (la
  // portada los renderiza con su fallback textual cuando faltan). Tests
  // más finos del resolver viven en local-cover-asset-resolver.test.ts
  // (TODO si lo necesitamos).
  const noopAssets = {
    async resolveToDataUrl(path: string | null): Promise<string | null> {
      return path;
    },
  };

  // Stub del visual repository: vacío por defecto → PreviewCover cae al
  // camino tradicional. Si un test quiere probar el branch del visual,
  // hace `visualStates.seed(...)` con un JSON.
  const visualStates = new InMemoryCoverVisualRepository();

  describe("PreviewCover", () => {
    it("renderiza built-in cuando no hay override ni visual", async () => {
      states.seed("b1", null, null);
      const uc = new PreviewCover(
        states,
        visualStates,
        loader,
        new BuildCoverContext(bundles, institutionsRepo),
        new RenderCover(),
        new RenderCoverVisual(new RenderCover()),
        noopAssets,
      );
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.source).toBe("BUILT_IN");
      expect(res.value.html).toContain("INSTITUCIÓN EDUCATIVA DEMO");
      expect(res.value.html).toContain("ECU 6°");
    });

    it("renderiza override cuando hay body guardado y no hay visual", async () => {
      const customBody = `<html><body><h1>PERSONALIZADO</h1><p>{{bundle.name}}</p></body></html>`;
      states.seed("b1", null, customBody, new Date());
      const uc = new PreviewCover(
        states,
        visualStates,
        loader,
        new BuildCoverContext(bundles, institutionsRepo),
        new RenderCover(),
        new RenderCoverVisual(new RenderCover()),
        noopAssets,
      );
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.source).toBe("OVERRIDE");
      expect(res.value.html).toContain("PERSONALIZADO");
      expect(res.value.html).toContain("ECU 6°");
    });

    it("rechaza a un TEACHER (solo manage-bundles)", async () => {
      const uc = new PreviewCover(
        states,
        visualStates,
        loader,
        new BuildCoverContext(bundles, institutionsRepo),
        new RenderCover(),
        new RenderCoverVisual(new RenderCover()),
        noopAssets,
      );
      const res = await uc.execute({ actor: teacher, bundleId: "b1" });
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe("FORBIDDEN");
    });
  });

  // -------------------- LoadCoverDesigner --------------------

  describe("LoadCoverDesigner", () => {
    it("devuelve editorBody=built-in cuando no hay override", async () => {
      states.seed("b1", null, null);
      const uc = new LoadCoverDesigner(states, loader);
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.editorBody).toBe(SECONDARIA_V1);
      expect(res.value.builtinBody).toBe(SECONDARIA_V1);
      expect(res.value.state.source).toBe("BUILT_IN");
      expect(res.value.availableKeys).toContain("secundaria-v1");
      expect(res.value.availableKeys).toContain("primaria-v1");
    });

    it("devuelve editorBody=override cuando existe", async () => {
      const custom = "<html><body>CUSTOM</body></html>";
      states.seed("b1", null, custom, new Date());
      const uc = new LoadCoverDesigner(states, loader);
      const res = await uc.execute({ actor: ecuMaster, bundleId: "b1" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.value.editorBody).toBe(custom);
      // builtinBody sigue siendo el built-in puro, para mostrar al admin.
      expect(res.value.builtinBody).toBe(SECONDARIA_V1);
    });
  });
});
