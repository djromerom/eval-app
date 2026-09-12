/**
 * Catálogo de consultas disponibles. Para añadir una nueva consulta:
 *
 * 1. Crea `src/modules/consultas/domain/queries/<nombre>/` con su DTO
 *    (p.ej. `FormulacionRow` para la primera consulta).
 * 2. Crea un UseCase en `application/` que devuelve `Result<T[]>`.
 * 3. Crea un fetcher en `infrastructure/` que implementa el acceso a BD.
 * 4. Wire ambos en `infrastructure/container.ts` (`makeList<Nombre>()`).
 * 5. Añade un entry al array `CONSULTAS` con su `id`, `title`, `description`,
 *    `columns` (texto de cabeceras) y `roles` (quién ve la card).
 *
 * Importante: `id` se usa como path segment (`/admin/consultas/<id>`) —
 * kebab-case, sin acentos, sin espacios.
 */
import type { Role } from "@/shared/application/authenticated-user";
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
    roles: ["ECU_MASTER", "SUPER_ADMIN"],
  },
  {
    id: "calificaciones",
    title: "Calificaciones por grado y grupo",
    description:
      "Una fila por hoja escaneada e identificada: estudiante, grado, grupo, prueba y puntaje en escala 0-10 con piso de 3. Incluye las que aún no tienen puntaje, marcadas como pendientes. Las hojas cuyo QR no se pudo resolver no aparecen: se atienden en la revisión del lote. El líder ECU ve solo los grados que tiene asignados.",
    columns: [
      "Estudiante",
      "Código",
      "Grado",
      "Grupo",
      "Cuadernillo",
      "Prueba",
      "Tipo",
      "Estado",
      "Correctas",
      "Total",
      "Puntaje",
    ],
    roles: ["ECU_MASTER", "SUPER_ADMIN", "ECU_LIDER"],
  },
] as const;

/** Consultas visibles para un conjunto de roles. La usa `/admin/consultas`
 *  para armar el grid de cards, y la ruta de detalle para 404 temprano si el
 *  actor no tiene por qué conocer esa consulta. */
export function consultasFor(roles: readonly Role[]): readonly ConsultaConfig[] {
  return CONSULTAS.filter((c) => c.roles.some((r) => roles.includes(r)));
}

export function findConsulta(id: string): ConsultaConfig | undefined {
  return CONSULTAS.find((c) => c.id === id);
}
