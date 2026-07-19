import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/session";
import { hasRole } from "@/shared/application/authenticated-user";

export default async function HomePage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  // Redirige al panel según el rol principal
  if (hasRole(user, "SUPER_ADMIN", "ECU_MASTER")) redirect("/admin");
  if (hasRole(user, "COORDINATOR")) redirect("/coordinator");
  redirect("/teacher");
}
