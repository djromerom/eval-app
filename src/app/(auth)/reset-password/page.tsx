import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Restablecer contraseña" };

export default async function ResetPasswordPage(props: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await props.searchParams;

  if (!token) {
    return (
      <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
        <div className="bg-card w-full max-w-sm rounded-xl border p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold">Enlace inválido</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            El enlace no es válido o está incompleto. Solicita uno nuevo desde la pantalla de inicio
            de sesión.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="bg-card w-full max-w-sm rounded-xl border p-8 shadow-sm">
        <h1 className="text-xl font-bold">Restablecer contraseña</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Define una nueva contraseña para tu cuenta.
        </p>
        <ResetPasswordForm token={token} />
      </div>
    </main>
  );
}
