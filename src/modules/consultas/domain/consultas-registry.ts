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
    id: "formuladores",
    title: "Docentes formuladores por cuadernillo",
    description:
      "Una fila por docente asignado a un cuadernillo (con sus datos de contacto) y, además, las formulaciones que quedaron sin docente asignado. Indica el grado, la asignatura, la prueba y el estado de cobertura del cuadernillo.",
    columns: [
      "Cuadernillo",
      "Grado",
      "Asignatura",
      "Formulador",
      "Tipo doc.",
      "ID",
      "Email",
      "Celular",
      "Prueba",
      "Formulación",
      "Estado",
    ],
    roles: ["ECU_MASTER", "SUPER_ADMIN"],
  },
  {
    id: "calificaciones",
    title: "Calificaciones por grado y grupo",
    description:
      "Una fila por estudiante y prueba: la última calificación cargada, con grado, grupo y puntaje en escala 0-10 con piso de 3. Las hojas sin calificar y las que no se pudieron identificar no aparecen: se atienden en la revisión del lote. El líder ECU ve solo los grados que tiene asignados.",
    columns: [
      "Estudiante",
      "Código",
      "Grado",
      "Grupo",
      "Cuadernillo",
      "Prueba",
      "Tipo",
      "Correctas",
      "Total",
      "Puntaje",
    ],
    roles: ["ECU_MASTER", "SUPER_ADMIN", "ECU_LIDER"],
  },
  {
    id: "informe-grupo",
    title: "Informe detallado por grupo",
    description:
      "Puntaje por asignatura de cada estudiante del grupo en una prueba, consolidando todos los cuadernillos del grado.",
    columns: ["Item", "Nombre", "Asignaturas"],
    roles: ["ECU_MASTER", "SUPER_ADMIN", "ECU_LIDER"],
  },
  {
    id: "reglas-conteo",
    title: "Reglas de conteo por prueba",
    description:
      "Una fila por regla de conteo de ítems configurada en la institución: prueba, grado, asignatura y tipo de cuadernillo, con el número exacto de ítems que exige y cuántas formulaciones lleva esa regla.",
    columns: [
      "Prueba",
      "Año",
      "Grado",
      "Asignatura",
      "Tipo de cuadernillo",
      "Conteo de ítems",
      "Formuladas",
    ],
    roles: ["ECU_MASTER", "SUPER_ADMIN"],
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
