import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'src', 'cli.ts');
const fixture = (name: string) => join(root, 'examples', name);

function run(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('content-preflight succeeds with advisory v2 findings', async () => {
  const result = run('content-preflight', fixture('v2-content-preflight-quality-risks.deck.md'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /content-preflight-missing-slide-positioning/);
  assert.match(result.stdout, /Content Preflight summary: 0 error\(s\), 6 warning\(s\)\./);
});

test('content-preflight writes deterministic provenance without slide body content', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'slide-content-preflight-'));
  const reportPath = join(directory, 'report.json');
  try {
    const result = run('content-preflight', fixture('v2-content-preflight-valid.deck.md'), '--out', reportPath);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.schema, 'slide-content-preflight/v1');
    assert.equal(report.deck.sourcePath, fixture('v2-content-preflight-valid.deck.md'));
    assert.match(report.deck.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(report.deck.deckSchema, 'slide-deck/v2');
    assert.deepEqual(report.summary, { errors: 0, warnings: 0, notes: 0 });
    assert.deepEqual(report.issues, []);
    assert.equal(JSON.stringify(report).includes('Customers can receive overlapping offers'), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('content-preflight blocks invalid v2 metadata and still writes an error report', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'slide-content-preflight-invalid-'));
  const reportPath = join(directory, 'report.json');
  try {
    const result = run('content-preflight', fixture('v2-content-preflight-invalid.deck.md'), '--out', reportPath);
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.ok(report.summary.errors > 0);
    assert.ok(report.issues.some((issue: { code: string }) => issue.code === 'missing-v2-audience'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('content-preflight rejects report output inside the Skill source', async () => {
  const result = run('content-preflight', fixture('v2-content-preflight-valid.deck.md'), '--out', join(root, 'build', 'content-preflight.json'));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsafe-content-preflight-output/);
});

test('v1 content-preflight adds no v2 warning noise', async () => {
  const result = run('content-preflight', fixture('v1-valid-consulting-deck.md'));
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /content-preflight-/);
  assert.match(result.stdout, /Content Preflight summary: 0 error\(s\), 1 warning\(s\)\./);
});
