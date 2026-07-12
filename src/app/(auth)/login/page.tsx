import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default function LoginPage() {
  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="bg-card w-full max-w-sm rounded-xl border p-8 shadow-sm">
        <h1 className="text-2xl font-bold">Eval</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Evaluaciones tipo ICFES para tu institución
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
