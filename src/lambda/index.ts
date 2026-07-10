import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { fetchWithRetry } from '../lib/fetch.js';
import { ENV, JobStatus } from '../lib/constants.js';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ecs = new ECSClient({});

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

  await ecs.send(new RunTaskCommand({
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

  return json(200, { jobId });
}

const InitBody = z.object({
  supabaseUrl: z.string().min(1),
  supabaseServiceRoleKey: z.string().min(1),
});

async function handleInit(event: APIGatewayProxyEventV2) {
  const result = InitBody.safeParse(parseBody(event));
  if (!result.success) return json(400, { error: result.error.flatten() });

  const { supabaseUrl, supabaseServiceRoleKey } = result.data;
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
    return json(404, { error: 'Not found' });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[INTERNAL ERROR] ${error}`);
    return json(500, { error: 'Internal server error' });
  }
};
