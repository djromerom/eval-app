import { expect, test } from "@playwright/test";

/**
 * Placeholder E2E (Fase 1): verifica que la app arranca y que las rutas
 * protegidas redirigen a /login. Se ampliará con el login real (requiere
 * BD sembrada) cuando el flujo de sesión esté cableado end-to-end.
 */
test("la home redirige a login sin sesión", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Eval" })).toBeVisible();
});

test("el formulario de login muestra los campos esperados", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
});
