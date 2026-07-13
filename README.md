# SupaJobs

**Background jobs for Supabase developers. No DevOps required.**

If you've ever needed to run a long task from your Supabase app — sending emails, processing files, calling slow APIs, running AI pipelines — and wondered where to put that code, SupaJobs is the answer.

One command to set up. One command to deploy. One HTTP call to trigger. Job status and logs written directly to your Supabase table.

---

## How it works

1. You write a worker in plain JavaScript
2. `supajobs deploy` builds and pushes it to AWS (no Docker knowledge needed)
3. You trigger it with a single `fetch()` call from anywhere
4. Status and logs appear in your Supabase `supajobs_jobs` table in real time

Under the hood: AWS Fargate runs your job in an isolated container, AWS Lambda handles the trigger — all on SupaJobs' own AWS account. You never touch AWS or need credentials of your own; each project's code runs in its own container, isolated from other users.

SupaJobs is currently invite-only while it's early — reach out to get an invite code.

---

## Requirements

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A SupaJobs invite code (see below) — no AWS account of your own needed

---

## Getting started

### 1. Install

```bash
npm install -g supajobs
```

### 2. Initialize your project

```bash
supajobs init
```

This will:
- Connect to your Supabase project
- Create a `supajobs_jobs` table to track job status and logs
- Scaffold a `supajobs/workers/` directory with an example worker

You'll need:
- Your **SupaJobs invite code** (from the waitlist)
- Your **Supabase project URL** (`https://xxxx.supabase.co`)
- Your **Supabase service role key** (Settings → API → service_role)
- A **Supabase Personal Access Token** (supabase.com/dashboard/account/tokens)

### 3. Write your worker

Workers live in `supajobs/workers/`. Each file is a separate job type.

```js
// supajobs/workers/send-email.js
export default {
  async run(payload) {
    console.log('Sending email to:', payload.to);
    // your logic here
    console.log('Done!');
  },
};
```

You can have as many workers as you need:

```
supajobs/
  workers/
    send-email.js
    process-image.js
    generate-report.js
```

### 4. Deploy

```bash
supajobs deploy
```

This zips your `supajobs/` directory, uploads it to AWS, and builds a Docker image via AWS CodeBuild. No Docker installation required on your machine.

### 5. Trigger a job

From your app, server, or anywhere:

```js
await fetch('https://your-api-url/run', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    projectKey: 'sj_your_project_key',
    workerName: 'send-email',
    payload: { to: 'user@example.com' },
  }),
});
```

The exact URL and project key are shown after `supajobs init` and `supajobs deploy`.

---

## Monitoring jobs

Every job gets a row in your Supabase `supajobs_jobs` table:

| Column | Description |
|---|---|
| `id` | Unique job ID returned by the trigger |
| `status` | `pending` → `running` → `completed` or `failed` |
| `payload` | The payload you passed when triggering |
| `logs` | All `console.log` output from your worker |
| `error` | Error message if the job failed |
| `created_at` | When the job was triggered |
| `started_at` | When the container started running |
| `finished_at` | When the job completed or failed |

You can query this table directly from your app using the Supabase client:

```js
const { data } = await supabase
  .from('supajobs_jobs')
  .select('*')
  .eq('id', jobId)
  .single();

console.log(data.status); // 'completed'
console.log(data.logs);   // all console.log output
```

---

## Installing dependencies in workers

If your worker needs npm packages, include a `package.json` in your `supajobs/` directory:

```json
{
  "dependencies": {
    "axios": "^1.0.0",
    "sharp": "^0.33.0"
  }
}
```

SupaJobs will automatically run `npm install` during the build.

---

## Known limitations

This is early — here's what doesn't work yet, so you know before you hit it:

- **No automatic retries.** If your worker throws, the job is marked `failed` with the error message, but SupaJobs won't retry it for you. Handle retries in your own worker code if you need them.
- **No scheduled/cron jobs.** Every job run is triggered by an explicit `/run` call — there's no built-in scheduler yet.
- **No concurrency or rate limits.** Nothing currently stops many `/run` calls from spinning up many concurrent Fargate tasks.
- **Stuck jobs aren't always auto-recovered.** If your worker code throws, or a job runs past the 1-hour timeout, that's caught and reported as `failed`. But if the container is killed outright before it gets the chance to report anything — out-of-memory, a host failure, or similar — there's no external watchdog yet, and the job can stay at `pending`/`running` with no automatic failure. This should be rare, but if a job looks stuck for more than a few minutes with no log update, assume it crashed silently.
- **Cold start:** Fargate containers take ~30–60 seconds to spin up. SupaJobs is built for background work, not real-time responses.
- **Timeout:** Jobs are automatically killed after 1 hour.
- **Logs:** Only `console.log` is captured. `console.error` goes to CloudWatch, which you don't have access to — not your Supabase table.
- **Security:** Your `projectKey` acts as an API key — keep it secret. Your Supabase credentials are stored with AWS's default at-rest encryption (not yet per-project envelope encryption).

---

## License

MIT
