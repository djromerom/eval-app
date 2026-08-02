import type { Metadata } from "next";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default function ForgotPasswordPage() {
  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="bg-card w-full max-w-sm rounded-xl border p-8 shadow-sm">
        <h1 className="text-xl font-bold">¿Olvidaste tu contraseña?</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Ingresa tu correo institucional y te enviaremos un enlace para restablecerla.
        </p>
        <ForgotPasswordForm />
      </div>
    </main>
  );
}
