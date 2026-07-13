import type { Metadata } from "next";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { makeListUsers } from "@/modules/users/infrastructure/container";
import { InviteUserForm, RolesEditor } from "./users-forms";
import { ResendInviteButton } from "./resend-invite-button";
import { ROLE_OPTIONS } from "./roles";
import { setUserActiveAction } from "./actions";

export const metadata: Metadata = { title: "Usuarios" };

const roleLabel = new Map(ROLE_OPTIONS.map((o) => [o.value, o.label]));

export default async function UsersPage() {
  const actor = await requireAuthenticatedUser("ADMIN");
  const result = await makeListUsers().execute({ actor });
  const users = result.ok ? result.value : [];

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Invita coordinadores y docentes, y gestiona sus roles combinables (§2)."
      />

      <InviteUserForm />

      <div className="mt-8 overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground border-b text-left">
            <tr>
              <th className="px-4 py-3 font-medium">Nombre</th>
              <th className="px-4 py-3 font-medium">Correo</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Roles</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-muted-foreground px-4 py-8 text-center">
                  Aún no hay usuarios.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b align-top last:border-0">
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="text-muted-foreground px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        u.isActive
                          ? "bg-primary/10 text-primary inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                          : "bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                      }
                    >
                      {u.isActive ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.roles.includes("SUPER_ADMIN") ? (
                      <span className="text-muted-foreground text-xs">
                        SUPER_ADMIN{u.roles.length > 1 ? " + " : ""}
                        {u.roles
                          .filter((r) => r !== "SUPER_ADMIN")
                          .map((r) => roleLabel.get(r))
                          .join(", ")}
                      </span>
                    ) : (
                      <RolesEditor userId={u.id} roles={u.roles} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {u.id === actor.userId ? (
                      <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      <div className="flex flex-col items-start gap-2">
                        <form action={setUserActiveAction}>
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="isActive" value={String(!u.isActive)} />
                          <Button type="submit" variant="outline" size="sm">
                            {u.isActive ? "Desactivar" : "Activar"}
                          </Button>
                        </form>
                        {!u.isActive ? <ResendInviteButton userId={u.id} /> : null}
                      </div>
                    )}
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
