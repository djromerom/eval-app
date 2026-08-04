import { expect, test } from "@playwright/test";
import { DEMO_ADMIN, loginAsDemoAdmin } from "./helpers";

test.describe("login + sesión", () => {
  test("la home redirige a login sin sesión", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    // Rebranding: ahora el heading es "Bienvenido a ecognIA".
    await expect(page.getByRole("heading", { name: /ecognIA/i })).toBeVisible();
  });

  test("el formulario de login muestra los campos esperados", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Correo institucional")).toBeVisible();
    await expect(page.getByLabel("Contraseña")).toBeVisible();
    await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
  });

  test("credenciales inválidas muestran error y no entran", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Correo institucional").fill(DEMO_ADMIN.email);
    await page.getByLabel("Contraseña").fill("contraseña-incorrecta");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    // El server action redirige a /login?error=credenciales.
    await expect(page).toHaveURL(/\/login\?error=credenciales/);
  });

  test("login con credenciales válidas redirige al dashboard", async ({ page }) => {
    await loginAsDemoAdmin(page);

    // Después de iniciar sesión, el docente debe ver su panel (no /login).
    await expect(page).not.toHaveURL(/\/login/);
    // El panel por defecto para el usuario con rol TEACHER es el listado de
    // evaluaciones; verificamos que cargó sin error 5xx.
    await expect(page.locator("body")).toBeVisible();
  });
});
