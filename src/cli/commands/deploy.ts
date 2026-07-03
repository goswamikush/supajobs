import * as p from '@clack/prompts';
import { existsSync, readFileSync, createReadStream, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { execSync } from 'child_process';

const s3 = new S3Client({ region: 'us-east-1' });
const codebuild = new CodeBuildClient({ region: 'us-east-1' });

// SupaJobs infrastructure — updated when infra changes
const INFRA = {
  BUILDS_BUCKET: 'supajobs-builds-976075257993',
  CODEBUILD_PROJECT: 'supajobs-worker',
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
  const dockerfileSrc = join(__dirname, '../../../Dockerfile');
  copyFileSync(dockerfileSrc, `${WORKER_DIR}/Dockerfile`);
  execSync(`zip -r ${ZIP_PATH} .`, { cwd: WORKER_DIR });
  spinner.stop('Zipped supajobs/');

  const s3Key = `builds/${projectKey}/worker.zip`;

  spinner.start('Uploading to S3');
  await s3.send(new PutObjectCommand({
    Bucket: INFRA.BUILDS_BUCKET,
    Key: s3Key,
    Body: createReadStream(ZIP_PATH),
  }));
  spinner.stop('Uploaded to S3');

  spinner.start('Starting build');
  const { build } = await codebuild.send(new StartBuildCommand({
    projectName: INFRA.CODEBUILD_PROJECT,
    sourceTypeOverride: 'S3',
    sourceLocationOverride: `${INFRA.BUILDS_BUCKET}/${s3Key}`,
    environmentVariablesOverride: [
      { name: 'PROJECT_KEY', value: projectKey },
    ],
  }));
  spinner.stop(`Build started: ${build!.id}`);

  spinner.start('Building image');
  const buildId = build!.id!;

  while (true) {
    await new Promise(r => setTimeout(r, 5000));

    const { builds } = await codebuild.send(new BatchGetBuildsCommand({ ids: [buildId] }));
    const status = builds![0].buildStatus;

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
