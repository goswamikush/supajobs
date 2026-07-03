#!/usr/bin/env tsx
import { execSync } from 'child_process';

const outputs = JSON.parse(
  execSync('terraform -chdir=terraform output -json', { encoding: 'utf8' })
) as Record<string, { value: string }>;

const baseRepo = outputs.ecr_base_repository_url.value;
const region = baseRepo.match(/\.ecr\.([\w-]+)\.amazonaws/)?.[1] ?? 'us-east-1';
const accountId = baseRepo.split('.')[0];

const run = (cmd: string) => execSync(cmd, { stdio: 'inherit' });

console.log('Building TypeScript...');
run('pnpm exec tsc');

console.log('Logging into ECR...');
run(`aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${accountId}.dkr.ecr.${region}.amazonaws.com`);

console.log('Building base image...');
run(`docker build --platform linux/amd64 -f Dockerfile.base -t ${baseRepo}:latest .`);

console.log('Pushing base image...');
run(`docker push ${baseRepo}:latest`);

console.log('Done. Base image pushed to ECR.');
