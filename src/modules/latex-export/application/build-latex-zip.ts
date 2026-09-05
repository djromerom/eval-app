/**
 * Orquestador del ZIP LaTeX (L11 — sep 2026).
 * ============================================
 *
 * Compone los pedazos puros del módulo (`latex-walker`, `escapeLatex`,
 * `sanitizeFilename`, `buildReadme`, `buildMainTex`) + el fetcher de
 * almacenamiento (`readUpload`) en un caso de uso que entrega un `Buffer`
 * listo para descargar como `application/zip`.
 *
 * ## Flujo por export
 *
 *  1. Auth: solo `SUPER_ADMIN | ECU_MASTER | ECU_LIDER` pueden descargar
 *     cuadernillos (la nav de admin ya está detrás del rol).
 *  2. Carga `BundleDetail` vía `loadBundle(institutionId, bundleId)`. Si
 *     no existe, RLS + repo nos devuelven `null` → `NotFoundError`.
 *  3. Cap defensivo: `MAX_ITEMS_PER_EXPORT = 50`. Más allá de eso, el ZIP
 *     se acercaría al límite del body de Next.js serverless y la latencia
 *     se vuelve impredecible.
 *  4. Itera `bundle.items` en orden ascendente:
 *       a. `loadEvaluation(...)` → `EvaluationDetail`.
 *       b. **Pre-walk** (sync): recorre cada TipTap JSON del evaluation y
 *          determina qué imágenes van inline (con su filename único) o
 *          skip (external / data / unknown). Usa `resolveImageSrc` (L8).
 *       c. **Async read** en paralelo: para cada `storagePath` único, lee
 *          el binario vía `readUpload(...)`. `null` → imagen borrada del
 *          storage → se omite también del ZIP (el walker emite un
 *          comentario de skip en el .tex correspondiente).
 *       d. **Walk 2** (sync): renderiza el TipTap del evaluation a LaTeX
 *          emitiendo `\includegraphics{images/img-N.ext}` con filenames
 *          ya pre-asignados, o `% [imagen omitida: ...]` si la imagen no
 *          pudo cargarse.
 *       e. Cada evaluation se guarda como `eval-N.tex` (1-based); el
 *          `main.tex` las junta con `\input{...}` y mantiene numeración
 *          continua vía acumulador `nextStart`.
 *  5. Genera `main.tex`, `README.md`, todos los `eval-N.tex` y todos los
 *     binarios en `images/` con `jszip` → Buffer.
 *  6. Devuelve `{ zipBuffer, filename }` con un nombre slugificado.
 *
 * ## Por qué doble walk (sync pre-walk + sync walk 2)
 *
 * El walker `latex-walker.ts` es PURO y síncrono (no toca I/O). Eso nos
 * obliga a descubrir las imágenes ANTES de renderizar, ya que la decisión
 * de cada `<image>` (inline vs skip, nombre del archivo, contenido leído)
 * tiene que estar disponible en el momento del walk. El doble walk es la
 * forma más limpia: cost O(2N) sobre un TipTap doc chico; miles de
 * doc/s para una exportación real. Si el I/O remoto dominara, mover a un
 * walker async — pero ese es un refactor fuera de este sprint.
 *
 * ## Por qué inyecto funciones mínimas y no repos
 *
 * Para testear con fakes sin Prisma, recibo dos funciones inyecadas con
 * shape mínimo:
 *
 *   loadBundle(institutionId, bundleId)     → BundleDetail | null
 *   loadEvaluation(institutionId, evalId)   → EvaluationDetail | null
 *
 * El contenedor (L10) las cablea con los use cases existentes
 * (`makeGetBundle().execute`, `makeGetEvaluation().execute`). Los tests
 * inyectan fakes en memoria.
 */

import JSZip from "jszip";
import { buildMainTex } from "../domain/main-tex-template";
import { buildReadme } from "../domain/readme-template";
import { escapeLatex } from "../domain/latex-escape";
import { tiptapToLatex, type ImageResolution, type WalkerContext } from "../domain/latex-walker";
import { sanitizeFilename } from "./sanitize-filename";
import { resolveImageSrc } from "./resolve-evaluation-image-buffer";
import type { ReadUpload } from "../infrastructure/prisma-image-fetcher";
import type { BundleDetail } from "@/modules/bundles/domain/bundle";
import type {
  EvaluationDetail,
  EvaluationSection,
  Question,
  QuestionOption,
} from "@/modules/evaluations/domain/evaluation";
import { ForbiddenError, NotFoundError, type Result, fail, ok } from "@/shared/domain/result";
import { type AuthenticatedUser, requireRole } from "@/shared/application/authenticated-user";
import type { UseCase } from "@/shared/application/use-case";

// ---------------------------------------------------------------------------
// Puerto mínimo para el use case (testeable con fakes in-memory)
// ---------------------------------------------------------------------------

export type LoadBundle = (institutionId: string, bundleId: string) => Promise<BundleDetail | null>;
export type LoadEvaluation = (
  institutionId: string,
  evaluationId: string,
) => Promise<EvaluationDetail | null>;

export interface BuildLatexZipDeps {
  loadBundle: LoadBundle;
  loadEvaluation: LoadEvaluation;
  readUpload: ReadUpload;
}

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface BuildLatexZipInput {
  actor: AuthenticatedUser;
  /**
   * Modo del export. Por ahora solo se usa `"bundle"`; `"single"` queda
   * como placeholder para cuando exista L14 (route per-evaluation).
   */
  mode: "bundle";
  /** ID del bundle (o evaluation, en modo single). */
  targetId: string;
}

export interface BuildLatexZipOutput {
  zipBuffer: Buffer;
  /** Nombre slugificado: `cuadernillo-<bundleId>-<name>.zip`. */
  filename: string;
}

// ---------------------------------------------------------------------------
// Cap defensivo
// ---------------------------------------------------------------------------

/**
 * Tope de formulaciones por export. Por encima de esto, el ZIP puede ser
 * demasiado grande para el body limit de Next.js (4.5 MB cap por defecto
 * en serverless; en VPS es más generoso, pero no infinito). El PDF print
 * pipeline (`pages/api/bundles/[id]/pdf.ts`) usa el mismo cap.
 */
const MAX_ITEMS_PER_EXPORT = 50;

// ---------------------------------------------------------------------------
// Recolector de imágenes (estado compartido por evaluación)
// ---------------------------------------------------------------------------

/**
 * Resolución ya tomada (con filename asignado) por el pre-walk. Se mapea
 * desde el `src` original — el walk 2 hace lookup por src.
 */
type ResolvedDecision =
  | { kind: "skip"; reason: "external" | "data" | "unknown" }
  | {
      kind: "inline";
      storagePath: string;
      filename: string;
      mime: string;
    };

class EvaluationImageRegistry {
  /** `src` → decisión ya tomada en el pre-walk. */
  readonly bySrc = new Map<string, ResolvedDecision>();
  /** Counter correlativo por storagePath (img-1, img-2, ...) — se pasa al
   *  resolver de L8 compartido por todas las imágenes del evaluation. */
  readonly seenCount = new Map<string, number>();

  /**
   * Pre-walk: registra cada src único en `bySrc` y asigna el filename que
   * el walker usará después. Pura (no toca I/O), así que es segura en
   * unidades chicas.
   */
  preWalk(doc: unknown): void {
    walkTipTapForImages(doc, (src) => {
      if (this.bySrc.has(src)) return;
      const decision = resolveImageSrc(src, this.seenCount);
      if (decision.kind === "skip") {
        this.bySrc.set(src, { kind: "skip", reason: decision.reason });
      } else {
        this.bySrc.set(src, {
          kind: "inline",
          storagePath: decision.storagePath,
          filename: decision.uniqueName,
          mime: decision.mime,
        });
      }
    });
  }

  /**
   * Async: descarga los binarios de las imágenes inline. Devuelve la lista
   * `{ filename, buffer }` lista para añadirse al ZIP. Imágenes con buffer
   * `null` (ENOENT en storage) se omiten del ZIP **Y** el decision
   * correspondiente en `bySrc` se cambia de `{kind:inline}` a
   * `{kind:"skip", reason:"unknown"}` para que el walk 2 emita un comentario
   * `% [imagen origen no resuelto: ...]` en vez de un `\includegraphics`
   * apuntando a un archivo inexistente.
   */
  async fetchBuffers(read: ReadUpload): Promise<Array<{ filename: string; buffer: Buffer }>> {
    const uniqueFiles = new Map<string, string>(); // filename → storagePath (dedup)
    for (const decision of this.bySrc.values()) {
      if (decision.kind !== "inline") continue;
      if (!uniqueFiles.has(decision.filename)) {
        uniqueFiles.set(decision.filename, decision.storagePath);
      }
    }

    const entries = Array.from(uniqueFiles.entries());
    const readResults = await Promise.all(
      entries.map(async ([filename, storagePath]) => {
        const buf = await read(storagePath);
        if (buf === null) {
          // Flip: la imagen ya no es inline — flip la decisión para que
          // el walker emita skip en vez de `\includegraphics` roto.
          for (const [src, decision] of this.bySrc) {
            if (decision.kind === "inline" && decision.storagePath === storagePath) {
              this.bySrc.set(src, { kind: "skip", reason: "unknown" });
              break;
            }
          }
        }
        return { filename, buffer: buf };
      }),
    );
    return readResults
      .filter((r): r is { filename: string; buffer: Buffer } => r.buffer !== null)
      .map(({ filename, buffer }) => ({ filename, buffer }));
  }

  /** Resolver síncrono para el walker (walk 2). */
  resolve(src: string): ImageResolution {
    const decision = this.bySrc.get(src);
    if (!decision) {
      // Imagen descubierta en walk 2 que no estaba en pre-walk (no debería
      // pasar — el pre-walk recorre lo mismo). Defensivo: skip.
      return { kind: "skip", reason: "unknown" };
    }
    if (decision.kind === "skip") return { kind: "skip", reason: decision.reason };
    return { kind: "inline", filename: decision.filename };
  }
}

// ---------------------------------------------------------------------------
// Recolector de TipTap (extrae solo `<image>` nodes con su src)
// ---------------------------------------------------------------------------

/**
 * Recorre un árbol TipTap y para cada `{ type: "image", attrs: { src } }`
 * llama a `onImage(src)`. NO emite LaTeX — solo descubre qué imágenes hay.
 *
 * Es depth-limited para defendernos de docs con auto-referencias. Igual
 * que el walker, pero sin dispatch de node types (no le importa nada que
 * no sea `image`).
 */
function walkTipTapForImages(node: unknown, onImage: (src: string) => void): void {
  if (!node || typeof node !== "object") return;
  const record = node as { type?: unknown; content?: unknown; attrs?: unknown };

  if (record.type === "image") {
    const attrs = record.attrs as { src?: unknown } | undefined;
    const src = attrs?.src;
    if (typeof src === "string") onImage(src);
  }

  if (Array.isArray(record.content)) {
    for (const child of record.content) walkTipTapForImages(child, onImage);
  }
}

// ---------------------------------------------------------------------------
// Render de una evaluation completa
// ---------------------------------------------------------------------------

/**
 * Renderiza una evaluation a un bloque LaTeX completo:
 *
 *   \section*{<title>}
 *
 *   \subsection*{<section-title-1>}
 *   <contexto de la sección 1>
 *
 *   \subsection*{<section-title-2>}
 *   <contexto de la sección 2>
 *
 *   \begin{enumerate}[label=\textbf{\arabic*.}, start=<startNumber>]
 *     \item <texto stem 1>
 *     \begin{itemize}[label=]
 *       \item[A.] opción A
 *       \item[B.] opción B
 *     \end{itemize}
 *     \item <texto stem 2>
 *     ...
 *   \end{enumerate}
 *
 * Mantiene numeración continua entre evaluaciones vía `startNumber`. Las
 * questions se numeran por posición global (entre todas las sections),
 * NO por sección.
 */
function renderEvaluation(
  evaluation: EvaluationDetail,
  startNumber: number,
  images: EvaluationImageRegistry,
): { latex: string; questionCount: number } {
  const sections = evaluation.sections.slice().sort((a, b) => a.order - b.order);

  // Construye cada section por separado (header + contexto).
  const sectionBlocks = sections.map((section) => renderSectionHeader(section, images));

  // Collect ordenado de TODAS las questions de TODAS las sections.
  const allQuestions: Question[] = sections.flatMap((s) =>
    s.questions.slice().sort((a, b) => a.number - b.number),
  );

  const questionCount = allQuestions.length;
  if (questionCount === 0) {
    // Evaluation sin questions: emitimos solo header + sectionBlocks (sin enumerate).
    const header = `\\section*{${escapeLatex(evaluation.title)}}`;
    return { latex: [header, ...sectionBlocks].filter(Boolean).join("\n\n"), questionCount: 0 };
  }

  const ctx: WalkerContext = {
    images: [],
    resolveImage: (src) => images.resolve(src),
    insideTableCell: false,
    depth: 0,
  };

  const items = allQuestions.map((q) => renderQuestionItem(q, ctx)).filter((s) => s.length > 0);

  const header = `\\section*{${escapeLatex(evaluation.title)}}`;
  const enumerate =
    `\\begin{enumerate}[label=\\textbf{\\arabic*.}, start=${startNumber}]\n` +
    items.join("\n") +
    `\n\\end{enumerate}`;

  return {
    latex: [header, ...sectionBlocks, enumerate].filter(Boolean).join("\n\n"),
    questionCount,
  };
}

function renderSectionHeader(section: EvaluationSection, images: EvaluationImageRegistry): string {
  const parts: string[] = [];

  if (section.title) {
    parts.push(`\\subsection*{${escapeLatex(section.title)}}`);
  }

  // Contexto: walker solo para el contenido de la section.
  if (section.content) {
    const ctx: WalkerContext = {
      images: [],
      resolveImage: (src) => images.resolve(src),
      insideTableCell: false,
      depth: 0,
    };
    const ctxLatex = tiptapToLatex(section.content, ctx);
    if (ctxLatex.trim()) parts.push(ctxLatex);
  }

  return parts.join("\n\n");
}

/** Emite un `\item` con su stem + opciones. */
function renderQuestionItem(q: Question, ctx: WalkerContext): string {
  const stemLatex = tiptapToLatex(q.text ?? { type: "doc", content: [] }, ctx);

  const optionsLatex = q.options
    .map((o) => renderOptionLatex(o, ctx))
    .filter((s) => s.length > 0)
    .map((latex, idx) => `  \\item[${q.options[idx]!.key}.] ${latex}`)
    .join("\n");

  const stem = stemLatex.trim() || "\\textit{(pregunta sin enunciado)}";

  if (optionsLatex.length === 0) {
    return `\\item ${stem}`;
  }

  return `\\item ${stem}\n\\begin{itemize}[label=]\n${optionsLatex}\n\\end{itemize}`;
}

function renderOptionLatex(o: QuestionOption, ctx: WalkerContext): string {
  return tiptapToLatex(o.text ?? { type: "doc", content: [] }, ctx).trim();
}

// ---------------------------------------------------------------------------
// Use case (composition root público)
// ---------------------------------------------------------------------------

export class BuildLatexZip implements UseCase<BuildLatexZipInput, BuildLatexZipOutput> {
  constructor(private readonly deps: BuildLatexZipDeps) {}

  async execute(input: BuildLatexZipInput): Promise<Result<BuildLatexZipOutput>> {
    // 1. Auth.
    const auth = requireRole(input.actor, "SUPER_ADMIN", "ECU_MASTER", "ECU_LIDER");
    if (!auth.ok) return auth;

    if (input.mode !== "bundle") {
      return fail(new ForbiddenError(`Modo de export no soportado: ${input.mode}`));
    }

    // 2. Carga el bundle.
    const bundle = await this.deps.loadBundle(input.actor.institutionId, input.targetId);
    if (!bundle) return fail(new NotFoundError("Cuadernillo", input.targetId));

    // 3. Cap defensivo.
    if (bundle.items.length === 0) {
      return fail(new ForbiddenError("El cuadernillo no tiene formulaciones para exportar."));
    }
    if (bundle.items.length > MAX_ITEMS_PER_EXPORT) {
      return fail(
        new ForbiddenError(
          `El cuadernillo tiene ${bundle.items.length} formulaciones (máximo ${MAX_ITEMS_PER_EXPORT}). Divide el cuadernillo y vuelve a intentar.`,
        ),
      );
    }

    // 4. Itera items.
    const items = bundle.items.slice().sort((a, b) => a.order - b.order);
    type EvalFile = { filename: string; content: string; count: number };
    const evalFiles: EvalFile[] = [];

    let nextStart = 1;

    // Acumulamos binarios de imágenes POR EVALUATION para no sobreescribir
    // entre diferentes formulaciones del mismo bundle. (Cada evaluation
    // tiene su propio registry; los filenames img-1.png se REINICIAN por
    // evaluation, igual que el print pipeline reinicia por sección.)
    //
    // Estructura paralela paralela: zip-relative path → buffer.
    const allImageBuffers: Array<{ zipPath: string; buffer: Buffer }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const detail = await this.deps.loadEvaluation(input.actor.institutionId, item.evaluationId);
      if (!detail) return fail(new NotFoundError("Formulación", item.evaluationId));

      const registry = new EvaluationImageRegistry();

      // 4a. Pre-walk de TODO el contenido TipTap del evaluation.
      for (const section of detail.sections) {
        registry.preWalk(section.content);
        for (const q of section.questions) {
          registry.preWalk(q.text);
          for (const o of q.options) registry.preWalk(o.text);
        }
      }

      // 4b. Async read de imágenes inline.
      const buffers = await registry.fetchBuffers(this.deps.readUpload);
      for (const { filename, buffer } of buffers) {
        allImageBuffers.push({ zipPath: `images/${filename}`, buffer });
      }

      // 4c. Walk 2: render del evaluation.
      const rendered = renderEvaluation(detail, nextStart, registry);

      evalFiles.push({
        filename: `eval-${i + 1}.tex`,
        content: rendered.latex,
        count: rendered.questionCount,
      });

      nextStart += rendered.questionCount;
    }

    // 5. main.tex + ZIP.
    const readme = buildReadme();
    const mainTex = buildMainTex({
      bundleName: bundle.name,
      inputFiles: evalFiles.map((f) => f.filename),
    });

    const zip = new JSZip();
    zip.file("README.md", readme);
    zip.file("main.tex", mainTex);
    for (const f of evalFiles) {
      zip.file(f.filename, f.content);
    }
    for (const img of allImageBuffers) {
      zip.file(img.zipPath, img.buffer);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const filename = `cuadernillo-${bundle.id}-${sanitizeFilename(bundle.name)}.zip`;

    return ok({ zipBuffer, filename });
  }
}
