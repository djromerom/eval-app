import { cn } from "@/lib/utils";
import { renderRichText, unwrapSingleParagraph } from "./render";

/**
 * Muestra contenido rico (TipTap JSON o string) ya renderizado con KaTeX.
 * Componente de servidor: se usa en el detalle de evaluación y en la impresión.
 * La clase `prose-eval` (globals.css) da estilos básicos de tipografía.
 */
export function RichText({ value, className }: { value: unknown; className?: string }) {
  const html = renderRichText(value);
  if (!html) return null;
  return <div className={cn("prose-eval", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Variante inline (para opciones y textos cortos con posibles fórmulas).
 * Desenvuelve el `<p>` de TipTap cuando es un solo párrafo, para que el texto
 * quede en la misma línea que lo que lo precede ("319. ¿Qué inicia…").
 */
export function RichTextInline({ value, className }: { value: unknown; className?: string }) {
  const html = unwrapSingleParagraph(renderRichText(value));
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
