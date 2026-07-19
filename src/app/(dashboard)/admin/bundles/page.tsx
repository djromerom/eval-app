import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { requireAuthenticatedUser } from "@/lib/session";
import { makeListBundles } from "@/modules/bundles/infrastructure/container";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Compendios" };

const dateFmt = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador",
  READY: "Listo",
};

export default async function BundlesListPage() {
  const actor = await requireAuthenticatedUser("ECU_MASTER");
  const result = await makeListBundles().execute({ actor });
  const bundles = result.ok ? result.value : [];

  return (
    <>
      <PageHeader
        title="Compendios"
        description="Agrupa varias evaluaciones aprobadas en un único cuadernillo para imprimir (compendios multi-asignatura)."
      />

      <div className="mb-4 flex justify-end">
        <Link href="/admin/bundles/new" className={cn(buttonVariants())}>
          Nuevo compendio
        </Link>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">N° cuadernillo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Creado</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {bundles.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-4 py-8 text-center">
                  Aún no hay compendios. Crea uno para empezar.
                </td>
              </tr>
            ) : (
              bundles.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <Link href={`/admin/bundles/${b.id}`} className="hover:underline">
                      {b.name}
                    </Link>
                  </td>
                  <td className="text-muted-foreground px-4 py-3">{b.bookletNumber ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        b.status === "READY"
                          ? "bg-primary/10 text-primary inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                          : "bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                      }
                    >
                      {STATUS_LABEL[b.status] ?? b.status}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-4 py-3">{dateFmt.format(b.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bundles/${b.id}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                    >
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
