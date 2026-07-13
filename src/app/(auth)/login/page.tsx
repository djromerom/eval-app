import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await props.searchParams;

  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="bg-card w-full max-w-sm rounded-xl border p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Eval</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Evaluaciones tipo ICFES para tu institución
        </p>
        {success === "invitacion-aceptada" && (
          <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
            Contraseña establecida correctamente. Ahora puedes iniciar sesión.
          </p>
        )}
        {error === "credenciales" && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            Correo o contraseña incorrectos.
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
