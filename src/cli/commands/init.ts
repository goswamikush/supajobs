import * as p from '@clack/prompts';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

// SupaJobs infrastructure — updated when infra changes
const INFRA = {
  PROJECTS_TABLE: 'supajobs-projects',
  API_URL: 'https://1c34w32pgh.execute-api.us-east-1.amazonaws.com',
};

const CONFIG_DIR = '.supajobs';
const CONFIG_FILE = `${CONFIG_DIR}/config.json`;
const WORKER_DIR = 'supajobs';
const WORKER_FILE = `${WORKER_DIR}/worker.js`;

export async function init() {
  p.intro('SupaJobs init');

  if (existsSync(CONFIG_FILE)) {
    p.outro('Project already initialized. Delete .supajobs/config.json to reinitialize.');
    return;
  }

  const credentials = await p.group({
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

  const projectKey = `sj_${randomBytes(16).toString('hex')}`;
  const supabaseUrl = credentials.supabaseUrl.trim().replace(/\/$/, '');

  const spinner = p.spinner();

  spinner.start('Registering project');
  await dynamo.send(new PutCommand({
    TableName: INFRA.PROJECTS_TABLE,
    Item: {
      projectKey,
      supabaseUrl,
      supabaseServiceRoleKey: credentials.supabaseServiceRoleKey,
      createdAt: new Date().toISOString(),
    },
  }));
  spinner.stop('Project registered');

  spinner.start('Provisioning supajobs_jobs table');
  await provisionJobsTable(supabaseUrl, credentials.pat);
  spinner.stop('supajobs_jobs table ready');

  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ projectKey, supabaseUrl }, null, 2));
  ensureGitignore();

  if (!existsSync(WORKER_FILE)) {
    mkdirSync(WORKER_DIR, { recursive: true });
    writeFileSync(WORKER_FILE, WORKER_TEMPLATE);
    p.log.info('Scaffolded supajobs/worker.js');
  }

  p.outro(`Initialized! Your project key: ${projectKey}

  Trigger a job from your code:

    await fetch('${INFRA.API_URL}/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectKey: '${projectKey}', payload: {} }),
    });

  Then run: supajobs deploy
  `);
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
