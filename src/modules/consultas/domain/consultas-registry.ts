/**
 * Catálogo de consultas disponibles. Para añadir una nueva consulta:
 *
 * 1. Crea `src/modules/consultas/domain/queries/<nombre>/` con su DTO
 *    (p.ej. `FormulacionRow` para la primera consulta).
 * 2. Crea un UseCase en `application/` que devuelve `Result<T[]>`.
 * 3. Crea un fetcher en `infrastructure/` que implementa el acceso a BD.
 * 4. Wire ambos en `infrastructure/container.ts` (`makeList<Nombre>()`).
 * 5. Añade un entry al array `CONSULTAS` con su `id`, `title`, `description`
 *    y `columns` (texto de cabeceras).
 *
 * Importante: `id` se usa como path segment (`/admin/consultas/<id>`) —
 * kebab-case, sin acentos, sin espacios.
 */
import type { ConsultaConfig } from "./consulta";

export const CONSULTAS: readonly ConsultaConfig[] = [
  {
    id: "formulaciones",
    title: "Listado de Formulaciones",
    description:
      "Maestro de formulaciones de la institución con asignatura, año, prueba, tipo de cuadernillo, estado, ítems (X/Y vs regla), profesor autor y docentes asignados al curso-grado.",
    columns: [
      "Asignatura",
      "Año",
      "Prueba",
      "Tipo de cuadernillo",
      "Estado",
      "Items",
      "Autor",
      "Asignados",
      "Actualizado",
    ],
  },
] as const;

export function findConsulta(id: string): ConsultaConfig | undefined {
  return CONSULTAS.find((c) => c.id === id);
}
