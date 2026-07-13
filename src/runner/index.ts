import { fetchWithRetry } from '../lib/fetch.js';
import { ENV, JobStatus } from '../lib/constants.js';

const payload = process.env[ENV.PAYLOAD] ? JSON.parse(process.env[ENV.PAYLOAD]!) : {};
const jobId = process.env[ENV.JOB_ID];
const workerName = process.env[ENV.WORKER_NAME];
const supabaseUrl = process.env[ENV.SUPABASE_URL];
const supabaseKey = process.env[ENV.SUPABASE_SERVICE_ROLE_KEY];

const logs: string[] = [];

// Write to both stdout and logs array
const originalLog = console.log;
console.log = (...args) => {
  const line = args.join(' ');
  logs.push(line);
  originalLog(line);
};

async function updateJob(fields: Record<string, unknown>) {
  const missing: string[] = [];
  if (!jobId) missing.push(ENV.JOB_ID);
  if (!supabaseUrl) missing.push(ENV.SUPABASE_URL);
  if (!supabaseKey) missing.push(ENV.SUPABASE_SERVICE_ROLE_KEY);
  if (missing.length > 0) {
    console.error(`[INTERNAL ERROR] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  try {
    await fetchWithRetry(`${supabaseUrl}/rest/v1/supajobs_jobs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseKey!}`,
        apikey: supabaseKey!,
      },
      body: JSON.stringify(fields),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`Failed to update job status after retries: ${error}`);
  }
}

if (!workerName) {
  console.error('[INTERNAL ERROR] Missing required env var: WORKER_NAME');
  process.exit(1);
}

const JOB_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
setTimeout(async () => {
  await updateJob({ status: JobStatus.Failed, finished_at: new Date().toISOString(), logs: logs.join('\n'), error: 'Job timed out after 1 hour' });
  process.exit(1);
}, JOB_TIMEOUT_MS).unref();

let worker: { default: { run(payload: unknown): Promise<void> } };
try {
  // @ts-ignore - workers are provided by the user at deploy time
  worker = await import(`../workers/${workerName}.js`);
  if (typeof worker?.default?.run !== 'function') {
    throw new Error(`Worker "${workerName}" has no default export with a run() function`);
  }
} catch (err) {
  const error = err instanceof Error ? err.message : String(err);
  await updateJob({
    status: JobStatus.Failed,
    finished_at: new Date().toISOString(),
    logs: logs.join('\n'),
    error: `Failed to load worker "${workerName}": ${error}`,
  });
  process.exit(1);
}

await updateJob({ status: JobStatus.Running, started_at: new Date().toISOString() });

try {
  await worker.default.run(payload);
  await updateJob({ status: JobStatus.Completed, finished_at: new Date().toISOString(), logs: logs.join('\n') });
} catch (err) {
  const error = err instanceof Error ? err.message : String(err);
  await updateJob({ status: JobStatus.Failed, finished_at: new Date().toISOString(), logs: logs.join('\n'), error });
  process.exit(1);
}
