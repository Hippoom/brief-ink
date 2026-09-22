import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'src', 'cli.ts');

function run(environment: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: environment,
  });
}

function writeProvider(rootDirectory: string, id: string, theme: string): void {
  mkdirSync(rootDirectory, { recursive: true });
  writeFileSync(
    join(rootDirectory, 'provider.mjs'),
    `export default { id: ${JSON.stringify(id)}, themes: [{ id: ${JSON.stringify(theme)}, version: 1, adapters: [] }] };\n`,
    'utf8',
  );
}

function environment(configHome: string, providerRoot?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    XDG_CONFIG_HOME: configHome,
    ...(providerRoot ? { SLIDE_PRIVATE_THEME_ROOT: providerRoot } : { SLIDE_PRIVATE_THEME_ROOT: '' }),
  };
}

test('providers CLI manages root registrations and bindings without exposing roots', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'slide-cli-providers-config-'));
  const providerRoot = mkdtempSync(join(tmpdir(), 'slide-cli-providers-root-'));
  const providerRef = 'cli-provider-ref';
  const moduleProviderId = 'internal-provider-id';
  const themeId = 'cli-theme';
  const env = environment(configHome);
  try {
    writeProvider(providerRoot, moduleProviderId, themeId);

    const initial = run(env, 'providers', 'list');
    assert.equal(initial.status, 0, initial.stderr);
    assert.match(initial.stdout, /No providers registered\./);
    assert.equal(initial.stdout.includes(providerRoot), false);

    const added = run(env, 'providers', 'add', providerRef, '--root', providerRoot);
    assert.equal(added.status, 0, added.stderr);
    assert.equal(added.stdout, `Registered provider ${providerRef}.\n`);
    assert.equal(`${added.stdout}${added.stderr}`.includes(providerRoot), false);

    const bound = run(env, 'providers', 'bind', themeId, '--provider', providerRef);
    assert.equal(bound.status, 0, bound.stderr);
    assert.equal(bound.stdout, `Bound theme ${themeId} to provider ${providerRef}.\n`);

    const listed = run(env, 'providers', 'list');
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, new RegExp(`PROVIDER_REF\\tTHEMES\\n${providerRef}\\t${themeId}`));
    assert.match(listed.stdout, new RegExp(`THEME\\tPROVIDER_REF\\n${themeId}\\t${providerRef}`));
    assert.equal(`${listed.stdout}${listed.stderr}`.includes(providerRoot), false);
    assert.equal(`${listed.stdout}${listed.stderr}`.includes(moduleProviderId), false);

    const blockedRemoval = run(env, 'providers', 'remove', providerRef);
    assert.equal(blockedRemoval.status, 1);
    assert.match(blockedRemoval.stderr, /theme-provider-registry-provider-has-bindings/);
    assert.equal(`${blockedRemoval.stdout}${blockedRemoval.stderr}`.includes(providerRoot), false);

    const unbound = run(env, 'providers', 'unbind', themeId);
    assert.equal(unbound.status, 0, unbound.stderr);
    assert.equal(unbound.stdout, `Unbound theme ${themeId}.\n`);

    const removed = run(env, 'providers', 'remove', providerRef);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(removed.stdout, `Removed provider ${providerRef}.\n`);
  } finally {
    rmSync(configHome, { recursive: true, force: true });
    rmSync(providerRoot, { recursive: true, force: true });
  }
});

test('providers CLI imports a provider from the explicit legacy environment without exposing its root', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'slide-cli-providers-legacy-config-'));
  const providerRoot = mkdtempSync(join(tmpdir(), 'slide-cli-providers-legacy-root-'));
  const providerRef = 'legacy-cli-provider-ref';
  const moduleProviderId = 'legacy-internal-provider-id';
  const themeId = 'legacy-cli-theme';
  try {
    writeProvider(providerRoot, moduleProviderId, themeId);
    const result = run(environment(configHome, providerRoot), 'providers', 'add', providerRef, '--from-legacy-env');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `Registered provider ${providerRef}.\n`);
    assert.equal(`${result.stdout}${result.stderr}`.includes(providerRoot), false);
    assert.equal(`${result.stdout}${result.stderr}`.includes(moduleProviderId), false);
  } finally {
    rmSync(configHome, { recursive: true, force: true });
    rmSync(providerRoot, { recursive: true, force: true });
  }
});

test('providers commands dispatch before deck input requirements', () => {
  const configHome = mkdtempSync(join(tmpdir(), 'slide-cli-providers-dispatch-'));
  try {
    const result = run(environment(configHome), 'providers', 'list');
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /Usage:/);
  } finally {
    rmSync(configHome, { recursive: true, force: true });
  }
});
