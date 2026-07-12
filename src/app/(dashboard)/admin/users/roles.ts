import type { Role } from "@/shared/application/authenticated-user";

/**
 * Roles asignables desde la UI de administración, con su etiqueta en español.
 * Módulo plano (sin "use client"): lo consumen tanto la página servidor como
 * los formularios cliente. SUPER_ADMIN no es asignable (§2).
 */
export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "ADMIN", label: "Administrador" },
  { value: "COORDINATOR", label: "Coordinador" },
  { value: "TEACHER", label: "Profesor" },
];
