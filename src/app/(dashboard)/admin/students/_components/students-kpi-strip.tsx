import { StatCard } from "@/components/dashboard/stat-card";

export interface StudentsKpiStripProps {
  total: number;
  active: number;
  groupsUsed: number;
  enrolledThisYear: number;
  currentYear: number;
}

/**
 * KPI strip de `admin/students` (Fase 12). Cuatro `StatCard` con identidad
 * ecognIA (azul `#0A4FA8` accent en la primera). Datos calculados en el
 * server component padre (`page.tsx`).
 *
 * Reutiliza `<StatCard>` de `components/dashboard/stat-card.tsx` (alineado
 * con el resto del dashboard).
 */
export function StudentsKpiStrip({
  total,
  active,
  groupsUsed,
  enrolledThisYear,
  currentYear,
}: StudentsKpiStripProps) {
  const inactive = total - active;
  const activeRatio = total === 0 ? 0 : Math.round((active / total) * 100);

  return (
    <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <StatCard
        label="Total estudiantes"
        value={total}
        hint={total === 0 ? "Sin estudiantes aún." : `${active} activos · ${inactive} inactivos`}
        accent
      />
      <StatCard
        label="Activos"
        value={total > 0 ? `${active} (${activeRatio}%)` : "0"}
        hint={total === 0 ? "—" : "Disponibles para formulaciones"}
        hintTone={total === 0 || activeRatio >= 90 ? "muted" : "warning"}
      />
      <StatCard
        label="Grupos usados"
        value={groupsUsed}
        hint={groupsUsed === 0 ? "Sin asignaciones aún." : "Distribuidos en la institución"}
      />
      <StatCard
        label={`Ingresados ${currentYear}`}
        value={enrolledThisYear}
        hint={enrolledThisYear > 0 ? `Año académico ${currentYear}` : "Sin ingresos este año"}
        hintTone={enrolledThisYear > 0 ? "success" : "muted"}
      />
    </div>
  );
}
