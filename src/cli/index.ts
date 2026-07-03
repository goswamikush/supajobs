#!/usr/bin/env node
import { init } from './commands/init.js';
import { deploy } from './commands/deploy.js';

const commands: Record<string, () => Promise<void>> = {
  init,
  deploy,
};

const command = process.argv[2];

if (!command || !commands[command]) {
  console.log(`
\x1b[32m  SUPAJOBS\x1b[0m \x1b[2m— Background jobs for Supabase developers. No DevOps required.\x1b[0m

  \x1b[1mUsage:\x1b[0m supajobs <command>

  \x1b[1mCommands:\x1b[0m
    \x1b[32minit\x1b[0m      Connect your Supabase project and scaffold your first worker
    \x1b[32mdeploy\x1b[0m    Build and deploy your workers to AWS
`);
  process.exit(0);
}

await commands[command]();
