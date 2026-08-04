import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { Button, buttonVariants } from "@/components/ui/button";

async function loginWithCredentials(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=credenciales");
    }
    throw error;
  }
}

export function LoginForm() {
  return (
    <form action={loginWithCredentials} className="mt-6 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-foreground text-sm font-medium">
          Correo institucional
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="nombre@institucion.edu.co"
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-lg border px-3.5 py-2.5 text-sm shadow-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-foreground text-sm font-medium">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••••"
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-lg border px-3.5 py-2.5 text-sm shadow-sm transition-colors placeholder:transition-opacity placeholder:duration-150 focus:placeholder:opacity-0 focus-visible:ring-2 focus-visible:outline-none"
        />
      </div>
      <Button type="submit" size="lg" className="w-full">
        Iniciar sesión
      </Button>
      <Link
        href="/forgot-password"
        className={buttonVariants({ variant: "link" }) + " block text-center"}
      >
        Recuperar contraseña
      </Link>
      {/* TODO Fase 1: botones "Continuar con Google" / "Continuar con Microsoft" */}
    </form>
  );
}
