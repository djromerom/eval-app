import type { Metadata } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { requireAuthenticatedUser } from "@/lib/session";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/shared/infrastructure/db/prisma";
import { parseInstitutionalTheme } from "@/modules/theme/domain/theme";
import { env } from "@/config/env";
import { ThemeForm } from "./theme-form";

export const metadata: Metadata = { title: "Tema institucional" };

export const dynamic = "force-dynamic";

/**
 * Página de configuración del tema institucional. Solo accesible para ADMIN
 * (y SUPER_ADMIN). Lee el JSON crudo de `Institution.theme` para no perder
 * campos futuros que el dominio aún no conoce (forward-compat: cualquier
 * basura queda descartada por `parseInstitutionalTheme()`).
 */
export default async function ThemePage() {
  const actor = await requireAuthenticatedUser("ADMIN", "SUPER_ADMIN");
  const inst = await prisma.institution.findUnique({
    where: { id: actor.institutionId },
    select: { id: true, name: true, logo: true, theme: true },
  });
  if (!inst) {
    return (
      <>
        <PageHeader title="Tema institucional" description="Institución no encontrada." />
      </>
    );
  }

  const initial = parseInstitutionalTheme(inst.theme);

  // Logo en data URL para preview (mismo truco que print page).
  let logoUrl: string | null = null;
  if (inst.logo) {
    try {
      const candidates = [inst.logo, join(env.STORAGE_DIR, inst.logo)];
      const found = candidates.find((p) => existsSync(p));
      if (found) {
        const buf = readFileSync(found);
        const ext = found.toLowerCase().endsWith(".png") ? "png" : "jpeg";
        logoUrl = `data:image/${ext};base64,${buf.toString("base64")}`;
      }
    } catch {
      logoUrl = null;
    }
  }

  return (
    <>
      <PageHeader
        title="Tema institucional"
        description={`Personaliza cómo se imprimen los cuadernillos de ${inst.name}.`}
      />

      <ThemeForm initial={initial} logoUrl={logoUrl} logoPath={inst.logo} />
    </>
  );
}
