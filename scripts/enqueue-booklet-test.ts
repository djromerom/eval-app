/**
 * Script de un solo uso: encola un job de generación de booklet para una
 * evaluation, espera a que termine y muestra el path del PDF resultante.
 *
 * Uso:
 *   cd eval-app && pnpm tsx scripts/enqueue-booklet-test.ts <evaluationId>
 */
import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";

const EVAL_ID = process.argv[2] ?? "019f616c-40a1-7ea1-95da-fe5a88c582c0";

async function main() {
  const conn = new IORedis("redis://localhost:6400", { maxRetriesPerRequest: null });
  const queue = new Queue("pdf-generation", { connection: conn });
  const events = new QueueEvents("pdf-generation", { connection: conn });

  console.log(`Encolando booklet para ${EVAL_ID}…`);
  const job = await queue.add(
    "pdf",
    {
      evaluationId: EVAL_ID,
      institutionId: "019f5ba1-4947-71b3-82bf-00886cb04dfb",
      kind: "booklet",
    },
    { removeOnComplete: true, removeOnFail: 50 },
  );
  console.log(`Job ${job.id} encolado. Esperando completion…`);

  try {
    const result = await job.waitUntilFinished(events, 90_000);
    console.log("✅ Job completado:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("❌ Job falló o timeout:", err);
    process.exitCode = 1;
  } finally {
    await queue.close();
    await events.close();
    await conn.quit();
  }
}

main();
