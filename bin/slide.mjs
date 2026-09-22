#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['tsx', 'src/cli.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
