// Inspector one-off para verificar la evaluación "referencia" recién seedeada.
// Vive en `prisma/` porque el linter del proyecto prohíbe `@prisma/client` en
// otras capas (regla "no-restricted-imports" del monorepo).
// NO forma parte del seed; es solo utilidad de diagnóstico. Se puede borrar.
import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const e = await p.evaluation.findFirst({
    where: { bookletNumber: 3, status: "PUBLISHED" },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: {
          questions: {
            orderBy: { number: "asc" },
            include: { options: true },
          },
        },
      },
      institution: { select: { name: true, logo: true } },
      teacher: { select: { name: true, email: true } },
    },
  });
  if (!e) {
    console.log("No se encontró la evaluación");
    process.exit(1);
  }
  console.log("Evaluación:", e.title);
  console.log("ID:", e.id);
  console.log("Institución:", e.institution.name, "· logo:", e.institution.logo);
  console.log("Docente:", e.teacher.name, `<${e.teacher.email}>`);
  console.log("Bloques:", e.sections.length);
  console.log("Total preguntas:", e.totalQuestions);
  for (const s of e.sections) {
    const nums = s.questions.map((q) => q.number);
    console.log(`  - ${s.title}: ${nums.length} preguntas (${nums[0]}..${nums[nums.length - 1]})`);
  }
  const q = e.sections[0]?.questions[0];
  if (q) {
    console.log("\nSample pregunta #" + q.number + ":");
    console.log("  text:", JSON.stringify(q.text));
    console.log("  options:");
    for (const o of q.options) console.log(`    ${o.key}. ${JSON.stringify(o.text)}`);
  }
  await p.$disconnect();
}

main().catch(console.error);
