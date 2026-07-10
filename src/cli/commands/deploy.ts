import * as p from '@clack/prompts';
import { existsSync, readFileSync, copyFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import { fetchWithRetry } from '../../lib/fetch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// SupaJobs infrastructure — updated when infra changes
const INFRA = {
  API_URL: 'https://1c34w32pgh.execute-api.us-east-1.amazonaws.com',
};

const CONFIG_FILE = '.supajobs/config.json';
const WORKER_DIR = 'supajobs';  // zip the whole supajobs/ dir so workers/ is included
const ZIP_PATH = '/tmp/supajobs-worker.zip';

enum BuildStatus {
  Succeeded = 'SUCCEEDED',
  Failed = 'FAILED',
  Fault = 'FAULT',
  TimedOut = 'TIMED_OUT',
  Stopped = 'STOPPED',
}

export async function deploy() {
  p.intro('SupaJobs deploy');

  if (!existsSync(CONFIG_FILE)) {
    p.cancel('Project not initialized. Run supajobs init first.');
    process.exit(1);
  }

  if (!existsSync(`${WORKER_DIR}/workers`)) {
    p.cancel('No supajobs/workers/ directory found. Run supajobs init first.');
    process.exit(1);
  }

  const { projectKey } = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));

  const spinner = p.spinner();

  spinner.start('Zipping supajobs/');
  const dockerfileDest = `${WORKER_DIR}/Dockerfile`;
  copyFileSync(join(__dirname, '../../../Dockerfile'), dockerfileDest);
  try {
    execSync(`zip -r ${ZIP_PATH} .`, { cwd: WORKER_DIR });
  } finally {
    unlinkSync(dockerfileDest);
  }
  spinner.stop('Zipped supajobs/');

  spinner.start('Requesting upload URL');
  const uploadUrlRes = await fetchWithRetry(`${INFRA.API_URL}/deploy/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectKey }),
  });
  const { uploadUrl } = await uploadUrlRes.json() as { uploadUrl: string };
  spinner.stop('Got upload URL');

  spinner.start('Uploading build');
  await fetchWithRetry(uploadUrl, {
    method: 'PUT',
    body: readFileSync(ZIP_PATH),
  });
  spinner.stop('Uploaded build');

  spinner.start('Starting build');
  const startRes = await fetchWithRetry(`${INFRA.API_URL}/deploy/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectKey }),
  });
  const { buildId } = await startRes.json() as { buildId: string };
  spinner.stop(`Build started: ${buildId}`);

  spinner.start('Building image');

  while (true) {
    await new Promise(r => setTimeout(r, 5000));

    const statusRes = await fetchWithRetry(`${INFRA.API_URL}/deploy/status?buildId=${encodeURIComponent(buildId)}`, {
      method: 'GET',
    });
    const { status } = await statusRes.json() as { status: string };

    if (status === BuildStatus.Succeeded) {
      spinner.stop('Build succeeded');
      break;
    }

    if (status === BuildStatus.Failed || status === BuildStatus.Fault || status === BuildStatus.TimedOut || status === BuildStatus.Stopped) {
      spinner.stop(`Build ${status.toLowerCase()}`);
      p.cancel('Deploy failed. Check AWS CodeBuild console for logs.');
      process.exit(1);
    }
  }

  p.outro(`Deployed! Trigger a job from anywhere:

  await fetch('${INFRA.API_URL}/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectKey: '${projectKey}',
      workerName: 'my-job',
      payload: { your: 'data' },
    }),
  });

  Watch status in your Supabase supajobs_jobs table.`);
}
