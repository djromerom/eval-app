import { CalendarRange, ListChecks, BookOpen, GraduationCap } from "lucide-react";

export interface KpiStripProps {
  yearsCount: number;
  activePeriods: number;
  coursesCount: number;
  subjectsCount: number;
}

/**
 * Tira de 4 KPI cards que aparece justo debajo del PageHeader.
 * Coincide con el `KPI strip` del Pencil.
 */
export function KpiStrip({
  yearsCount,
  activePeriods,
  coursesCount,
  subjectsCount,
}: KpiStripProps) {
  return (
    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={<CalendarRange className="text-muted-foreground h-4 w-4" />}
        label="Años académicos"
        value={yearsCount}
        hint={yearsCount === 1 ? "1 año configurado" : `${yearsCount} años configurados`}
      />
      <KpiCard
        icon={<ListChecks className="text-muted-foreground h-4 w-4" />}
        label="Periodos activos"
        value={activePeriods}
        hint={activePeriods === 0 ? "Ninguno en curso" : "En curso ahora mismo"}
      />
      <KpiCard
        icon={<GraduationCap className="text-muted-foreground h-4 w-4" />}
        label="Cursos"
        value={coursesCount}
        hint={coursesCount === 0 ? "Sin cursos todavía" : `${coursesCount} cursos`}
      />
      <KpiCard
        icon={<BookOpen className="text-muted-foreground h-4 w-4" />}
        label="Asignaturas"
        value={subjectsCount}
        hint={`${subjectsCount} en total`}
      />
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center justify-between text-xs font-medium">
        <span>{label}</span>
        {icon}
      </div>
      <div className="font-display mt-2 text-3xl leading-none font-bold">{value}</div>
      <div className="text-muted-foreground mt-2 text-xs">{hint}</div>
    </div>
  );
}
