import * as p from '@clack/prompts';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { fetchWithRetry, HttpError } from '../../lib/fetch.js';

// SupaJobs infrastructure — updated when infra changes
const INFRA = {
  API_URL: 'https://1c34w32pgh.execute-api.us-east-1.amazonaws.com',
};

const CONFIG_DIR = '.supajobs';
const CONFIG_FILE = `${CONFIG_DIR}/config.json`;
const WORKER_DIR = 'supajobs/workers';

const LOGO = `\x1b[32m
  ██████╗ ██╗   ██╗██████╗  █████╗      ██╗ ██████╗ ██████╗ ███████╗
  ██╔════╝██║   ██║██╔══██╗██╔══██╗     ██║██╔═══██╗██╔══██╗██╔════╝
  ███████╗██║   ██║██████╔╝███████║     ██║██║   ██║██████╔╝███████╗
  ╚════██║██║   ██║██╔═══╝ ██╔══██║██   ██║██║   ██║██╔══██╗╚════██║
  ███████║╚██████╔╝██║     ██║  ██║╚█████╔╝╚██████╔╝██████╔╝███████║
  ╚══════╝ ╚═════╝ ╚═╝     ╚═╝  ╚═╝ ╚════╝  ╚═════╝ ╚═════╝╚══════╝
\x1b[0m`;

export async function init() {
  console.log(LOGO);
  console.log('\x1b[2m  Background jobs for Supabase developers. No DevOps required.\x1b[0m\n');
  p.intro('Welcome to SupaJobs — enter the information below to get started');

  if (existsSync(CONFIG_FILE)) {
    p.outro('Project already initialized. Delete .supajobs/config.json to reinitialize.');
    return;
  }

  const credentials = await p.group({
    inviteCode: () => p.text({
      message: 'Invite code (from the SupaJobs waitlist)',
      validate: (val) => {
        if (!val) return 'Required';
      },
    }),
    supabaseUrl: () => p.text({
      message: 'Supabase project URL',
      placeholder: 'https://xxxx.supabase.co',
      validate: (val) => {
        if (!val) return 'Required';
        if (!val.startsWith('https://')) return 'Must be a valid URL';
      },
    }),
    supabaseServiceRoleKey: () => p.password({
      message: 'Supabase service role key',
      validate: (val) => {
        if (!val) return 'Required';
      },
    }),
    pat: () => p.password({
      message: 'Supabase Personal Access Token (get one at supabase.com/dashboard/account/tokens)',
      validate: (val) => {
        if (!val) return 'Required';
      },
    }),
  }, {
    onCancel: () => {
      p.cancel('Cancelled.');
      process.exit(0);
    },
  });

  const supabaseUrl = credentials.supabaseUrl.trim().replace(/\/$/, '');

  const spinner = p.spinner();

  try {
    const shapeError = checkServiceRoleKeyShape(credentials.supabaseServiceRoleKey);
    if (shapeError) throw new Error(shapeError);

    spinner.start('Verifying Supabase credentials');
    try {
      await fetchWithRetry(`${supabaseUrl}/rest/v1/`, {
        headers: {
          apikey: credentials.supabaseServiceRoleKey,
          Authorization: `Bearer ${credentials.supabaseServiceRoleKey}`,
        },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        throw new Error(`Supabase rejected the service role key (HTTP ${err.status}) — copy it again from Settings → API → service_role.`);
      }
      throw new Error(`Could not reach ${supabaseUrl} — double check your Supabase project URL.`);
    }
    spinner.stop('Supabase credentials verified');

    spinner.start('Registering project');
    const res = await fetchWithRetry(`${INFRA.API_URL}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inviteCode: credentials.inviteCode,
        supabaseUrl,
        supabaseServiceRoleKey: credentials.supabaseServiceRoleKey,
      }),
    });
    const { projectKey } = await res.json() as { projectKey: string };
    spinner.stop('Project registered');

    spinner.start('Provisioning supajobs_jobs table');
    await provisionJobsTable(supabaseUrl, credentials.pat);
    spinner.stop('supajobs_jobs table ready');

    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify({ projectKey, supabaseUrl }, null, 2));
    ensureGitignore();

    if (!existsSync(WORKER_DIR)) {
      mkdirSync(WORKER_DIR, { recursive: true });
      writeFileSync(`${WORKER_DIR}/my-job.js`, WORKER_TEMPLATE);
      p.log.info('Scaffolded supajobs/workers/my-job.js');
    }

    p.outro(`Initialized! Your project key: ${projectKey}

  Trigger a job from your code:

    await fetch('${INFRA.API_URL}/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectKey: '${projectKey}', workerName: 'my-job', payload: {} }),
    });

  Then run: supajobs deploy
  `);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.stop(message);
    p.cancel(`Init failed: ${message}`);
    process.exit(1);
  }
}

function checkServiceRoleKeyShape(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null; // not a JWT-shaped key (e.g. newer sb_secret_ format) — skip

  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (payload.role && payload.role !== 'service_role') {
      return `That looks like a "${payload.role}" key, not the service_role key. Copy it from Settings → API → service_role.`;
    }
  } catch {
    return null;
  }
  return null;
}

const WORKER_TEMPLATE = `export default {
  async run(payload) {
    // Your job logic here
    console.log('Job started with payload:', payload);
  },
};
`;

function ensureGitignore() {
  const entry = '.supajobs/';
  const file = '.gitignore';
  if (existsSync(file)) {
    const content = readFileSync(file, 'utf8');
    if (!content.includes(entry)) {
      writeFileSync(file, content.trimEnd() + `\n\n# SupaJobs\n${entry}\n`);
    }
  } else {
    writeFileSync(file, `# SupaJobs\n${entry}\n`);
  }
}

async function provisionJobsTable(supabaseUrl: string, pat: string) {
  const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

  const sql = `
    CREATE TABLE IF NOT EXISTS supajobs_jobs (
      id UUID PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      payload JSONB NOT NULL DEFAULT '{}',
      logs TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    );
  `;

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!res.ok) {
    throw new Error(`Failed to provision table: ${res.status} ${await res.text()}`);
  }
}
