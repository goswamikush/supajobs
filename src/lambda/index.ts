import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { fetchWithRetry } from '../lib/fetch.js';
import { ENV, JobStatus } from '../lib/constants.js';

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ecs = new ECSClient({});

const RequestBody = z.object({
  projectKey: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const handler = async (event: APIGatewayProxyEventV2) => {
  const result = RequestBody.safeParse(JSON.parse(event.body ?? '{}'));

  if (!result.success) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: result.error.flatten() }),
    };
  }

  const { projectKey, payload } = result.data;
  const jobId = crypto.randomUUID();

  try {
    const { Item: project } = await dynamo.send(new GetCommand({
      TableName: process.env[ENV.PROJECTS_TABLE],
      Key: { projectKey },
    }));

    if (!project) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid project key' }),
      };
    }

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
          environment: [
            { name: ENV.JOB_ID, value: jobId },
            { name: ENV.PAYLOAD, value: JSON.stringify(payload ?? {}) },
            { name: ENV.SUPABASE_URL, value: supabaseUrl },
            { name: ENV.SUPABASE_SERVICE_ROLE_KEY, value: supabaseServiceRoleKey },
          ],
        }],
      },
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ jobId }),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[INTERNAL ERROR] ${error}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
