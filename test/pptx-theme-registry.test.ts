import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parseDeck } from '../src/parser.js';
import { resolveRenderConfig } from '../src/render-config.js';
import { buildRenderPlan } from '../src/render-plan.js';
import { preparePptxTheme, renderPreparedPptxTheme, verifyPreparedPptxTheme } from '../src/pptx-theme-registry.js';
import { pptxTargetRuntime } from '../src/targets/pptx/runtime.js';
import { PRIVATE_THEME_ROOT_ENV } from '../src/theme-provider.js';

const root = resolve(import.meta.dirname, '..');

async function editorialFixture() {
  const deckPath = join(root, 'examples', 'brief-ink-pptx-poc.deck.md');
  const configPath = join(root, 'examples', 'brief-ink-pptx-poc.render.yaml');
  const resolved = await resolveRenderConfig(configPath);
  assert.ok(resolved.config, JSON.stringify(resolved.issues));
  return { deck: parseDeck(readFileSync(deckPath, 'utf8'), deckPath).deck, config: resolved.config };
}

test('PPTX preparation exposes only public Editorial and async adapter dispatch verifies generic inspection', async () => {
  const { deck, config } = await editorialFixture();
  const prepared = await preparePptxTheme(deck, config);
  assert.equal(prepared.adapter?.id, 'brief-ink-pptx-v1');
  assert.deepEqual(prepared.issues, []);
  const plan = buildRenderPlan(deck, config, 'pptx', prepared).plan;
  const bytes = await renderPreparedPptxTheme(prepared, { deck, plan, config });
  const inspection = await pptxTargetRuntime.inspect(bytes);
  const issues = await verifyPreparedPptxTheme(prepared, { deck, plan, config, inspection }, bytes);
  assert.equal(inspection.issues.length, 0);
  assert.deepEqual(issues, []);
});

test('private PPTX Theme remains unavailable without an explicit provider root', async () => {
  const { deck, config } = await editorialFixture();
  const original = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    delete process.env[PRIVATE_THEME_ROOT_ENV];
    const privateConfig = { ...config, theme: { ...config.theme, name: 'private-pptx-theme', pptx: { ...config.theme.pptx!, renderer: 'private-pptx-v1' } } };
    const prepared = await preparePptxTheme(deck, privateConfig);
    assert.equal(prepared.adapter, undefined);
    assert.deepEqual(prepared.issues.map((issue) => issue.code), ['private-theme-root-unavailable']);
  } finally {
    if (original === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV]; else process.env[PRIVATE_THEME_ROOT_ENV] = original;
  }
});

test('configured private provider supplies an async PPTX adapter without public fallback', async () => {
  const { deck, config } = await editorialFixture();
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-pptx-provider-'));
  const original = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    writeFileSync(join(privateRoot, 'provider.mjs'), `
      export default {
        id: 'private-pptx-provider', themes: [{ id: 'private-pptx-theme', version: 1, adapters: [{
          id: 'private-pptx-v1', target: 'pptx', templateIds: new Set(['private-cover']),
          prepare: async () => ({
            issues: [],
            runtimeState: { secret: 'runtime-pptx-sentinel' },
            planState: { secret: 'plan-pptx-sentinel' },
          }),
          render: async (context, runtimeState) => {
            if (runtimeState.secret !== 'runtime-pptx-sentinel') throw new Error('runtime state was not injected');
            const pptx = context.runtime.createPresentation();
            pptx.addSlide().addText('Injected runtime');
            return await pptx.write({ outputType: 'uint8array', compression: true });
          },
          verify: async (context, bytes) => {
            const inspection = await context.runtime.inspect(bytes);
            return inspection.zip.valid ? [] : [{ severity: 'error', code: 'runtime-not-injected' }];
          },
        }] }]
      };
    `, 'utf8');
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRoot;
    const privateConfig = { ...config, theme: { ...config.theme, name: 'private-pptx-theme', pptx: { ...config.theme.pptx!, renderer: 'private-pptx-v1' } } };
    const prepared = await preparePptxTheme(deck, privateConfig);
    assert.equal(prepared.adapter?.id, 'private-pptx-v1');
    assert.deepEqual(prepared.runtimeState, { secret: 'runtime-pptx-sentinel' });
    const plan = buildRenderPlan(deck, privateConfig, 'pptx', prepared).plan;
    const serialized = JSON.stringify(plan);
    assert.equal(serialized.includes('runtime-pptx-sentinel'), false);
    assert.equal(serialized.includes('plan-pptx-sentinel'), false);
    assert.equal('providerState' in plan.theme, false);
    const bytes = await renderPreparedPptxTheme(prepared, { deck, plan, config: privateConfig });
    const inspection = await pptxTargetRuntime.inspect(bytes);
    const issues = await verifyPreparedPptxTheme(prepared, { deck, plan, config: privateConfig, inspection }, bytes);
    assert.ok(bytes.byteLength > 0);
    assert.equal(inspection.zip.valid, true);
    assert.deepEqual(issues, []);
  } finally {
    if (original === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV]; else process.env[PRIVATE_THEME_ROOT_ENV] = original;
    rmSync(privateRoot, { recursive: true, force: true });
  }
});
