import { InviteUser, ListUsers, SetUserActive, SetUserRoles } from "../application/users";
import { PrismaUserRepository } from "./prisma-user-repository";

/** Composition root del módulo users. */
const users = new PrismaUserRepository();

export const makeInviteUser = () => new InviteUser(users);
export const makeListUsers = () => new ListUsers(users);
export const makeSetUserRoles = () => new SetUserRoles(users);
export const makeSetUserActive = () => new SetUserActive(users);
