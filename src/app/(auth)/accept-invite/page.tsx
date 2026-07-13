import type { Metadata } from "next";
import { AcceptInviteForm } from "./accept-invite-form";

export const metadata: Metadata = { title: "Aceptar invitación" };

export default async function AcceptInvitePage(props: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token, email } = await props.searchParams;

  if (!token || !email) {
    return (
      <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
        <div className="bg-card w-full max-w-sm rounded-xl border p-8 text-center shadow-sm">
          <h1 className="text-xl font-bold">Enlace inválido</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            El enlace de invitación no es válido o está incompleto.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="bg-card w-full max-w-sm rounded-xl border p-8 shadow-sm">
        <h1 className="text-xl font-bold">Aceptar invitación</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Establece tu contraseña para acceder a la plataforma.
        </p>
        <AcceptInviteForm token={token} email={email} />
      </div>
    </main>
  );
}
