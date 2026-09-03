import type { Metadata } from "next";
import Link from "next/link";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { CONSULTAS } from "@/modules/consultas/domain/consultas-registry";

export const metadata: Metadata = { title: "Consultas" };

/**
 * Registry de consultas disponibles. Muestra 1 card por consulta configurada
 * en `src/modules/consultas/domain/consultas-registry.ts`; cuando se añadan
 * nuevas entradas, aparecerán aquí automáticamente.
 *
 * Por ahora solo hay una consulta: `formulaciones`. Se renderiza la card
 * directamente con `<Link>` a `/admin/consultas/formulaciones`.
 *
 * Capability `run-queries` ya está chequeada por el sidebar (item oculto si
 * no aplica); aquí se duplica el gate como segunda barrera.
 */
export default async function ConsultasPage() {
  await requireAuthenticatedUser("SUPER_ADMIN", "ECU_MASTER");

  return (
    <>
      <PageHeader
        title="Consultas"
        description="Listados predefinidos sobre datos institucionales. Cada consulta es de solo lectura y muestra el estado real de la base de datos."
      />
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CONSULTAS.map((c) => (
          <Link
            key={c.id}
            href={`/admin/consultas/${c.id}`}
            className="bg-card hover:border-primary/40 hover:bg-accent/30 group flex flex-col gap-2 rounded-xl border p-5 transition-colors"
          >
            <h2 className="font-display text-lg font-semibold">{c.title}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">{c.description}</p>
            <span className="text-primary mt-auto text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100">
              Abrir consulta →
            </span>
          </Link>
        ))}
      </section>
    </>
  );
}
