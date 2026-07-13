import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDemoAdmin } from "./helpers";

/**
 * Spec E2E: navegación del docente a la evaluación demo.
 *
 * Verifica que el flujo de visualización funciona end-to-end después del
 * login: el docente entra a su panel, navega a la evaluación demo
 * (sembrada por global-setup) y la página muestra título, secciones y
 * los enlaces/acciones de impresión esperados.
 */

test.describe("vista de evaluación", () => {
  test("el docente entra a la evaluación demo y ve sus preguntas + acciones de impresión", async ({
    page,
  }) => {
    await loginAsDemoAdmin(page);

    // Averigua el ID de la evaluación demo.
    const prisma = new PrismaClient();
    let evalId: string;
    try {
      const evalRow = await prisma.evaluation.findFirstOrThrow({
        where: { title: "E2E Demo — Prueba 1" },
        select: { id: true },
      });
      evalId = evalRow.id;
    } finally {
      await prisma.$disconnect();
    }

    await page.goto(`/teacher/evaluations/${evalId}`);

    // Título y badge de estado PUBLICADA (etiqueta en español: "Publicada").
    await expect(page.getByRole("heading", { name: "E2E Demo — Prueba 1" })).toBeVisible();
    await expect(page.getByText("Publicada")).toBeVisible();

    // Preguntas sembradas.
    await expect(page.getByText("¿Cuánto es 2 + 2?")).toBeVisible();
    await expect(page.getByText("Capital de Colombia")).toBeVisible();

    // Acciones de impresión disponibles (links a /print/* y botón PDF).
    await expect(page.getByRole("link", { name: /Cartilla/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Hoja respuestas/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Clave/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Descargar PDF/ })).toBeVisible();
  });
});
