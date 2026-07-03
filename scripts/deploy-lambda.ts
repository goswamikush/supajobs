#!/usr/bin/env tsx
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const outputs = JSON.parse(
  execSync('terraform -chdir=terraform output -json', { encoding: 'utf8' })
) as Record<string, { value: string }>;

const region = outputs.api_url.value.match(/execute-api\.([\w-]+)\.amazonaws/)?.[1] ?? 'us-east-1';
const functionName = outputs.lambda_function_name.value;
const zipPath = '/tmp/supajobs-lambda.zip';

const run = (cmd: string) => execSync(cmd, { stdio: 'inherit' });

console.log('Building TypeScript...');
run('pnpm exec tsc');

console.log('Packaging Lambda...');
run(`rm -f ${zipPath}`);
run(`cd dist && zip -r ${zipPath} lambda/ lib/ && cd ..`);
run(`zip -ur ${zipPath} node_modules/`);

console.log('Deploying Lambda...');
run(`aws lambda update-function-code --function-name ${functionName} --zip-file fileb://${zipPath} --region ${region}`);

console.log('Done.');
