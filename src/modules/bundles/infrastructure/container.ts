import {
  PrismaAcademicYearRepository,
  PrismaCourseRepository,
  PrismaPeriodRepository,
} from "@/modules/academic/infrastructure/prisma-academic-repositories";
import { PrismaBookletTypeRepository } from "@/modules/booklet-types/infrastructure/prisma-booklet-type-repository";
import { PrismaLeaderAssignmentRepository } from "@/modules/leader-assignments/infrastructure/prisma-leader-assignment-repository";
import { AddEvaluationToBundle } from "../application/add-evaluation-to-bundle";
import { CreateBundle } from "../application/create-bundle";
import { DeleteBundle } from "../application/delete-bundle";
import { GetBundle } from "../application/get-bundle";
import { GetBundleQuestionsForToggle } from "../application/get-bundle-questions-for-toggle";
import { ListBundles } from "../application/list-bundles";
import { MarkBundleReady } from "../application/mark-bundle-ready";
import { RemoveFromBundle } from "../application/remove-from-bundle";
import { ReorderBundleItems } from "../application/reorder-bundle-items";
import { ToggleDisabledBundleQuestion } from "../application/toggle-disabled-bundle-question";
import { UnmarkBundleReady } from "../application/unmark-bundle-ready";
import { UpdateBundle } from "../application/update-bundle";
import { UpdateBundleTheme } from "../application/update-bundle-theme";
import { PrismaBundleRepository } from "./prisma-bundle-repository";
import { PrismaDisabledBundleQuestionRepository } from "./prisma-disabled-bundle-question-repository";

/**
 * Composition root del módulo bundles. Aquí (y solo aquí) se cablean
 * las implementaciones concretas con los casos de uso.
 * La capa de presentación importa estas factorías, nunca los adaptadores.
 */
const repository = new PrismaBundleRepository();
// Sprint 9: CreateBundle/UpdateBundle validan que el `courseId` del
// cuadernillo exista en la institución del actor.
const courses = new PrismaCourseRepository();
// feat/lider-ecu: scope filter del ECU_LIDER.
const leaderAssignments = new PrismaLeaderAssignmentRepository();
// Sprint Bundle-Period (sep 2026): CreateBundle inyecta el periodo actual del
// año académico vigente y valida bookletTypeId contra la Prueba del bundle.
// UpdateBundle valida la consistencia al reasignar periodo/tipo.
const years = new PrismaAcademicYearRepository();
const periods = new PrismaPeriodRepository();
const bookletTypes = new PrismaBookletTypeRepository();

export const makeCreateBundle = () =>
  new CreateBundle(repository, courses, years, periods, bookletTypes);
export const makeListBundles = () => new ListBundles(repository, leaderAssignments);
export const makeGetBundle = () => new GetBundle(repository);
export const makeUpdateBundle = () => new UpdateBundle(repository, courses, periods, bookletTypes);
export const makeDeleteBundle = () => new DeleteBundle(repository);
export const makeAddEvaluationToBundle = () => new AddEvaluationToBundle(repository);
export const makeRemoveFromBundle = () => new RemoveFromBundle(repository);
export const makeReorderBundleItems = () => new ReorderBundleItems(repository);
export const makeUpdateBundleTheme = () => new UpdateBundleTheme(repository);
export const makeMarkBundleReady = () =>
  new MarkBundleReady(repository, new PrismaDisabledBundleQuestionRepository());
export const makeUnmarkBundleReady = () => new UnmarkBundleReady(repository);
// Sprint Preguntas inhabitadas (sep 2026). Repos separados por DDD; el
// repo de bundle es solo para findById (validación de existencia + tenant)
// y el repo de inhabitaciones hace el resto (incluido el lock check contra
// ScanBatch, que es la regla que evita re-procesar hojas viejas).
export const makeToggleDisabledBundleQuestion = () =>
  new ToggleDisabledBundleQuestion(repository, new PrismaDisabledBundleQuestionRepository());
// PR #3 del sprint Preguntas inhabitadas: vista de solo-lectura que hidrata
// enunciado + posición + flags de inhabitación para que el panel del
// cuadernillo pueda listar y togglear. Reutiliza el repo de inhabitaciones
// (no extiende `findDetail` — ese lo comparten GetBundle/Print/MarkReady).
export const makeGetBundleQuestionsForToggle = () =>
  new GetBundleQuestionsForToggle(repository, new PrismaDisabledBundleQuestionRepository());
// PR #4: ids de las preguntas inhabilitadas de un cuadernillo, para que los
// reportes y la matriz de la hoja las excluyan y las marquen "No cuenta".
// El caller ya validó el tenant al cargar la hoja o el cuadernillo.
export const loadDisabledQuestionIds = async (bundleId: string): Promise<Set<string>> => {
  const rows = await new PrismaDisabledBundleQuestionRepository().listActiveByBundle(bundleId);
  return new Set(rows.map((r) => r.questionId));
};
