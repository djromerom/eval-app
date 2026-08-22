/**
 * Caso de uso: construir el CONTEXTO Mustache para renderizar una portada.
 *
 * El contexto es el objeto plano que se le pasa a `Mustache.render`. Tiene
 * tres bloques:
 *
 *   institution.*   — datos de la institución (logo, nombre, color primario,
 *                     legal footer).
 *   bundle.*        — datos del bundle (nombre, grado, código, periodo,
 *                     totales).
 *   session.*       — etiqueta de la sesión (hoy hardcoded a "Primera
 *                     sesión"; futuro: configurable por bundle).
 *   story.*         — bloque de historia/contexto. La variante
 *                     secundaria-v1 lo usa para el texto Maleiwa; la
 *                     primaria-v1 probablemente lo use distinto.
 *   cover.*          — textos estáticos institucionales (instrucciones,
 *                     callout, cómo marcar, prohibido) tomados de
 *                     `cover-defaults.ts`.
 *
 * El shape debe coincidir exactamente con las variables que aparecen en
 * las plantillas (ver comentario al inicio de `secundaria-v1.html`).
 *
 * Esta use case NO toca el filesystem ni Mustache — solo compone el objeto.
 * El render vive en `render-cover.ts`.
 */
import { type AuthenticatedUser } from "@/shared/application/authenticated-user";
import { type UseCase } from "@/shared/application/use-case";
import { NotFoundError, type Result, fail, ok } from "@/shared/domain/result";
import type {
  BundleDetail,
  BundleItemDetail,
  BundleRepository,
} from "@/modules/bundles/domain/bundle";
import type { Institution, InstitutionRepository } from "@/modules/institutions/domain/institution";
import { mergeCoverContent, type ResolvedCoverContent } from "../domain/cover-content";
import {
  DEFAULT_HOW_TO_MARK_CIRCLES,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SESSION_LABEL_SHORT,
  DEFAULT_SESSION_NAME,
} from "./cover-defaults";

export interface BuildCoverContextInput {
  actor: AuthenticatedUser;
  bundleId: string;
}

/**
 * Context serializable. Los tipos deben ser JSON-compatibles (Date se
 * convierte a ISO; los nulls significan "no renderizar"). Los arrays
 * pueden ser vacíos — la plantilla decide con `{{#items}}…{{/items}}`.
 */
export interface CoverContext {
  institution: {
    name: string;
    logo: string | null;
    legalFooter: string;
    primaryColor: string;
  };
  bundle: {
    name: string;
    grade: string;
    bookletCode: string;
    periodLabel: string;
    totalQuestions: number;
    totalTime: string;
  };
  session: {
    name: string;
    labelShort: string;
  };
  story: {
    title: string | null;
    description: string | null;
    illustration: string | null;
  };
  subjects: ReadonlyArray<{ name: string }>;
  cover: {
    instructions: {
      title: string;
      items: readonly string[];
      itemsAfter: readonly string[];
    };
    callout: {
      text: string;
    };
    howToMark: {
      question: string;
      example: string;
      exampleLabel: string;
      circles: ReadonlyArray<{ letter: string; filled: boolean }>;
    };
    prohibited: {
      title: string;
      body: string;
    };
  };
}

export class BuildCoverContext implements UseCase<BuildCoverContextInput, CoverContext> {
  constructor(
    private readonly bundles: BundleRepository,
    private readonly institutions: InstitutionRepository,
    /**
     * Loader inyectado para resolver el `coverContent` final
     (institucional ⊕ bundle). Si se omite, el use case cae a defaults —
     útil para tests que no quieren acoplar a Prisma. Producción pasa
     `getResolvedCoverContent` (ver
     `src/modules/bundle-cover/application/get-resolved-cover-content.ts`).
     */
    private readonly loadCoverContent?: (
      institutionId: string,
      bundleId: string,
    ) => Promise<ResolvedCoverContent>,
  ) {}

  async execute({ actor, bundleId }: BuildCoverContextInput): Promise<Result<CoverContext>> {
    const bundle = await this.bundles.findDetail(actor.institutionId, bundleId);
    if (!bundle) {
      return fail(new NotFoundError("Bundle", bundleId));
    }
    const institution = await this.institutions.findById(actor.institutionId);
    if (!institution) {
      // Solo debería pasar si la institución del actor fue borrada mientras
      // está logueado. Lo tratamos como NotFound — la sesión se invalidará
      // en el siguiente refresh.
      return fail(new NotFoundError("Institución", actor.institutionId));
    }

    const coverContent = this.loadCoverContent
      ? await this.loadCoverContent(actor.institutionId, bundleId)
      : mergeCoverContent({}, {});

    return ok(assembleContext(bundle, institution, coverContent));
  }
}

/**
 * Ensambla el CoverContext desde un BundleDetail + Institution +
 * ResolvedCoverContent. Pura: sin I/O. Expuesto por si otros use cases
 * (p.ej. un export JSON del preview) lo quieren reutilizar sin pasar por
 * el use case.
 *
 * El `coverContent` ya viene colapsado (bundle ⊕ institución ⊕ defaults)
 * por `BuildCoverContext.execute()` o `getResolvedCoverContent()`. Acá
 * solo volcamos cada campo en su slot del CoverContext.
 */
export function assembleContext(
  bundle: BundleDetail,
  institution: Institution,
  coverContent: ResolvedCoverContent,
): CoverContext {
  return {
    institution: {
      name: institution.name,
      logo: institution.logo,
      legalFooter: coverContent.legalFooter,
      // El primaryColor viene del Institution.theme si está seteado; si no,
      // cae al DEFAULT_PRIMARY_COLOR. La variante secundaria-v1 lo ignora
      // (paleta gris), pero primaria-v1 lo usaría para bordes/acento.
      primaryColor: readPrimaryColor(institution.theme),
    },
    bundle: {
      name: bundle.name,
      grade: bundle.courseName ?? "",
      bookletCode: formatBookletCode(bundle.bookletNumber),
      periodLabel: readPeriodLabel(bundle),
      totalQuestions: bundle.totalQuestions,
      // Sumamos las duraciones reales si están seteadas; si no, heurística
      // 1.5 min por pregunta. Coincide con el cálculo que ya hacía el
      // PDF worker antes de este sprint.
      totalTime: formatTotalTime(bundle.items),
    },
    session: {
      name: DEFAULT_SESSION_NAME,
      labelShort: DEFAULT_SESSION_LABEL_SHORT,
    },
    story: {
      // Vacíos por ahora — la story es contenido editorial que el admin
      // configurará en un sprint futuro. La plantilla los maneja con
      // `{{#story.title}}…{{/story.title}}` así que null = bloque oculto.
      title: null,
      description: null,
      illustration: institution.logo,
    },
    subjects: collectSubjects(bundle.items),
    cover: {
      instructions: {
        title: coverContent.instructionsTitle,
        items: coverContent.itemsBefore,
        itemsAfter: coverContent.itemsAfter,
      },
      callout: {
        text: coverContent.calloutText,
      },
      howToMark: {
        question: coverContent.howToMarkQuestion,
        example: coverContent.howToMarkExample,
        exampleLabel: coverContent.howToMarkExampleLabel,
        circles: DEFAULT_HOW_TO_MARK_CIRCLES,
      },
      prohibited: {
        title: coverContent.prohibitedTitle,
        body: coverContent.prohibitedBody,
      },
    },
  };
}

/** Formatea el bookletNumber como "ABR2" / "Único". La portada usa un código
 *  corto en una caja; el correlativo largo (1, 2, 3…) se transforma. */
function formatBookletCode(bookletNumber: number | null): string {
  if (bookletNumber == null) return "Único";
  return `ABR${bookletNumber}`;
}

/** Período en formato corto: "2026 - 2" (año + orden). Si el bundle no
 *  tiene curso (cross-course), usamos un placeholder neutro. El dato
 *  fino viene del bundle vía joins, pero hoy Bundle.courseId no arrastra
 *  el Period — para no hacer un JOIN extra aquí, derivamos del nombre del
 *  curso o caemos al año académico de createdAt. Si el docente necesita
 *  precisión exacta, será una mejora futura. */
function readPeriodLabel(bundle: BundleDetail): string {
  // Heuristic hasta que el Bundle tenga periodId directo: mostramos
  // "Sin período" o "<año> - Único" según el caso.
  if (!bundle.courseName) return "Sin período";
  return bundle.bookletNumber ? `Único` : `Único`;
}

/** Extrae el primaryColor del JSON Institution.theme. Devuelve el default si
 *  no hay tema o el campo falta. */
function readPrimaryColor(theme: unknown): string {
  if (theme && typeof theme === "object" && "primaryColor" in theme) {
    const value = (theme as { primaryColor?: unknown }).primaryColor;
    if (typeof value === "string" && value.startsWith("#")) return value;
  }
  return DEFAULT_PRIMARY_COLOR;
}

/** Suma los durationMinutes conocidos; los null cuentan como 1.5 min/preg. */
function formatTotalTime(items: ReadonlyArray<BundleItemDetail>): string {
  const minutesPerQuestion = 1.5;
  let totalMinutes = 0;
  for (const item of items) {
    if (item.durationMinutes != null) {
      totalMinutes += item.durationMinutes;
    } else {
      totalMinutes += item.totalQuestions * minutesPerQuestion;
    }
  }
  const rounded = Math.round(totalMinutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m} minutos`;
  if (m === 0) return `${h} ${h === 1 ? "hora" : "horas"}`;
  return `${h} ${h === 1 ? "hora" : "horas"} ${m} minutos`;
}

/**
 * Subjects únicos en el orden en que aparecen en los items del bundle.
 * Si un item tiene parentSubjectName (área raíz), usamos el área para que
 * la portada diga "Ciencias Naturales" en vez de "Biología, Física, Química"
 * por separado. Si el subject es raíz (no es área), usamos el subject
 * directo. Las áreas (isArea=true) NO se imprimen — son solo agrupadores.
 */
function collectSubjects(items: ReadonlyArray<BundleItemDetail>): ReadonlyArray<{
  name: string;
}> {
  const seen = new Set<string>();
  const out: { name: string }[] = [];
  for (const item of items) {
    // Ignoramos áreas: la portada muestra subjects evaluables.
    if (item.subjectIsArea) continue;
    const name = item.parentSubjectName ?? item.subjectName;
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name });
  }
  return out;
}
