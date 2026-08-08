import type { Email } from "@/shared/domain/email";

export interface PasswordResetEmailInput {
  to: string;
  name: string;
  /** URL ya construida con el token en plaintext. Nunca se hashea en el email. */
  resetUrl: string;
}

/**
 * Construye el Email de recuperación de contraseña. Variante del de
 * `accept-invite` (mismo template HTML, branding "ecognIA") pero con
 * copy específico de reset: explica que el enlace expira en 1 hora y
 * que pueden ignorarlo si no fueron ellos.
 */
export function buildPasswordResetEmail(input: PasswordResetEmailInput): Email {
  return {
    to: input.to,
    subject: "Restablece tu contraseña — ecognIA",
    html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
        <tr>
          <td style="background:#0a4fa8;padding:24px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:20px;font-weight:600">ecognIA</h1>
          </td>
        </tr>
        <tr><td style="padding:32px 24px">
          <p style="margin:0 0 16px;font-size:16px;color:#18181b">Hola <strong>${input.name}</strong>,</p>
          <p style="margin:0 0 16px;font-size:14px;color:#52525b;line-height:1.6">
            Recibimos una solicitud para restablecer la contraseña de tu cuenta.
            Si fuiste tú, haz clic en el siguiente botón para definir una nueva contraseña:
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:24px 0">
            <tr>
              <td align="center" style="background:#0a4fa8;border-radius:8px;padding:12px 32px">
                <a href="${input.resetUrl}" style="color:#fff;text-decoration:none;font-size:15px;font-weight:500;display:block">Restablecer contraseña</a>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:13px;color:#a1a1aa;line-height:1.4">
            Si no solicitaste este cambio, ignora este correo. Tu contraseña actual seguirá siendo válida.<br>
            Este enlace expira en <strong>1 hora</strong> y solo puede usarse una vez.
          </p>
        </td></tr>
        <tr><td style="background:#f4f4f5;padding:16px 24px;text-align:center;font-size:12px;color:#a1a1aa">Plataforma inteligente de evaluación ecognIA</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}
