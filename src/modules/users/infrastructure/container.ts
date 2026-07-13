import { loadSmtpConfig } from "@/shared/infrastructure/email/config";
import { SmtpEmailService } from "@/shared/infrastructure/email/service";
import {
  InviteUser,
  ListUsers,
  ResendUserInvitation,
  SetUserActive,
  SetUserRoles,
} from "../application/users";
import { PrismaUserRepository } from "./prisma-user-repository";

/** Composition root del módulo users. */
const users = new PrismaUserRepository();

const smtpConfig = loadSmtpConfig();
const emailService = smtpConfig ? new SmtpEmailService(smtpConfig) : undefined;

export const makeInviteUser = () => new InviteUser(users, emailService);
export const makeResendUserInvitation = () => new ResendUserInvitation(users, emailService);
export const makeListUsers = () => new ListUsers(users);
export const makeSetUserRoles = () => new SetUserRoles(users);
export const makeSetUserActive = () => new SetUserActive(users);
