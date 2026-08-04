import { PrismaPeriodRepository } from "@/modules/academic/infrastructure/prisma-academic-repositories";

import {
  CreateBookletType,
  DeleteBookletType,
  ListBookletTypesByInstitution,
  ListBookletTypesByPeriod,
  UpdateBookletType,
} from "../application/manage-booklet-types";
import { PrismaBookletTypeRepository } from "./prisma-booklet-type-repository";

/** Composition root del módulo booklet-types. */
const bookletTypes = new PrismaBookletTypeRepository();
const periods = new PrismaPeriodRepository();

export const makeCreateBookletType = () => new CreateBookletType(bookletTypes, periods);
export const makeListBookletTypesByPeriod = () => new ListBookletTypesByPeriod(bookletTypes);
export const makeListBookletTypesByInstitution = () =>
  new ListBookletTypesByInstitution(bookletTypes);
export const makeUpdateBookletType = () => new UpdateBookletType(bookletTypes);
export const makeDeleteBookletType = () => new DeleteBookletType(bookletTypes);
