import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Email, EmailService } from "@/shared/domain/email";

/** Persiste el hash del token de invitación en el usuario. Lo provee cada módulo. */
export type InviteTokenSetter = (
  userId: string,
  tokenHash: string,
  expiresAt: Date,
) => Promise<void>;

export interface InvitationTarget {
  userId: string;
  email: string;
  name: string;
  institutionName: string;
}

const TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48h

/**
 * Genera un token de invitación (48h), lo persiste hasheado vía `setToken` y
 * envía el correo con el enlace para definir contraseña. Compartido por los
 * módulos de usuarios y docentes. Lanza si el envío falla; el llamador decide
 * cómo tratarlo (best-effort en el alta, error visible en el reenvío).
 */
export async function sendUserInvitation(
  emailService: EmailService,
  setToken: InviteTokenSetter,
  target: InvitationTarget,
): Promise<void> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await setToken(target.userId, tokenHash, expiresAt);

  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  const inviteUrl = `${baseUrl}/accept-invite?token=${rawToken}&email=${encodeURIComponent(target.email)}`;

  await emailService.send(buildInvitationEmail(target, inviteUrl));
}

function buildInvitationEmail(target: InvitationTarget, inviteUrl: string): Email {
  return {
    to: target.email,
    subject: `Has sido invitado a ${target.institutionName} — ecognIA`,
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
        <tr>
          <td style="background:#0a4fa8;padding:24px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:20px;font-weight:600">${target.institutionName}</h1>
          </td>
        </tr>
        <tr><td style="padding:32px 24px">
          <p style="margin:0 0 16px;font-size:16px;color:#18181b">Hola <strong>${target.name}</strong>,</p>
          <p style="margin:0 0 16px;font-size:14px;color:#52525b;line-height:1.6">
            Le damos la bienvenida a <strong>ecognIA</strong> la plataforma tecnológica de apoyo a la Estrategia de Calidad Unificada – ECU, de la 
            <strong>${target.institutionName}</strong>.
            Haz clic en el siguiente botón para establecer tu contraseña y acceder:
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:24px 0">
            <tr>
              <td align="center" style="background:#0a4fa8;border-radius:8px;padding:12px 32px">
                <a href="${inviteUrl}" style="color:#fff;text-decoration:none;font-size:15px;font-weight:500;display:block">Aceptar invitación</a>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:13px;color:#a1a1aa;line-height:1.4">
            Si no esperabas esta invitación, ignora este correo.<br>
            Este enlace expira en 48 horas.
          </p>
        </td></tr>
        <tr><td style="background:#f4f4f5;padding:16px 24px;text-align:center;font-size:12px;color:#a1a1aa">ecognIA — Plataforma de formulaciones tipo ICFES</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
