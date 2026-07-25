import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loginAsDemoAdmin } from "./helpers";

/**
 * Spec E2E: importación de preguntas con contextos compartidos.
 *
 * Verifica el fix del flujo "importar con IA o CSV que trae contextos
 * compartidos → el sistema crea automáticamente una sección nueva por cada
 * contexto detectado y reparte las preguntas, en vez de pedirle al docente
 * que elija una sección destino".
 *
 * Antes del fix:
 *  - La pantalla de revisión mostraba el dropdown "Elegir contexto destino".
 *  - El server action devolvía "Elige un contexto destino" si el formulario
 *    no traía sectionId, aunque hubiera contextos en el payload.
 *
 * Después del fix:
 *  - Cuando las preguntas traen `contextText`, el dropdown se reemplaza por
 *    el texto "se crearán secciones por cada contexto del documento".
 *  - El submit reparte las preguntas entre secciones nuevas (una por
 *    contexto único), con el contenido del contexto como `section.content`.
 *  - El banner de éxito muestra los `infos` no-fatales ("Se crearon N
 *    sección(es) nuevas...").
 *
 * Estrategia: CSV determinístico (sin IA/red). Tres preguntas:
 *   1. contexto "El agua es vital para la vida." (PREGUNTA_AGUA_1)
 *   2. mismo contexto (PREGUNTA_AGUA_2)
 *   3. contexto "Europa tiene muchos países." (PREGUNTA_EUROPA)
 * El sistema debe crear 2 secciones nuevas y asignar las preguntas.
 *
 * Setup: global-setup.ts crea una evaluación "E2E Demo — Borrador para
 * import" en DRAFT, vacía. La limpiamos al final del test (secciones y
 * preguntas creadas) para que el siguiente run del test parta de cero sin
 * duplicar el contenido importado (la evaluación DRAFT se reutiliza).
 */

const EVAL_TITLE = "E2E Demo — Borrador para import";
const CSV_CONTENT =
  "enunciado,a,b,c,d,correcta,competencia,evidencia,contexto\n" +
  '"Pregunta AGUA 1","A","B","C","D",A,"Ciencia","Lee sobre el agua","El agua es vital para la vida."\n' +
  '"Pregunta AGUA 2","A","B","C","D",A,"Ciencia","Lee sobre el agua","El agua es vital para la vida."\n' +
  '"Pregunta EUROPA","A","B","C","D",B,"Geografía","Lee sobre Europa","Europa tiene muchos países."\n';

test.describe("import con contextos compartidos (auto-crear secciones)", () => {
  test("el sistema crea secciones por cada contexto detectado y reparte las preguntas", async ({
    page,
  }) => {
    // 1) Localiza la evaluación DRAFT sembrada y limpia sus secciones /
    //    preguntas si un run anterior dejó contenido (la evaluación en sí
    //    se reutiliza porque no podemos crear una nueva por correlación con
    //    el seed).
    const prisma = new PrismaClient();
    let evalId: string;
    try {
      const draft = await prisma.evaluation.findFirstOrThrow({
        where: { title: EVAL_TITLE },
        select: { id: true },
      });
      evalId = draft.id;
      // Limpieza idempotente: borra secciones previas (cascada a preguntas y
      // opciones). No assertamos sobre el conteo inicial porque cambia entre
      // runs.
      await prisma.evaluationSection.deleteMany({ where: { evaluationId: evalId } });
    } finally {
      await prisma.$disconnect();
    }

    // 2) Login + ir al wizard de import de la DRAFT.
    await loginAsDemoAdmin(page);
    await page.goto(`/teacher/evaluations/${evalId}/import`);

    // El wizard muestra la sección "Subir CSV".
    await expect(page.getByRole("heading", { name: "Subir CSV" })).toBeVisible();

    // 3) Subir el CSV como archivo. Playwright necesita un File real en disco
    //    para `input[type=file]`, así que lo escribimos a un tmp.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-csv-"));
    const csvPath = path.join(tmpDir, "preguntas-con-contexto.csv");
    await fs.writeFile(csvPath, CSV_CONTENT, "utf8");
    await page.locator('input[type="file"][accept*=".csv"]').setInputFiles(csvPath);

    // 4) El botón "Procesar X" está disabled hasta que el `onChange` del
    //    input async-set `csvContent`. Esperamos a que se habilite (cambio
    //    de texto: "Procesar CSV" → "Procesar <nombre-de-archivo>.csv").
    //    La regex es case-insensitive porque el filename acaba en .csv lowercase.
    const processBtn = page.getByRole("button", { name: /Procesar.*\.csv/i });
    await expect(processBtn).toBeEnabled({ timeout: 10_000 });
    await processBtn.click();

    // 5) Verificar que la pantalla de revisión muestra el mensaje del fix:
    //    "se crearán secciones por cada contexto del documento" en vez del
    //    dropdown de "Contexto".
    await expect(
      page.getByText(/se crearán secciones por cada contexto del documento/i),
    ).toBeVisible();
    // El dropdown ya NO debe estar presente.
    const conTextDropdown = page.locator("label", { hasText: /^Contexto$/ });
    await expect(conTextDropdown).toHaveCount(0);

    // 6) Confirmar la importación. Las 3 preguntas del CSV vienen marcadas
    //    por defecto. Texto literal del botón: "Importar 3 pregunta(s)".
    await page.getByRole("button", { name: /Importar 3 pregunta/ }).click();

    // 7) Verificar el banner de éxito.
    await expect(page.getByRole("heading", { name: "Importación completada" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Se importaron\s*3\s*pregunta/i)).toBeVisible();

    // 8) Verificar el `info` del auto-crear secciones.
    await expect(page.getByText(/Se crearon 2 sección\(es\) nuevas/i)).toBeVisible();
    // 9) Verificar que el formulario devolvió datos al backend: la DRAFT
    //    debe tener 2 secciones y 3 preguntas tras el commit.
    const prisma2 = new PrismaClient();
    try {
      const sectionCount = await prisma2.evaluationSection.count({
        where: { evaluationId: evalId },
      });
      const questionCount = await prisma2.question.count({
        where: { section: { evaluationId: evalId } },
      });
      const sections = await prisma2.evaluationSection.findMany({
        where: { evaluationId: evalId },
        orderBy: { order: "asc" },
        select: { id: true, title: true, order: true },
      });
      expect(sectionCount).toBe(2);
      expect(questionCount).toBe(3);

      // Distribución: las 2 preguntas con contexto "El agua" cayeron a UNA
      // sección, y la pregunta "Europa" a la OTRA sección. (El orden de
      // inserción respeta el orden del CSV, así que la primera sección
      // creada es la del agua.)
      const sectionIds = sections.map((s) => s.id);
      const waterSectionQuestions = await prisma2.question.count({
        where: { sectionId: sectionIds[0] },
      });
      const europaSectionQuestions = await prisma2.question.count({
        where: { sectionId: sectionIds[1] },
      });
      expect(waterSectionQuestions).toBe(2);
      expect(europaSectionQuestions).toBe(1);
    } finally {
      await prisma2.$disconnect();
    }

    // 10) Limpieza: borrar las secciones creadas para que el siguiente run
    //     del test parta de cero (la DRAFT persiste entre runs).
    const prisma3 = new PrismaClient();
    try {
      await prisma3.evaluationSection.deleteMany({ where: { evaluationId: evalId } });
    } finally {
      await prisma3.$disconnect();
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("CSV SIN contextos: muestra dropdown y exige sección destino", async ({ page }) => {
    // Caso de regresión: si el CSV NO trae contextos, el comportamiento
    // legacy tiene que seguir funcionando (dropdown visible, form requiere
    // elegir sección).
    const prisma = new PrismaClient();
    let evalId: string;
    try {
      const draft = await prisma.evaluation.findFirstOrThrow({
        where: { title: EVAL_TITLE },
        select: { id: true },
      });
      evalId = draft.id;
      // Limpieza + sección "Ancla" para que el dropdown tenga a qué apuntar.
      await prisma.evaluationSection.deleteMany({ where: { evaluationId: evalId } });
      await prisma.evaluationSection.create({
        data: {
          evaluationId: evalId,
          order: 0,
          title: "Ancla",
          content: { type: "doc", content: [] },
        },
      });
    } finally {
      await prisma.$disconnect();
    }

    const NO_CONTEXT_CSV =
      "enunciado,a,b,c,d,correcta,competencia,evidencia,contexto\n" +
      '"Pregunta sin contexto 1","A","B","C","D",A,"Genérica","Genérica",""\n' +
      '"Pregunta sin contexto 2","A","B","C","D",B,"Genérica","Genérica",""\n';

    await loginAsDemoAdmin(page);
    await page.goto(`/teacher/evaluations/${evalId}/import`);

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "e2e-csv-"));
    const csvPath = path.join(tmpDir, "sin-contexto.csv");
    await fs.writeFile(csvPath, NO_CONTEXT_CSV, "utf8");
    await page.locator('input[type="file"][accept*=".csv"]').setInputFiles(csvPath);
    // Esperar a que el botón se habilite (csvContent se setea async).
    const processBtn = page.getByRole("button", { name: /Procesar.*\.csv/i });
    await expect(processBtn).toBeEnabled({ timeout: 10_000 });
    await processBtn.click();

    // Como NO hay contextos, el mensaje del fix NO debe aparecer y el
    // dropdown SÍ debe estar visible.
    await expect(
      page.getByText(/se crearán secciones por cada contexto del documento/i),
    ).toHaveCount(0);
    await expect(page.locator("label", { hasText: /^Contexto$/ })).toBeVisible();

    await page.getByRole("button", { name: /Importar 2 pregunta/ }).click();
    await expect(page.getByRole("heading", { name: "Importación completada" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Se importaron\s*2\s*pregunta/i)).toBeVisible();

    // Limpieza.
    const prisma2 = new PrismaClient();
    try {
      await prisma2.evaluationSection.deleteMany({ where: { evaluationId: evalId } });
    } finally {
      await prisma2.$disconnect();
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
