import type { Role } from "@/shared/application/authenticated-user";

/**
 * Una "Consulta" en el módulo es un listado parametrizable sobre datos
 * institucionales. La UI `/admin/consultas` muestra las disponibles y
 * `/admin/consultas/[id]` renderiza la seleccionada.
 *
 * Diseño: registry en código (no BD). Las consultas son pocas, son código de
 * producto (no data del tenant), y un motor genérico (BD) agrega validación
 * de `queryType`, sanitización de SQL, y versionado. Decisión pedagógica
 * para mantener el módulo legible y testeable de punta a punta.
 *
 * El `id` debe ser estable y en kebab-case — es el slug de la URL.
 */
export interface ConsultaConfig {
  /** Slug estable (path segment de la URL `/admin/consultas/[id]`). */
  id: string;
  /** Título visible en la card del registry. */
  title: string;
  /** Descripción corta (1-2 líneas) que el admin ve antes de entrar. */
  description: string;
  /** Columns que la UI de la consulta debe renderizar. Documenta el contrato
   *  UI ↔ dominio. La UI puede ignorar columnas y añadir otras (sortable,
   *  filtros extra). */
  columns: readonly string[];
  /** Roles que pueden abrir esta consulta. No es la barrera de seguridad — el
   *  use case tiene su propio `requireRole` — sino lo que decide qué cards ve
   *  cada quien en `/admin/consultas`. Un líder ECU no tiene por qué ver
   *  siquiera que existe el listado de formulaciones. */
  roles: readonly Role[];
}
