// Background worker: runs as the `worker` process group on Fly.
// M0 only proves the queue round-trip; SMS, email, wallet and analytics jobs
// are added by later milestones as new job names.
import "dotenv/config";
import { Sentry } from "./sentry";
import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";

export const QUEUE = "wepunch";

const url = process.env.REDIS_URL;
if (!url) {
  console.error("REDIS_URL is not set");
  process.exit(1);
}

// BullMQ requires maxRetriesPerRequest: null on worker connections.
const connection = new IORedis(url, { maxRetriesPerRequest: null });

const handlers: Record<string, (job: Job) => Promise<unknown>> = {
  ping: async (job) => ({ pong: job.data ?? null }),
};

const worker = new Worker(
  QUEUE,
  async (job) => {
    const handle = handlers[job.name];
    if (!handle) throw new Error(`no handler for job "${job.name}"`);
    return handle(job);
  },
  { connection, concurrency: 5 },
);

worker.on("failed", (job, err) => {
  console.error(`job ${job?.name}#${job?.id} failed:`, err.message);
  Sentry.captureException(err, {
    tags: { job: job?.name ?? "unknown" },
    extra: { jobId: job?.id, attempt: job?.attemptsMade },
  });
});
worker.on("ready", () => console.log(`worker listening on queue "${QUEUE}"`));

async function shutdown() {
  await worker.close();
  await connection.quit();
  await Sentry.flush(2000);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
