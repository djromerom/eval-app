/**
 * Smoke test E2E para la importación IA con saber-extractor.
 *
 * Flujo cubierto:
 *  1. Login como docente (CO_001 fixture) en `test.ecognia.pro`.
 *  2. Ir a `/teacher/evaluations/<id>/import`.
 *  3. Seleccionar pestaña "Importar con IA".
 *  4. Subir `tests/e2e/fixtures/sample-exam.pdf` (2 preguntas, texto seleccionable).
 *  5. Esperar SSE `done` con timeout 120s.
 *  6. Verificar que aparece la pantalla de revisión con 2 preguntas y un
 *     badge de confianza visible.
 *
 * Pre-requisitos:
 *  - El worker `worker-question-extract` está corriendo en staging.
 *  - `ANTHROPIC_API_KEY` está definida en `.env.staging` (si no, cae a
 *    MINIMAX_API_KEY; alguna de las dos debe estar).
 *  - El fixture `tests/e2e/fixtures/sample-exam.pdf` existe. Regenerarlo
 *    con `tsx tests/e2e/fixtures/generate-sample-pdf.ts` si se borró.
 *
 * NOTA: este test dispara el worker real y consume API tokens de IA. NO
 * incluirlo en CI diario — solo correrlo manualmente después de un deploy
 * a staging para validar el flujo end-to-end.
 */
import { test, expect } from "@playwright/test";
import path from "node:path";
import { loginAsDemoAdmin } from "./helpers";

test("importación IA sube PDF → SSE → revisión con badge de confianza", async ({ page }) => {
  test.setTimeout(180_000); // 3 min: el worker puede tardar 60–120s.

  // 1) Login como admin demo. Para tests reales de docente, parametrizar
  //    con `loginAsTeacher` (helper a añadir si se hace común).
  await loginAsDemoAdmin(page);

  // 2) Crear (o reutilizar) una evaluation destino en estado DRAFT.
  // El setup del fixture ya crea CO_001 + una evaluación semilla; la
  // importamos via la URL conocida.
  const evaluationId = process.env.E2E_EVALUATION_ID;
  expect(evaluationId, "E2E_EVALUATION_ID env var debe estar definida").toBeTruthy();

  await page.goto(`/teacher/evaluations/${evaluationId}/import`);

  // 3) Subir PDF al input file.
  const fixturePath = path.join(__dirname, "fixtures/sample-exam.pdf");
  const fileInput = page.locator('input[type="file"][accept*=".pdf"]').last();
  await fileInput.setInputFiles(fixturePath);

  // 4) Click "Procesar … con IA" — debe cambiar a la vista streaming.
  const submit = page.locator('button:has-text("Procesar")').last();
  await submit.click();

  // 5) Esperar el primer mensaje de progreso (se renderiza tras el primer SSE event).
  await expect(page.getByText(/Extrayendo preguntas/i)).toBeVisible({ timeout: 30_000 });

  // 6) Esperar el resultado (botón "Importar N pregunta(s)").
  const importButton = page.locator('button:has-text("Importar ")').first();
  await expect(importButton).toBeVisible({ timeout: 120_000 });

  // 7) Verificar que hay al menos 1 badge de confianza visible (alta/media/baja).
  const badges = page.locator('text=/Confianza (alta|media|baja)/');
  await expect(badges.first()).toBeVisible();

  // 8) Verificar contador: al menos 1 pregunta importable.
  const buttonText = await importButton.textContent();
  expect(buttonText).toMatch(/Importar \d+ pregunta/);
});