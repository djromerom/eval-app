import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Isotipo ecognIA (solo la "e"): PNG oficial en `public/`.
 * Dá el tamaño con `className` (p. ej. `h-8 w-auto`).
 * `alt=""` cuando acompaña al wordmark (decorativo), para no duplicar
 * la lectura del nombre en lectores de pantalla.
 */
export function LogoMark({ className, alt = "ecognIA" }: { className?: string; alt?: string }) {
  return (
    <Image
      src="/isotipo-ecognia.png"
      alt={alt}
      width={363}
      height={319}
      priority
      className={cn("h-8 w-auto", className)}
    />
  );
}

/**
 * Wordmark tipográfico: "ecogn" en azul + "IA" en menta, en la fuente
 * display (Sora). Escala con `text-*` desde el contenedor.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-primary text-2xl font-bold tracking-tight", className)}>
      ecogn<span className="text-brand-mint">IA</span>
    </span>
  );
}

/**
 * Lockup completo: isotipo PNG + wordmark de texto.
 * `markClassName` / `wordmarkClassName` ajustan tamaños por sitio de uso.
 */
export function Logo({
  className,
  showWordmark = true,
  markClassName,
  wordmarkClassName,
}: {
  className?: string;
  showWordmark?: boolean;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={markClassName} alt={showWordmark ? "" : "ecognIA"} />
      {showWordmark && <Wordmark className={wordmarkClassName} />}
    </span>
  );
}
