import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { fetchWithRetry } from '../lib/fetch.js';
import { ENV, JobStatus } from '../lib/constants.js';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ecs = new ECSClient({});
const s3 = new S3Client({});
const codebuild = new CodeBuildClient({});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseBody(event: APIGatewayProxyEventV2): unknown {
  return JSON.parse(event.body ?? '{}');
}

const RunBody = z.object({
  projectKey: z.string(),
  workerName: z.string().regex(/^[a-z0-9-]+$/, 'workerName must be lowercase alphanumeric with hyphens'),
  payload: z.record(z.string(), z.unknown()).optional(),
});

async function handleRun(event: APIGatewayProxyEventV2) {
  const result = RunBody.safeParse(parseBody(event));
  if (!result.success) return json(400, { error: result.error.flatten() });

  const { projectKey, workerName, payload } = result.data;
  const jobId = crypto.randomUUID();

  const { Item: project } = await dynamo.send(new GetCommand({
    TableName: process.env[ENV.PROJECTS_TABLE],
    Key: { projectKey },
  }));

  if (!project) return json(401, { error: 'Invalid project key' });

  const { supabaseUrl, supabaseServiceRoleKey } = project;

  await fetchWithRetry(`${supabaseUrl}/rest/v1/supajobs_jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseServiceRoleKey}`,
      apikey: supabaseServiceRoleKey,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      id: jobId,
      status: JobStatus.Pending,
      payload: payload ?? {},
    }),
  });

  const { failures } = await ecs.send(new RunTaskCommand({
    cluster: process.env[ENV.ECS_CLUSTER],
    taskDefinition: process.env[ENV.ECS_TASK_DEFINITION],
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: process.env[ENV.ECS_SUBNETS]!.split(','),
        securityGroups: [process.env[ENV.ECS_SECURITY_GROUP]!],
        assignPublicIp: 'ENABLED',
      },
    },
    overrides: {
      containerOverrides: [{
        name: 'worker',
        ...({ image: `${process.env[ENV.ECR_WORKER_REPO]}:${projectKey}` } as any),
        environment: [
          { name: ENV.JOB_ID, value: jobId },
          { name: ENV.WORKER_NAME, value: workerName },
          { name: ENV.PAYLOAD, value: JSON.stringify(payload ?? {}) },
          { name: ENV.SUPABASE_URL, value: supabaseUrl },
          { name: ENV.SUPABASE_SERVICE_ROLE_KEY, value: supabaseServiceRoleKey },
        ],
      }],
    },
  }));

  // RunTask can "succeed" at the SDK level while failing to actually schedule
  // the task (capacity, networking, etc.) — the container never starts, so it
  // can never self-report. Without this, the job would sit at "pending" forever.
  if (failures && failures.length > 0) {
    const reason = failures.map(f => f.reason).join('; ');
    await fetchWithRetry(`${supabaseUrl}/rest/v1/supajobs_jobs?id=eq.${jobId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        apikey: supabaseServiceRoleKey,
      },
      body: JSON.stringify({
        status: JobStatus.Failed,
        finished_at: new Date().toISOString(),
        error: `Failed to start job: ${reason}`,
      }),
    });
    return json(502, { error: `Failed to start job: ${reason}`, jobId });
  }

  return json(200, { jobId });
}

async function projectExists(projectKey: string): Promise<boolean> {
  const { Item } = await dynamo.send(new GetCommand({
    TableName: process.env[ENV.PROJECTS_TABLE],
    Key: { projectKey },
  }));
  return !!Item;
}

const ProjectKeyBody = z.object({
  projectKey: z.string(),
});

async function handleDeployUploadUrl(event: APIGatewayProxyEventV2) {
  const result = ProjectKeyBody.safeParse(parseBody(event));
  if (!result.success) return json(400, { error: result.error.flatten() });

  const { projectKey } = result.data;
  if (!(await projectExists(projectKey))) return json(401, { error: 'Invalid project key' });

  const s3Key = `builds/${projectKey}/worker.zip`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: process.env[ENV.BUILDS_BUCKET], Key: s3Key }),
    { expiresIn: 300 },
  );

  return json(200, { uploadUrl, s3Key });
}

async function handleDeployStart(event: APIGatewayProxyEventV2) {
  const result = ProjectKeyBody.safeParse(parseBody(event));
  if (!result.success) return json(400, { error: result.error.flatten() });

  const { projectKey } = result.data;
  if (!(await projectExists(projectKey))) return json(401, { error: 'Invalid project key' });

  const s3Key = `builds/${projectKey}/worker.zip`;
  const { build } = await codebuild.send(new StartBuildCommand({
    projectName: process.env[ENV.CODEBUILD_PROJECT],
    sourceTypeOverride: 'S3',
    sourceLocationOverride: `${process.env[ENV.BUILDS_BUCKET]}/${s3Key}`,
    environmentVariablesOverride: [{ name: 'PROJECT_KEY', value: projectKey }],
  }));

  return json(200, { buildId: build!.id });
}

async function handleDeployStatus(event: APIGatewayProxyEventV2) {
  const buildId = event.queryStringParameters?.buildId;
  const projectKey = event.queryStringParameters?.projectKey;
  if (!buildId) return json(400, { error: 'Missing buildId query parameter' });
  if (!projectKey) return json(400, { error: 'Missing projectKey query parameter' });

  const { builds } = await codebuild.send(new BatchGetBuildsCommand({ ids: [buildId] }));
  const build = builds?.[0];
  const status = build?.buildStatus;
  if (!status) return json(404, { error: 'Build not found' });

  const buildProjectKey = build?.environment?.environmentVariables?.find(v => v.name === 'PROJECT_KEY')?.value;
  if (buildProjectKey !== projectKey) return json(401, { error: 'Invalid project key for this build' });

  // Callers have no AWS console access, so surface the failing phase's own
  // message instead of pointing them at logs they can't see.
  let reason: string | undefined;
  if (status !== 'SUCCEEDED' && status !== 'IN_PROGRESS') {
    const failedPhase = build?.phases?.find(phase => phase.phaseStatus && phase.phaseStatus !== 'SUCCEEDED');
    reason = failedPhase?.contexts?.map(c => c.message).filter(Boolean).join('; ') || undefined;
  }

  return json(200, { status, reason });
}

const InitBody = z.object({
  inviteCode: z.string().min(1),
  supabaseUrl: z.string().min(1),
  supabaseServiceRoleKey: z.string().min(1),
});

function isValidInviteCode(code: string): boolean {
  const validCodes = (process.env[ENV.INVITE_CODES] ?? '').split(',').map(c => c.trim()).filter(Boolean);
  return validCodes.includes(code);
}

async function handleInit(event: APIGatewayProxyEventV2) {
  const result = InitBody.safeParse(parseBody(event));
  if (!result.success) return json(400, { error: result.error.flatten() });

  const { inviteCode, supabaseUrl, supabaseServiceRoleKey } = result.data;
  if (!isValidInviteCode(inviteCode)) return json(401, { error: 'Invalid invite code' });

  const projectKey = `sj_${randomBytes(16).toString('hex')}`;

  await dynamo.send(new PutCommand({
    TableName: process.env[ENV.PROJECTS_TABLE],
    Item: {
      projectKey,
      supabaseUrl,
      supabaseServiceRoleKey,
      createdAt: new Date().toISOString(),
    },
  }));

  return json(200, { projectKey });
}

export const handler = async (event: APIGatewayProxyEventV2) => {
  const method = event.requestContext.http.method;
  const path = event.requestContext.http.path;

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  try {
    if (method === 'POST' && path === '/run') return await handleRun(event);
    if (method === 'POST' && path === '/init') return await handleInit(event);
    if (method === 'POST' && path === '/deploy/upload-url') return await handleDeployUploadUrl(event);
    if (method === 'POST' && path === '/deploy/start') return await handleDeployStart(event);
    if (method === 'GET' && path === '/deploy/status') return await handleDeployStatus(event);
    return json(404, { error: 'Not found' });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[INTERNAL ERROR] ${error}`);
    return json(500, { error: 'Internal server error' });
  }
};
