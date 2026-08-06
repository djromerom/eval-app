"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { TeachersImportForm } from "../import-form";
import { TeachersTopbarActions } from "./teachers-topbar-actions";

/**
 * Bloque cliente de `admin/teachers` que envuelve:
 *  - El topbar con el botón "Importar XLSX/CSV".
 *  - El drawer lateral que se abre con `?import=teachers=1` y contiene el
 *    formulario de importación masiva.
 *
 * El resto del `page.tsx` (server component) se renderiza inline sin
 * envoltorio — este chrome se inserta entre el PageHeader y los `<section>`
 * existentes para no tocar el flujo actual.
 *
 * Escape del teclado cierra el drawer.
 */
export function TeachersPageChrome() {
  const router = useRouter();
  const params = useSearchParams();
  const showImport = params.get("import") === "teachers=1";

  const close = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("import");
    router.push(url.pathname, { scroll: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showImport) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showImport]);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <TeachersTopbarActions />
      </div>

      {showImport ? (
        <>
          <Link
            href="/admin/teachers"
            aria-label="Cerrar drawer"
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
          />
          <aside
            aria-label="Importar docentes"
            className="bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l shadow-xl"
          >
            <header className="bg-muted/30 flex items-center justify-between gap-2 border-b p-5">
              <div>
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Importación masiva
                </p>
                <h1 className="font-display text-xl font-bold">Importar XLSX/CSV</h1>
              </div>
              <Link
                href="/admin/teachers"
                aria-label="Cerrar"
                className="hover:bg-muted inline-flex h-9 w-9 items-center justify-center rounded-md border"
              >
                <span aria-hidden>✕</span>
              </Link>
            </header>
            <div className="flex-1 overflow-y-auto p-6">
              <TeachersImportForm />
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}
