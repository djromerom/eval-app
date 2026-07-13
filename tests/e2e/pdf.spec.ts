import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAsDemoAdmin } from "./helpers";
import { downloadBookletAndParse } from "./pdf-helpers";
import { signPrintToken } from "@/shared/infrastructure/crypto/print-token";

/**
 * Spec E2E: pipeline de generación de PDF (Fase 4 §3.4).
 *
 * Cubre el flujo server-side completo:
 *   - Botón "Descargar PDF ↓" → API → BullMQ → worker Puppeteer + pdf-lib.
 *   - El PDF resultante es un cuadernillo doble carta saddle-stitch: 2 caras
 *     por pliego, cada cara con 2 medias páginas carta apaisadas.
 *
 * Requiere:
 *   - Worker PDF corriendo (`pnpm worker:pdf`) para procesar el job.
 *   - Redis accesible.
 */

test.describe("PDF server-side (cuadernillo doble carta)", () => {
  let evalId: string;
  let institutionId: string;

  test.beforeAll(async () => {
    const prisma = new PrismaClient();
    try {
      const evalRow = await prisma.evaluation.findFirstOrThrow({
        where: { title: "E2E Demo — Prueba 1" },
        select: { id: true, institutionId: true },
      });
      evalId = evalRow.id;
      institutionId = evalRow.institutionId;
    } finally {
      await prisma.$disconnect();
    }
  });

  test("descarga PDF booklet: portada + preguntas → 1 pliego (2 caras) tabloid", async ({
    page,
  }) => {
    test.setTimeout(180_000); // el worker puede tardar hasta 90s.

    await loginAsDemoAdmin(page);
    await page.goto(`/teacher/evaluations/${evalId}`);

    const { filename, pages, file } = await downloadBookletAndParse(page, evalId);

    // Nombre del archivo: {evaluationId}-booklet.pdf
    expect(filename).toBe(`${evalId}-booklet.pdf`);

    // Header y trailer PDF válidos (assertPdfHeader ya corrió).
    expect(file.length).toBeGreaterThan(10_000); // ~150KB esperado, mínimo 10KB.

    // Dimensiones: cada cara del pliego debe ser tabloid apaisado.
    // 17 in × 11 in = 1224 × 792 pt.
    expect(pages).toHaveLength(2); // 1 pliego = 2 caras (FRONT + BACK)
    for (const p of pages) {
      expect(p.widthPt).toBeCloseTo(1224, -1); // ±5pt
      expect(p.heightPt).toBeCloseTo(792, -1);
    }
  });

  test("/print/evaluation sin sesión pero con token válido renderiza la portada", async ({
    request,
  }) => {
    // Generamos un token firmado exactamente con el mismo algoritmo que
    // usa el servidor (signPrintToken → canonicalJson + HMAC-SHA256) para
    // verificar que /print/evaluation/[id]?t=... carga sin redirigir a /login.
    const token = signPrintToken({
      evaluationId: evalId,
      institutionId,
      kind: "booklet",
    });

    const res = await request.get(`/print/evaluation/${evalId}?t=${token}`);
    expect(res.status()).toBe(200);
    const html = await res.text();

    // Sin token → redirige a /login. Con token → renderiza la portada.
    expect(html).toContain("CUADERNILLO 1");
    expect(html).toContain("¡Hola!");
    expect(html).toContain("Marca así");
  });

  test("/print/evaluation SIN token redirige a /login (no se filtra contenido)", async ({
    request,
  }) => {
    const res = await request.get(`/print/evaluation/${evalId}`, {
      maxRedirects: 0,
    });
    // Next.js middleware redirige con 307.
    expect([301, 302, 303, 307, 308]).toContain(res.status());
    const location = res.headers()["location"] ?? "";
    expect(location).toMatch(/\/login/);
  });
});
