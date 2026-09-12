"use client";

import {
  ESTADOS,
  type EstadoCalificacion,
} from "@/modules/consultas/domain/queries/calificaciones/estado";

export interface CalificacionesFilterState {
  courseId: string; // "" = todos los grados
  groupId: string; // "" = todos los grupos
  periodId: string; // "" = todas las pruebas
  bookletTypeId: string; // "" = todos los tipos
  /** Estado de la última hoja del estudiante. "todas" no filtra. */
  estado: EstadoCalificacion | "todas";
}

export const EMPTY_CALIFICACIONES_FILTERS: CalificacionesFilterState = {
  courseId: "",
  groupId: "",
  periodId: "",
  bookletTypeId: "",
  // Arranca en "calificada" a propósito: el uso normal de la consulta es el
  // boletín. Los otros estados son para ir a buscar problemas, y el
  // desplegable muestra cuál está activo — no es un filtro escondido.
  estado: "calificada",
};

export interface OpcionGrado {
  id: string;
  name: string;
}
export interface OpcionGrupo {
  id: string;
  name: string;
  courseId: string;
}
/** Prueba (Period) o tipo de cuadernillo (BookletType): mismo shape. */
export interface OpcionSimple {
  id: string;
  name: string;
}

/** Filter row controlado de la consulta "Calificaciones".
 *
 *  Los grupos se encadenan al grado: elegir un grado acota el desplegable de
 *  grupos a los suyos. Si había un grupo elegido de otro grado, el padre lo
 *  limpia al cambiar el grado — dejarlo produciría una tabla vacía sin que se
 *  entienda por qué. */
export function CalificacionesFilterRow({
  filters,
  onChange,
  gradoOptions,
  grupoOptions,
  pruebaOptions,
  tipoOptions,
}: {
  filters: CalificacionesFilterState;
  onChange: (next: CalificacionesFilterState) => void;
  gradoOptions: OpcionGrado[];
  grupoOptions: OpcionGrupo[];
  pruebaOptions: OpcionSimple[];
  tipoOptions: OpcionSimple[];
}) {
  const grupos = filters.courseId
    ? grupoOptions.filter((g) => g.courseId === filters.courseId)
    : grupoOptions;

  const select =
    "border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-hidden";

  return (
    <div className="bg-card flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Grado</span>
        <select
          className={select}
          value={filters.courseId}
          onChange={(e) => {
            const courseId = e.target.value;
            // Al cambiar de grado, un grupo de otro grado deja de tener sentido.
            const sigueValiendo =
              filters.groupId &&
              grupoOptions.some((g) => g.id === filters.groupId && g.courseId === courseId);
            onChange({ ...filters, courseId, groupId: sigueValiendo ? filters.groupId : "" });
          }}
        >
          <option value="">Todos los grados</option>
          {gradoOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Grupo</span>
        <select
          className={select}
          value={filters.groupId}
          onChange={(e) => onChange({ ...filters, groupId: e.target.value })}
        >
          <option value="">Todos los grupos</option>
          {grupos.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Prueba</span>
        <select
          className={select}
          value={filters.periodId}
          onChange={(e) => onChange({ ...filters, periodId: e.target.value })}
        >
          <option value="">Todas las pruebas</option>
          {pruebaOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Tipo</span>
        <select
          className={select}
          value={filters.bookletTypeId}
          onChange={(e) => onChange({ ...filters, bookletTypeId: e.target.value })}
        >
          <option value="">Todos los tipos</option>
          {tipoOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Estado</span>
        <select
          className={select}
          value={filters.estado}
          onChange={(e) =>
            onChange({ ...filters, estado: e.target.value as CalificacionesFilterState["estado"] })
          }
        >
          {ESTADOS.map((e) => (
            <option key={e.valor} value={e.valor}>
              {e.etiqueta}
            </option>
          ))}
          <option value="todas">Todas</option>
        </select>
      </label>

      {(filters.courseId ||
        filters.groupId ||
        filters.periodId ||
        filters.bookletTypeId ||
        filters.estado !== "calificada") && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_CALIFICACIONES_FILTERS)}
          className="text-muted-foreground hover:text-foreground ml-auto text-xs underline"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}
