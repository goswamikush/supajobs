#!/usr/bin/env tsx
import { execSync } from 'child_process';

const outputs = JSON.parse(
  execSync('terraform -chdir=terraform output -json', { encoding: 'utf8' })
) as Record<string, { value: string }>;

const region = outputs.api_url.value.match(/execute-api\.([\w-]+)\.amazonaws/)?.[1] ?? 'us-east-1';
const functionName = outputs.lambda_function_name.value;
const zipPath = '/tmp/supajobs-lambda.zip';
const buildDir = '/tmp/supajobs-lambda-build';

const run = (cmd: string) => execSync(cmd, { stdio: 'inherit' });

console.log('Building TypeScript...');
run('pnpm exec tsc');

console.log('Packaging Lambda...');
run(`rm -rf ${buildDir} && mkdir ${buildDir}`);
run(`cp -r dist/lambda dist/lib ${buildDir}/`);

// Write a stripped package.json without devEngines so npm doesn't complain
import { readFileSync, writeFileSync } from 'fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
delete pkg.devEngines;
delete pkg.devDependencies;
writeFileSync(`${buildDir}/package.json`, JSON.stringify(pkg, null, 2));
run(`cd ${buildDir} && npm install --omit=dev --ignore-scripts`);

run(`rm -f ${zipPath}`);
run(`cd ${buildDir} && zip -r ${zipPath} .`);

console.log('Deploying Lambda...');
run(`aws lambda update-function-code --function-name ${functionName} --zip-file fileb://${zipPath} --region ${region}`);

console.log('Done.');
