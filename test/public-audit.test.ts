import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

test('public payload audit passes for the current source candidate', () => {
  const root = resolve(import.meta.dirname, '..');
  const result = spawnSync(process.execPath, ['scripts/audit-public-payload.mjs', root], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  assert.match(result.stdout, /"result": "pass"/);
});
