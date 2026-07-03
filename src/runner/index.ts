const ENV = {
  PAYLOAD: 'PAYLOAD',
  JOB_ID: 'JOB_ID',
  SUPABASE_URL: 'SUPABASE_URL',
  SUPABASE_SERVICE_ROLE_KEY: 'SUPABASE_SERVICE_ROLE_KEY',
} as const;

enum JobStatus {
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

const payload = process.env[ENV.PAYLOAD] ? JSON.parse(process.env[ENV.PAYLOAD]!) : {};
const jobId = process.env[ENV.JOB_ID];
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

async function fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      const base = 2 ** i * 500;
      const jitter = Math.random() * 200;
      await new Promise(r => setTimeout(r, base + jitter));
    }
  }
  throw new Error('Failed after retries');
}

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

// @ts-ignore - worker.js is provided by the user at deploy time
const worker = await import('./worker.js');

await updateJob({ status: JobStatus.Running, started_at: new Date().toISOString() });

try {
  await worker.default.run(payload);
  await updateJob({ status: JobStatus.Completed, finished_at: new Date().toISOString(), logs: logs.join('\n') });
} catch (err) {
  const error = err instanceof Error ? err.message : String(err);
  await updateJob({ status: JobStatus.Failed, finished_at: new Date().toISOString(), logs: logs.join('\n'), error });
  process.exit(1);
}
