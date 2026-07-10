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

SupaJobs is currently invite-only while it's early — join the waitlist to get a code (link TBD).

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

## Notes

- **Cold start:** Fargate containers take ~30–60 seconds to spin up. SupaJobs is designed for background work, not real-time responses.
- **Timeout:** Jobs are automatically killed after 1 hour.
- **Logs:** Only `console.log` is captured. `console.error` goes to CloudWatch but not your Supabase table.
- **Security:** Your `projectKey` acts as an API key — keep it secret. Your Supabase credentials are encrypted at rest in AWS.

---

## License

MIT
