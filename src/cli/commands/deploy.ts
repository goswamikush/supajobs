import * as p from '@clack/prompts';
import { existsSync, readFileSync, createReadStream } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { ENV } from '../../lib/constants.js';
import { execSync } from 'child_process';

const s3 = new S3Client({});
const codebuild = new CodeBuildClient({});

const CONFIG_FILE = '.supajobs/config.json';
const WORKER_DIR = 'supajobs';
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

  if (!existsSync(WORKER_DIR)) {
    p.cancel('No supajobs/ directory found. Run supajobs init first.');
    process.exit(1);
  }

  const { projectKey } = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));

  const spinner = p.spinner();

  spinner.start('Zipping supajobs/');
  execSync(`zip -r ${ZIP_PATH} .`, { cwd: WORKER_DIR });
  spinner.stop('Zipped supajobs/');

  const s3Key = `builds/${projectKey}/worker.zip`;

  spinner.start('Uploading to S3');
  await s3.send(new PutObjectCommand({
    Bucket: process.env[ENV.BUILDS_BUCKET],
    Key: s3Key,
    Body: createReadStream(ZIP_PATH),
  }));
  spinner.stop('Uploaded to S3');

  spinner.start('Starting build');
  const { build } = await codebuild.send(new StartBuildCommand({
    projectName: process.env[ENV.CODEBUILD_PROJECT],
    sourceTypeOverride: 'S3',
    sourceLocationOverride: `${process.env[ENV.BUILDS_BUCKET]}/${s3Key}`,
    environmentVariablesOverride: [
      { name: ENV.PROJECT_KEY, value: projectKey },
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

  p.outro('Deployed successfully! Your worker is ready to run jobs.');
}
