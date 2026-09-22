import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'src', 'cli.ts');
const fixture = (name: string) => join(root, 'examples', name);

function runCli(args: string[], cwd = root) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function temporaryDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test('baseline CLI validates a neutral v1 deck through the existing public command', async () => {
  const result = runCli(['validate', fixture('v1-valid-consulting-deck.md')]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validation summary: 0 error\(s\), 1 warning\(s\), 0 note\(s\)\./);
});

test('baseline CLI writes a v2 content-preflight report outside the Skill root', async () => {
  const directory = temporaryDirectory('slide-compat-content-');
  try {
    const report = join(directory, 'content-preflight.json');
    const result = runCli([
      'content-preflight',
      fixture('v2-content-preflight-valid.deck.md'),
      '--out',
      report,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(report, 'utf8')).schema, 'slide-content-preflight/v1');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('baseline CLI resolves an explicit neutral Web render plan', async () => {
  const directory = temporaryDirectory('slide-compat-plan-');
  try {
    const plan = join(directory, 'render-plan.json');
    const result = runCli([
      'preflight',
      fixture('v1-valid-consulting-deck.md'),
      '--config',
      fixture('v1-valid-consulting-deck.render.yaml'),
      '--target',
      'web',
      '--out',
      plan,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(readFileSync(plan, 'utf8'));
    assert.equal(parsed.theme.name, 'brief-ink');
    assert.equal(parsed.theme.renderer, 'brief-ink-html-v1');
    assert.equal(parsed.slides.length, 8);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('baseline CLI renders HTML outside the Skill root with stable artifact names', async () => {
  const directory = temporaryDirectory('slide-compat-render-');
  try {
    const output = join(directory, 'index.html');
    const config = join(root, 'examples', 'v1-valid-consulting-deck.render.yaml');
    const result = runCli([
      'render',
      fixture('v1-valid-consulting-deck.md'),
      '--config',
      config,
      '--target',
      'web',
      '--out',
      output,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wrote HTML deck to/);
    assert.equal(existsSync(output), true);
    assert.equal(existsSync(join(directory, 'index.pdf')), true);
    assert.equal(existsSync(join(directory, 'index.qa.json')), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('baseline CLI refuses generated Web output below the Skill root', async () => {
  const output = join(root, 'build', 'compatibility-baseline.html');
  const result = runCli([
    'render',
    fixture('v1-valid-consulting-deck.md'),
    '--config',
    fixture('v1-valid-consulting-deck.render.yaml'),
    '--target',
    'web',
    '--out',
    output,
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsafe-render-output/);
});

test('baseline CLI preserves the explicit deferred PNG failure', async () => {
  const directory = temporaryDirectory('slide-compat-png-');
  try {
    const config = join(directory, 'png.render.yaml');
    writeFileSync(config, [
      'theme: brief-ink',
      'profile: compact',
      '',
      'output:',
      '  directory: build',
      '  html: true',
      '  pdf: false',
      '  png: true',
      '  pptx: false',
      '',
    ].join('\n'));
    const result = runCli([
      'render',
      fixture('v1-valid-consulting-deck.md'),
      '--config',
      config,
      '--target',
      'web',
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /png-export-not-implemented/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('baseline observes but never mutates the installed Skill link', async () => {
  const link = join(homedir(), '.claude', 'skills', 'slide');
  if (!existsSync(link)) return;
  const target = readlinkSync(link);
  assert.equal(target, root);
});
