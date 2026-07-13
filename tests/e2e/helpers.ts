import { expect, type Page } from "@playwright/test";

/**
 * Credenciales del usuario sembrado por `pnpm db:seed`. Las usa el fixture
 * `loginAsDemoAdmin` para entrar a la app en los tests E2E.
 *
 * Si el seed cambia de email/contraseña, actualiza aquí también.
 */
export const DEMO_ADMIN = {
  email: "admin@eval.local",
  password: "Admin1234!",
} as const;

/**
 * Inicia sesión con las credenciales del admin demo vía el formulario de
 * /login (server action). Espera a que la home cargue para confirmar que
 * la cookie de sesión quedó seteada.
 *
 * Requiere que la BD haya sido sembrada (`pnpm db:seed`).
 */
export async function loginAsDemoAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(DEMO_ADMIN.email);
  await page.getByLabel("Contraseña").fill(DEMO_ADMIN.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  // Después de autenticar, el server action redirige a "/". La home del
  // dashboard es /(dashboard)/teacher/evaluations (panel docente por defecto
  // del usuario con rol TEACHER).
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  await expect(page).not.toHaveURL(/\/login/);
}

/** Cierra la sesión del usuario actual (clic en "Cerrar sesión"). */
export async function logout(page: Page): Promise<void> {
  // El header tiene un botón "Cerrar sesión" en el menú del usuario.
  await page.getByRole("button", { name: /cerrar sesi/i }).click();
  await page.waitForURL(/\/login/);
}
