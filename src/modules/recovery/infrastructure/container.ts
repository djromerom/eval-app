import { env } from "@/config/env";
import { loadSmtpConfig } from "@/shared/infrastructure/email/config";
import { SmtpEmailService } from "@/shared/infrastructure/email/service";
import { RequestPasswordReset } from "../application/request-password-reset";
import { ResetPassword } from "../application/reset-password";
import { PrismaPasswordResetRepository } from "./prisma-password-reset-repository";

const repo = new PrismaPasswordResetRepository();
const smtpConfig = loadSmtpConfig();
const emailService = smtpConfig ? new SmtpEmailService(smtpConfig) : undefined;

// Fallback documentado: si bien `env.AUTH_URL` es opcional en zod, sin
// él no podemos generar links absolutos del email. En dev (sin var
// seteada) usamos localhost:3000; el docente en local puede abrir el
// link copiando la URL relativa.
const baseUrl = env.AUTH_URL ?? "http://localhost:3000";

export const makeRequestPasswordReset = () =>
  new RequestPasswordReset({ repo, email: emailService, baseUrl });

export const makeResetPassword = () => new ResetPassword(repo);
