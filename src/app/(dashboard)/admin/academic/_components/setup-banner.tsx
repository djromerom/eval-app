import { Sparkles } from "lucide-react";

/**
 * Banner de bienvenida que aparece solo cuando no hay años académicos
 * configurados. Sugiere el orden correcto de configuración
 * (año → periodos → cursos → asignaturas → grupos).
 */
export function SetupBanner() {
  return (
    <div className="bg-accent/10 border-accent/30 mt-6 flex items-center gap-3 rounded-xl border p-4">
      <div className="bg-primary/10 flex h-9 w-9 items-center justify-center rounded-lg">
        <Sparkles className="text-primary h-5 w-5" />
      </div>
      <div className="flex-1">
        <p className="text-foreground text-sm font-bold">¿Configurando por primera vez?</p>
        <p className="text-muted-foreground text-xs">
          Sigue el orden sugerido: año → periodos → cursos → asignaturas → grupos.
        </p>
      </div>
      <button
        type="button"
        className="border-accent text-accent-foreground bg-background rounded-lg border px-3 py-1.5 text-xs font-bold"
      >
        Ver guía →
      </button>
    </div>
  );
}
