import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

const FEATURES = [
  { title: "Banco de ítems propio", caption: "" },
  { title: "QR por estudiante", caption: "" },
  { title: "Calificación por escáner", caption: "" },
  { title: "Fortalecimiento Docente", caption: "" },
  { title: "Informes inmediatos", caption: "" },
] as const;

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await props.searchParams;

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Panel de marca */}
      <section className="from-brand-blue-tint to-brand-mint-tint relative hidden overflow-hidden bg-linear-to-br p-12 lg:flex lg:flex-col">
        {/* "e" fantasma decorativa */}
        <div
          aria-hidden
          className="border-primary/20 pointer-events-none absolute -bottom-24 -left-24 h-112 w-md rounded-full border-16"
        />
        <Logo markClassName="h-18" wordmarkClassName="text-5xl" />

        <div className="my-auto max-w-md">
          <p className="text-brand-mint-foreground/80 text-xs font-bold tracking-[0.2em]">
            EVALUACIONES INTELIGENTES
          </p>
          <h1 className="text-primary font-display mt-4 text-5xl leading-[1.05] font-extrabold">
            Crea, Evalúa y Fortalece con
            <br />
            el poder de la IA
          </h1>
          <p className="text-muted-foreground mt-5 text-lg leading-relaxed">
            Diseñe pruebas con la identidad de su institución, obtenga resultados e informes
            inmediatos y eleve las competencias de su equipo docente en una sola plataforma.
          </p>

          <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="max-w-40">
                <p className="text-foreground text-sm font-semibold">{f.title}</p>
                <p className="text-muted-foreground text-xs">{f.caption}</p>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-muted-foreground text-xs">
          © 2026 ecognIA — Plataforma inteligente de evaluación
        </p>
      </section>

      {/* Panel de formulario */}
      <section className="bg-card flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Logo markClassName="h-26" wordmarkClassName="text-4xl" />
          </div>

          <h2 className="text-foreground font-display text-3xl font-bold">Bienvenido a ecognIA</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Para continuar ingrese con su cuenta institucional.
          </p>

          {success === "invitacion-aceptada" && (
            <p className="mt-6 rounded-lg bg-green-50 px-3.5 py-2.5 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
              Contraseña establecida correctamente. Ahora puedes iniciar sesión.
            </p>
          )}
          {success === "password-reset" && (
            <p className="mt-6 rounded-lg bg-green-50 px-3.5 py-2.5 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
              Contraseña actualizada. Ahora puedes iniciar sesión.
            </p>
          )}
          {error === "credenciales" && (
            <p className="mt-6 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              Correo o contraseña incorrectos.
            </p>
          )}

          <LoginForm />

          <p className="text-muted-foreground mt-8 text-center text-xs">
            ¿No tiene cuenta? Su institución debe invitarle. Contacte al ECU Master.
          </p>
        </div>
      </section>
    </main>
  );
}
