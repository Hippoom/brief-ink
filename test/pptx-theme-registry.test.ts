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

test('configured private provider validates Master/Layout Integration opaquely without public fallback', async () => {
  const { deck, config } = await editorialFixture();
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-pptx-provider-'));
  const original = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    writeFileSync(join(privateRoot, 'provider.mjs'), `
      const integration = {
        schema: 'slide-pptx-master-layout-integration/v1',
        master: 'private-master-sentinel',
        layout: 'private-layout-sentinel',
        font: 'private-font-sentinel',
        asset: 'private-asset-sentinel',
        source: 'private-source-sentinel',
      };
      const templateIds = new Set([
        'brief-ink-pptx-cover-v1',
        'brief-ink-pptx-narrative-v1',
        'brief-ink-pptx-comparison-2col-v1',
      ]);
      export default {
        id: 'private-pptx-provider', themes: [{ id: 'private-pptx-theme', version: 1, adapters: [{
          id: 'private-pptx-v1', target: 'pptx', templateIds,
          prepare: async () => {
            if (integration.schema !== 'slide-pptx-master-layout-integration/v1') {
              return { issues: [{ severity: 'error', stage: 'preflight', owner: 'theme', code: 'private-master-layout-integration-invalid', message: 'Private Master/Slide Layout Integration validation failed.' }] };
            }
            return { issues: [], runtimeState: { integration } };
          },
          render: async (context, runtimeState) => {
            if (runtimeState.integration !== integration) throw new Error('runtime state was not injected');
            const pptx = context.runtime.createPresentation();
            pptx.addSlide().addText('Injected runtime');
            return await pptx.write({ outputType: 'uint8array', compression: true });
          },
          verify: async (context, bytes) => {
            const inspection = await context.runtime.inspect(bytes);
            return inspection.zip.valid ? [] : [{ severity: 'error', stage: 'qa', owner: 'theme', code: 'runtime-not-injected', message: 'Private adapter runtime verification failed.' }];
          },
        }] }]
      };
    `, 'utf8');
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRoot;
    const privateConfig = {
      ...config,
      themeOptions: { privateIntegrationSentinel: 'private-options-sentinel' },
      theme: { ...config.theme, name: 'private-pptx-theme', pptx: { ...config.theme.pptx!, renderer: 'private-pptx-v1' } },
    };
    const prepared = await preparePptxTheme(deck, privateConfig);
    assert.equal(prepared.adapter?.id, 'private-pptx-v1');
    assert.deepEqual(prepared.issues, []);
    const plan = buildRenderPlan(deck, privateConfig, 'pptx', prepared).plan;
    assert.deepEqual(plan.slides.map((slide) => slide.template), [
      'brief-ink-pptx-cover-v1',
      'brief-ink-pptx-narrative-v1',
      'brief-ink-pptx-comparison-2col-v1',
    ]);
    const serialized = JSON.stringify(plan);
    for (const sentinel of ['slide-pptx-master-layout-integration/v1', 'private-master-sentinel', 'private-layout-sentinel', 'private-font-sentinel', 'private-asset-sentinel', 'private-source-sentinel', 'private-options-sentinel']) {
      assert.equal(serialized.includes(sentinel), false);
    }
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

test('invalid private Master/Layout Integration fails closed without disclosure or template fallback', async () => {
  const { deck, config } = await editorialFixture();
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-pptx-provider-'));
  const original = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    writeFileSync(join(privateRoot, 'provider.mjs'), `
      const integration = { schema: 'private-unsupported-integration-sentinel', layout: 'private-layout-sentinel' };
      export default {
        id: 'private-pptx-provider', themes: [{ id: 'private-pptx-theme', version: 1, adapters: [{
          id: 'private-pptx-v1', target: 'pptx',
          templateIds: new Set(['brief-ink-pptx-cover-v1', 'brief-ink-pptx-narrative-v1', 'brief-ink-pptx-comparison-2col-v1']),
          prepare: async () => {
            if (integration.schema === 'slide-pptx-master-layout-integration/v1' && typeof integration.layout === 'string' && integration.layout.length > 0) {
              return { issues: [], runtimeState: { integration } };
            }
            return {
              issues: [{ severity: 'error', stage: 'preflight', owner: 'theme', code: 'private-master-layout-integration-invalid', message: 'Private Master/Slide Layout Integration validation failed.', suggestion: 'Correct the selected provider integration.' }],
              runtimeState: { integration },
            };
          },
          render: async () => { throw new Error('invalid integration must block rendering'); },
        }] }]
      };
    `, 'utf8');
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRoot;
    const privateConfig = { ...config, theme: { ...config.theme, name: 'private-pptx-theme', pptx: { ...config.theme.pptx!, renderer: 'private-pptx-v1' } } };
    const prepared = await preparePptxTheme(deck, privateConfig);
    assert.equal(prepared.adapter?.id, 'private-pptx-v1');
    assert.deepEqual(prepared.issues.map((issue) => issue.code), ['private-master-layout-integration-invalid']);
    assert.equal(JSON.stringify(prepared.issues).includes('private-unsupported-integration-sentinel'), false);
    assert.equal(JSON.stringify(prepared.issues).includes('private-layout-sentinel'), false);
    const planning = buildRenderPlan(deck, privateConfig, 'pptx', prepared);
    assert.ok(planning.issues.some((issue) => issue.code === 'private-master-layout-integration-invalid'));
    assert.equal(planning.plan.theme.renderer, 'private-pptx-v1');
    assert.equal(planning.plan.slides.every((slide) => slide.renderable), true);
    assert.equal(JSON.stringify(planning.plan).includes('private-unsupported-integration-sentinel'), false);
    assert.equal(JSON.stringify(planning.plan).includes('private-layout-sentinel'), false);
    await assert.rejects(
      renderPreparedPptxTheme(prepared, { deck, plan: planning.plan, config: privateConfig }),
      /preparation has blocking issues/,
    );
  } finally {
    if (original === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV]; else process.env[PRIVATE_THEME_ROOT_ENV] = original;
    rmSync(privateRoot, { recursive: true, force: true });
  }
});
