#!/usr/bin/env tsx
import { init } from './commands/init.js';
import { deploy } from './commands/deploy.js';

const commands: Record<string, () => Promise<void>> = {
  init,
  deploy,
};

const command = process.argv[2];

if (!command || !commands[command]) {
  console.log(`
Usage:
  supajobs init     — connect Supabase and scaffold worker
  supajobs deploy   — build and deploy your worker to AWS
  `);
  process.exit(0);
}

await commands[command]();
