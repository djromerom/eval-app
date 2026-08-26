import { ArrowDownUp, Search } from "lucide-react";

export interface FilterRowProps {
  yearsCount: number;
  periodsCount: number;
  coursesCount: number;
  subjectsCount: number;
}

/**
 * Fila con buscador + 5 tabs + sort dropdown.
 *
 * Por ahora los tabs y el buscador son solo visuales (no conectan a un
 * estado real): la página sigue mostrando el detalle completo por año.
 * El Pencil los dejó preparados para cuando crezca el dataset.
 */
export function FilterRow({
  yearsCount,
  periodsCount,
  coursesCount,
  subjectsCount,
}: FilterRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="border-input bg-background flex h-9 w-[380px] max-w-full items-center gap-2 rounded-lg border px-3 text-sm">
        <Search className="text-muted-foreground h-4 w-4" />
        <input
          type="search"
          placeholder="Buscar año, prueba, grado, asignatura…"
          className="text-muted-foreground placeholder:text-muted-foreground w-full bg-transparent outline-none"
        />
      </div>

      <Tab label="Todos" active />
      <Tab label={`Años (${yearsCount})`} />
      <Tab label={`Pruebas (${periodsCount})`} />
      <Tab label={`Grados (${coursesCount})`} />
      <Tab label={`Asignaturas (${subjectsCount})`} />

      <span className="flex-1" />

      <button
        type="button"
        className="border-input bg-background text-muted-foreground flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
      >
        <ArrowDownUp className="h-3.5 w-3.5" />
        Más recientes
      </button>
    </div>
  );
}

function Tab({ label, active }: { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={
        active
          ? "bg-primary text-primary-foreground inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium"
          : "border-input bg-background inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium"
      }
    >
      {label}
    </button>
  );
}
