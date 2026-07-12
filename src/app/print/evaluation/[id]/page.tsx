import type { Metadata } from "next";
import "@/styles/print.css";
import { requireAuthenticatedUser } from "@/lib/session";

export const metadata: Metadata = { title: "Cartilla de impresión" };

/**
 * Vista de impresión de una evaluación (cartilla doble carta ICFES).
 * Método primario de PDF: el docente imprime esta página desde el navegador
 * (Print CSS con @page tabloid). Puppeteer es el secundario para descarga.
 *
 * Placeholder de la Fase 2/3: aún no lee la evaluación de la BD ni arma
 * portada + preguntas. La maqueta debe validarse contra
 * Prueba__11º_I_periodo_C3__1_.pdf (REQUERIMIENTOS_v2.md §3.4).
 */
export default async function PrintEvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // /print/* requiere sesión (ver auth.config.ts): las cartillas llevan contenido de evaluación.
  await requireAuthenticatedUser();

  return (
    <article>
      <div className="no-print bg-muted/40 text-muted-foreground border-b p-4 text-sm">
        Vista de impresión — usa <kbd>Ctrl/Cmd + P</kbd> para generar el PDF. Evaluación:{" "}
        <code>{id}</code>
      </div>

      {/* TODO Fase 2: portada con las secciones COVER_SECTIONS + páginas de preguntas + hoja OMR */}
      <section className="cover-institution mt-8">
        {/* Placeholder: renderizar nombre de institución, título, grado, cuadernillo, ¡Hola!… */}
        Cartilla en construcción.
      </section>
    </article>
  );
}
