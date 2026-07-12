import { CreateInstitution } from "../application/create-institution";
import { ListInstitutions } from "../application/list-institutions";
import { PrismaInstitutionRepository } from "./prisma-institution-repository";

/**
 * Composition root del módulo: aquí (y solo aquí) se cablean
 * las implementaciones concretas con los casos de uso.
 * La capa de presentación importa estas factorías, nunca los adaptadores.
 */
const repository = new PrismaInstitutionRepository();

export const makeCreateInstitution = () => new CreateInstitution(repository);
export const makeListInstitutions = () => new ListInstitutions(repository);
