"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, Pencil, Search, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EntityForm } from "@/components/admin/entity-form";
import type { Student } from "@/modules/students/domain/student";
import { ID_TYPES } from "@/modules/students/domain/student";
import { createStudentAction } from "../actions";
import { ImportForm } from "../import-form";
import { StudentsEmpty } from "./students-empty";
import { StudentsTopbarActions } from "./students-topbar-actions";

export interface GroupLookup {
  /** id del grupo → nombre. */
  byId: Record<string, string>;
  /** Lista de grupos para el EntityForm (options del select). */
  options: { value: string; label: string }[];
}

export interface StudentsPageClientProps {
  students: Student[];
  groups: GroupLookup;
  currentYear: number;
}

type StatusTab = "all" | "active" | "inactive";

/**
 * Bloque cliente principal de `admin/students` (Fase 12). Mantiene:
 * - Search (nombre / código / documento / nombre de grupo) client-side.
 * - Tabs Todos / Activos / Inactivos client-side.
 * - Sort por nombre o por año de ingreso.
 * - Tabla densa (cada fila clickable → sub-ruta `/[id]/edit`).
 * - Topbar actions con drawers via query params:
 *     * `?new=1`   → renderiza el EntityForm inline arriba de la tabla.
 *     * `?import=1`→ drawer lateral con el form de importar.
 *
 * Edición y eliminación viven en `/admin/students/[id]/edit` (ruta
 * independiente). Aquí solo se navega.
 */
export function StudentsPageClient({ students, groups, currentYear }: StudentsPageClientProps) {
  const router = useRouter();
  const params = useSearchParams();

  const showNew = params.get("new") === "1";
  const showImport = params.get("import") === "1";

  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<StatusTab>("all");
  const [sortBy, setSortBy] = useState<"name" | "year">("name");

  // Cuando el form de alta termina con éxito (`createStudentAction` devuelve
  // `success: true`), limpiamos el query `?new=1` para que el form se cierre.
  // El form ya hace `revalidatePath`; usamos un effect para detectar el
  // cambio de `students.length` no es necesario — basta con el redirect del
  // próximo submit. Aquí basta con cerrar el form al cambiar la URL.
  const closeQuery = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    url.searchParams.delete("import");
    router.push(url.pathname, { scroll: false });
  };

  // Cerrar el drawer de import con la X.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (showNew || showImport)) closeQuery();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNew, showImport]);

  // ===== Conteos por tab =====
  const counts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    for (const s of students) {
      if (s.isActive) active++;
      else inactive++;
    }
    return { all: students.length, active, inactive };
  }, [students]);

  // ===== Filtro + sort =====
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const splitTerms = term.split(/\s+/).filter(Boolean);
    const filtered = students.filter((s) => {
      // status tab
      if (tab === "active" && !s.isActive) return false;
      if (tab === "inactive" && s.isActive) return false;
      // search
      if (splitTerms.length === 0) return true;
      const groupName = (groups.byId[s.groupId] ?? "").toLowerCase();
      const haystack = [
        `${s.lastName1} ${s.lastName2} ${s.firstName1} ${s.firstName2}`.trim(),
        s.code,
        `${s.idType} ${s.idNumber}`,
        s.idNumber,
        groupName,
      ]
        .join(" ")
        .toLowerCase();
      return splitTerms.every((t) => haystack.includes(t));
    });
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === "year") {
        if (a.enrollmentYear !== b.enrollmentYear) return b.enrollmentYear - a.enrollmentYear;
      }
      return `${a.lastName1} ${a.firstName1}`.localeCompare(`${b.lastName1} ${b.firstName1}`, "es");
    });
    return sorted;
  }, [students, search, tab, sortBy, groups]);

  return (
    <div className="space-y-4">
      {/* ===== Topbar: topbar actions a la derecha ===== */}
      <div className="flex items-center justify-between gap-3">
        <FilterRow
          search={search}
          onSearch={setSearch}
          counts={counts}
          tab={tab}
          onTab={setTab}
          sortBy={sortBy}
          onSortBy={setSortBy}
        />
        <StudentsTopbarActions />
      </div>

      {/* ===== Form de alta inline (cuando ?new=1) ===== */}
      {showNew ? (
        <div className="bg-card relative rounded-2xl border p-6 shadow-sm">
          <button
            type="button"
            onClick={closeQuery}
            aria-label="Cerrar"
            className="hover:bg-muted absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-md"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="font-display mb-4 text-base font-bold">Nuevo estudiante</h2>
          {groups.options.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Crea primero un grupo en{" "}
              <Link href="/admin/academic" className="underline">
                Estructura académica
              </Link>
              .
            </p>
          ) : (
            <EntityForm
              action={createStudentAction}
              submitLabel="Agregar"
              fields={[
                {
                  name: "groupId",
                  label: "Grupo",
                  type: "select",
                  required: true,
                  options: groups.options,
                },
                {
                  name: "lastName1",
                  label: "Apellido 1",
                  type: "text",
                  required: true,
                  placeholder: "Pérez",
                },
                {
                  name: "lastName2",
                  label: "Apellido 2",
                  type: "text",
                  required: false,
                  placeholder: "García",
                },
                {
                  name: "firstName1",
                  label: "Nombre 1",
                  type: "text",
                  required: true,
                  placeholder: "Ana",
                },
                {
                  name: "firstName2",
                  label: "Nombre 2",
                  type: "text",
                  required: false,
                  placeholder: "María",
                },
                {
                  name: "idType",
                  label: "Tipo doc.",
                  type: "select",
                  required: true,
                  options: ID_TYPES.map((t) => ({ value: t, label: t })),
                },
                { name: "idNumber", label: "N.º doc.", type: "text", required: true },
                {
                  name: "code",
                  label: "Código",
                  type: "text",
                  required: true,
                  placeholder: "EST-001",
                },
                {
                  name: "enrollmentYear",
                  label: "Año ingreso",
                  type: "number",
                  required: true,
                  placeholder: String(currentYear),
                  min: 1990,
                },
              ]}
            />
          )}
        </div>
      ) : null}

      {/* ===== Drawer de import (cuando ?import=1) ===== */}
      {showImport ? (
        <>
          <Link
            href="/admin/students"
            aria-label="Cerrar drawer"
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
          />
          <aside
            aria-label="Importar CSV"
            className="bg-background fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col border-l shadow-xl"
          >
            <header className="bg-muted/30 flex items-center justify-between gap-2 border-b p-5">
              <div>
                <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Importación masiva
                </p>
                <h1 className="font-display text-xl font-bold">Importar CSV</h1>
              </div>
              <Link
                href="/admin/students"
                aria-label="Cerrar"
                className="hover:bg-muted inline-flex h-9 w-9 items-center justify-center rounded-md border"
              >
                <span aria-hidden>✕</span>
              </Link>
            </header>
            <div className="flex-1 overflow-y-auto p-6">
              <ImportForm />
              <p className="text-muted-foreground mt-6 text-xs">
                Las columnas requeridas son: nombre, tipo_doc, num_doc, código, grupo (por nombre) y
                año de ingreso. Separador coma o punto y coma.
              </p>
            </div>
          </aside>
        </>
      ) : null}

      {/* ===== Tabla o estado vacío ===== */}
      {students.length === 0 ? (
        <StudentsEmpty hasGroups={groups.options.length > 0} />
      ) : visible.length === 0 ? (
        <div className="bg-card rounded-2xl border p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Ningún estudiante coincide con los filtros actuales.
          </p>
        </div>
      ) : (
        <StudentsTable students={visible} groupLookup={groups.byId} />
      )}
    </div>
  );
}

// ===== Sub-componentes =====

function FilterRow({
  search,
  onSearch,
  counts,
  tab,
  onTab,
  sortBy,
  onSortBy,
}: {
  search: string;
  onSearch: (v: string) => void;
  counts: { all: number; active: number; inactive: number };
  tab: StatusTab;
  onTab: (t: StatusTab) => void;
  sortBy: "name" | "year";
  onSortBy: (s: "name" | "year") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="border-input bg-background flex h-9 w-[380px] max-w-full items-center gap-2 rounded-lg border px-3 text-sm">
        <Search className="text-muted-foreground h-4 w-4" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Buscar nombre, código, documento o grupo…"
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>

      <TabButton active={tab === "all"} onClick={() => onTab("all")}>
        Todos · {counts.all}
      </TabButton>
      <TabButton active={tab === "active"} onClick={() => onTab("active")}>
        Activos · {counts.active}
      </TabButton>
      <TabButton active={tab === "inactive"} onClick={() => onTab("inactive")}>
        Inactivos · {counts.inactive}
      </TabButton>

      <span className="flex-1" />

      <button
        type="button"
        onClick={() => onSortBy(sortBy === "name" ? "year" : "name")}
        className="border-input bg-background text-muted-foreground hover:text-foreground inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium"
      >
        <ArrowDownUp className="h-3.5 w-3.5" />
        {sortBy === "name" ? "Por nombre" : "Por año de ingreso"}
      </button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "bg-primary text-primary-foreground inline-flex h-9 items-center rounded-lg px-3 text-xs font-semibold"
          : "border-input bg-background text-muted-foreground hover:text-foreground inline-flex h-9 items-center rounded-lg border px-3 text-xs font-semibold"
      }
    >
      {children}
    </button>
  );
}

function StudentsTable({
  students,
  groupLookup,
}: {
  students: Student[];
  groupLookup: Record<string, string>;
}) {
  return (
    <div className="bg-card overflow-x-auto rounded-2xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-muted-foreground border-b text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Nombre</th>
            <th className="px-4 py-3 font-medium">Documento</th>
            <th className="px-4 py-3 font-medium">Código</th>
            <th className="px-4 py-3 font-medium">Grupo</th>
            <th className="px-4 py-3 font-medium">Ingreso</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 text-right font-medium">Acción</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.id} className="hover:bg-muted/30 border-b transition-colors last:border-0">
              <td className="px-4 py-3 font-medium">
                {`${s.lastName1} ${s.lastName2} ${s.firstName1} ${s.firstName2}`.replace(/\s+/g, " ").trim()}
              </td>
              <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                {s.idType} {s.idNumber}
              </td>
              <td className="text-muted-foreground px-4 py-3 font-mono text-xs">{s.code}</td>
              <td className="text-muted-foreground px-4 py-3">{groupLookup[s.groupId] ?? "—"}</td>
              <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">
                {s.enrollmentYear}
              </td>
              <td className="px-4 py-3">
                <span
                  className={
                    s.isActive
                      ? "bg-primary/10 text-primary inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                      : "bg-muted text-muted-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
                  }
                >
                  {s.isActive ? "Activo" : "Inactivo"}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/admin/students/${s.id}/edit`}
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Editar
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Re-exports evitados: la `ImportForm` ya consume su propio state.
