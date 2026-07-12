import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { makeListInstitutions } from "@/modules/institutions/infrastructure/container";
import { CreateInstitutionForm } from "./create-institution-form";
import { toggleInstitutionActiveAction } from "./actions";

export const metadata: Metadata = { title: "Instituciones" };

const dateFmt = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

export default async function InstitutionsPage() {
  const actor = await requireAuthenticatedUser("SUPER_ADMIN");
  const result = await makeListInstitutions().execute({ actor });
  const institutions = result.ok ? result.value : [];

  return (
    <>
      <PageHeader
        title="Instituciones"
        description="Registra y administra las instituciones de la plataforma (SUPER_ADMIN)."
      />

      <CreateInstitutionForm />

      <div className="mt-8 overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Código</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Creada</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {institutions.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-muted-foreground px-4 py-8 text-center">
                  Aún no hay instituciones.
                </td>
              </tr>
            ) : (
              institutions.map((inst) => (
                <tr key={inst.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">{inst.name}</td>
                  <td className="text-muted-foreground px-4 py-3">{inst.slug}</td>
                  <td className="text-muted-foreground px-4 py-3">{inst.code}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        inst.isActive
                          ? "bg-primary/10 text-primary inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                          : "bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                      }
                    >
                      {inst.isActive ? "Activa" : "Inactiva"}
                    </span>
                  </td>
                  <td className="text-muted-foreground px-4 py-3">
                    {dateFmt.format(inst.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <form action={toggleInstitutionActiveAction}>
                      <input type="hidden" name="id" value={inst.id} />
                      <input type="hidden" name="isActive" value={String(!inst.isActive)} />
                      <Button type="submit" variant="outline" size="sm">
                        {inst.isActive ? "Desactivar" : "Activar"}
                      </Button>
                    </form>
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
