import { PrismaCourseRepository } from "@/modules/academic/infrastructure/prisma-academic-repositories";
import { AddEvaluationToBundle } from "../application/add-evaluation-to-bundle";
import { CreateBundle } from "../application/create-bundle";
import { DeleteBundle } from "../application/delete-bundle";
import { GetBundle } from "../application/get-bundle";
import { ListBundles } from "../application/list-bundles";
import { MarkBundleReady } from "../application/mark-bundle-ready";
import { RemoveFromBundle } from "../application/remove-from-bundle";
import { ReorderBundleItems } from "../application/reorder-bundle-items";
import { UnmarkBundleReady } from "../application/unmark-bundle-ready";
import { UpdateBundle } from "../application/update-bundle";
import { UpdateBundleTheme } from "../application/update-bundle-theme";
import { PrismaBundleRepository } from "./prisma-bundle-repository";

/**
 * Composition root del módulo bundles. Aquí (y solo aquí) se cablean
 * las implementaciones concretas con los casos de uso.
 * La capa de presentación importa estas factorías, nunca los adaptadores.
 */
const repository = new PrismaBundleRepository();
// Sprint 9: CreateBundle/UpdateBundle validan que el `courseId` del
// cuadernillo exista en la institución del actor.
const courses = new PrismaCourseRepository();

export const makeCreateBundle = () => new CreateBundle(repository, courses);
export const makeListBundles = () => new ListBundles(repository);
export const makeGetBundle = () => new GetBundle(repository);
export const makeUpdateBundle = () => new UpdateBundle(repository, courses);
export const makeDeleteBundle = () => new DeleteBundle(repository);
export const makeAddEvaluationToBundle = () => new AddEvaluationToBundle(repository);
export const makeRemoveFromBundle = () => new RemoveFromBundle(repository);
export const makeReorderBundleItems = () => new ReorderBundleItems(repository);
export const makeUpdateBundleTheme = () => new UpdateBundleTheme(repository);
export const makeMarkBundleReady = () => new MarkBundleReady(repository);
export const makeUnmarkBundleReady = () => new UnmarkBundleReady(repository);
