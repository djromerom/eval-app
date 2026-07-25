import "./load-env";
import { Worker } from "bullmq";
import {
  QUEUE_NAMES,
  getBullMQPrefix,
  getRedisConnection,
  type OmrScanJob,
} from "@/shared/infrastructure/queue/queues";
import { logger } from "@/shared/infrastructure/logger";
import { makeProcessAnswerSheet } from "@/modules/scanning/infrastructure/container";

const log = logger.child({ worker: "omr" });

const processSheet = makeProcessAnswerSheet();

const worker = new Worker<OmrScanJob>(
  QUEUE_NAMES.omrScan,
  async (job) => {
    const { answerSheetId, scanBatchId, imagePath } = job.data;
    log.info({ jobId: job.id, answerSheetId, scanBatchId, imagePath }, "Processing answer sheet");

    const result = await processSheet.execute({
      answerSheetId,
      scanBatchId,
      institutionId: job.data.institutionId,
      imagePath,
    });

    if (!result.ok) {
      log.error({ jobId: job.id, error: result.error }, "Failed to process answer sheet");
      return { answerSheetId, status: "REVIEW" as const, error: result.error.code };
    }

    log.info(
      { jobId: job.id, answerSheetId, status: result.status, score: result.score },
      "Answer sheet processed",
    );
    return { answerSheetId: result.answerSheetId, status: result.status };
  },
  { connection: getRedisConnection(), prefix: getBullMQPrefix(), concurrency: 2 },
);

worker.on("completed", (job) =>
  log.info({ jobId: job.id, result: job.returnvalue }, "Job completed"),
);
worker.on("failed", (job, err) => log.error({ jobId: job?.id, err: err.message }, "Job failed"));

log.info("Worker OMR started, waiting for jobs…");

async function shutdown() {
  log.info("Shutting down OMR worker…");
  await worker.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
