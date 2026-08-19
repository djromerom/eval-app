/**
 * Capabilities (Sprint 8C).
 *
 * El menú lateral del dashboard y cualquier otra UI que necesite "qué puede
 * hacer este usuario" debe consultar `can(capability, roles)` en lugar de
 * chequear roles específicos (`hasRole("ADMIN")`, etc.). Esto desacopla la
 * UI del modelo de roles: si mañana cambia quién puede gestionar bundles,
 * se toca esta función y el menú se actualiza solo.
 *
 * Source of truth: los use cases (`requireRole(...)`). Si un use case
 * concede acceso a un rol, la capability correspondiente debe incluirlo.
 *
 * Roles actuales (Sprint 8A): SUPER_ADMIN, ECU_MASTER, COORDINATOR, TEACHER.
 * `ECU_MASTER` reemplaza el antiguo `ADMIN`: es el admin institucional que
 * gestiona usuarios, estructura académica, tema institucional y cuadernillos.
 */
import { hasRole, type Role } from "./authenticated-user";

export type Capability =
  /** Crear / editar / archivar instituciones. Solo SUPER_ADMIN. */
  | "manage-institutions"
  /** CRUD de usuarios, docentes, estudiantes de la institución. ECU_MASTER. */
  | "manage-users"
  /** Estructura académica: años, cursos, grupos, asignaturas, periodos. ECU_MASTER. */
  | "manage-academic-structure"
  /** Tema institucional (logo, colores, tipografía). ECU_MASTER. */
  | "manage-institutional-theme"
  /** Cuadernillos multi-formulación (create/update/theme/items/READY). ECU_MASTER. */
  | "manage-bundles"
  /** Revisar y aprobar evaluations. COORDINATOR (también ECU_MASTER por
   *  visibilidad institucional, aunque no aprueba por defecto). */
  | "review-evaluations"
  /** Crear / editar evaluations propias. TEACHER y COORDINATOR. */
  | "create-evaluations";

/**
 * Devuelve `true` si el conjunto de roles del actor concede la capability.
 *
 * La función es pura y testeable sin infraestructura: pasar roles, obtener
 * booleano. Útil también para gating en componentes cliente si se hidrata
 * con `user.roles` desde el server component padre.
 */
export function can(capability: Capability, roles: Role[]): boolean {
  const actor = { userId: "", institutionId: "", roles };
  switch (capability) {
    case "manage-institutions":
      return hasRole(actor, "SUPER_ADMIN");
    case "manage-users":
    case "manage-academic-structure":
    case "manage-institutional-theme":
    case "manage-bundles":
      return hasRole(actor, "ECU_MASTER");
    case "review-evaluations":
      return hasRole(actor, "ECU_LIDER", "ECU_MASTER");
    case "create-evaluations":
      return hasRole(actor, "TEACHER", "ECU_LIDER");
  }
}
