import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseDeck } from '../src/parser.js';
import { resolveRenderConfig } from '../src/render-config.js';
import { buildRenderPlan } from '../src/render-plan.js';
import { renderHtml } from '../src/html-renderer.js';
import { renderBriefInkHtmlV1 } from '../src/renderers/brief-ink-html-v1.js';
import { htmlThemeRegistry, prepareHtmlTheme } from '../src/html-theme-registry.js';
import { PRIVATE_THEME_ROOT_ENV } from '../src/theme-provider.js';

const root = resolve(import.meta.dirname, '..');
const fixture = (name: string) => join(root, 'examples', name);

function deckFromFixture(name: string) {
  const sourcePath = fixture(name);
  return parseDeck(readFileSync(sourcePath, 'utf8'), sourcePath).deck;
}

async function resolvedConfig(name: string) {
  const resolved = await resolveRenderConfig(fixture(name));
  assert.ok(resolved.config, JSON.stringify(resolved.issues));
  assert.equal(resolved.issues.filter((item) => item.severity === 'error').length, 0);
  return resolved.config;
}

test('registered HTML adapters preserve the Brief Ink renderer output', async () => {
  const deck = deckFromFixture('v1-valid-consulting-deck.md');
  const config = await resolvedConfig('v1-valid-consulting-deck.render.yaml');
  const result = buildRenderPlan(deck, config);
  const adapter = htmlThemeRegistry.resolveAdapter(config.theme.name, 'web');

  assert.equal(adapter?.id, config.theme.renderer);
  assert.equal(renderHtml(deck, result.plan, config), renderBriefInkHtmlV1(deck, result.plan, config));
});

test('configuration reuses its invocation-scoped provider selection during HTML preparation', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-invocation-provider-'));
  const configDirectory = mkdtempSync(join(tmpdir(), 'slide-invocation-config-'));
  const originalRoot = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    writeFileSync(join(privateRoot, 'provider.mjs'), `
      export default {
        id: 'invocation-provider',
        themes: [{ id: 'invocation-theme', version: 1, adapters: [{
          id: 'invocation-html-v1', target: 'web', templateIds: new Set(['cover']),
          render: () => '<html>invocation</html>',
        }] }],
        resolveConfiguration: ({ configPath }) => ({
          manifest: { name: 'invocation-theme', version: 1, defaultProfile: 'default', sourcePath: configPath,
            renderer: 'invocation-html-v1', tokensPath: 'opaque', supportedStructures: ['narrative'],
            templates: { cover: 'cover', divider: 'cover', structures: { narrative: 'cover' } } },
          profile: { name: 'default', sourcePath: configPath, densityMode: 'standard', footerPolicy: 'standard', assetPolicy: 'strict', qa: { failOnOverflow: true, failOnMissingAsset: true } },
        }),
      };
    `, 'utf8');
    writeFileSync(join(configDirectory, 'render.yaml'), 'theme: invocation-theme\n', 'utf8');
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRoot;
    const configResult = await resolveRenderConfig(join(configDirectory, 'render.yaml'));
    assert.ok(configResult.config, JSON.stringify(configResult.issues));
    delete process.env[PRIVATE_THEME_ROOT_ENV];
    const prepared = await prepareHtmlTheme(deckFromFixture('v1-valid-consulting-deck.md'), configResult.config);
    assert.equal(prepared.adapter?.id, 'invocation-html-v1');
    assert.equal(JSON.stringify(configResult.config).includes(privateRoot), false);
  } finally {
    if (originalRoot === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV]; else process.env[PRIVATE_THEME_ROOT_ENV] = originalRoot;
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(configDirectory, { recursive: true, force: true });
  }
});

test('Brief Ink adds one stable QA identity hook per planned slide', async () => {
  const deck = deckFromFixture('v1-valid-consulting-deck.md');
  const config = await resolvedConfig('v1-valid-consulting-deck.render.yaml');
  const result = buildRenderPlan(deck, config);
  const html = renderHtml(deck, result.plan, config);
  const hooks = [...html.matchAll(/data-qa-role="slide" data-slide-id="([^"]+)" data-slide-index="(\d+)" data-slide-number="(\d+)" data-template="([^"]+)"/g)];
  assert.equal(hooks.length, result.plan.slides.length);
  assert.deepEqual(hooks.map((hook) => hook[1]), result.plan.slides.map((slide) => slide.slideId));
  assert.deepEqual(hooks.map((hook) => hook[4]), result.plan.slides.map((slide) => slide.template));
});

test('renderer dispatch rejects an unimplemented renderer rather than selecting a fallback', async () => {
  const deck = deckFromFixture('v1-valid-consulting-deck.md');
  const config = await resolvedConfig('v1-valid-consulting-deck.render.yaml');
  const result = buildRenderPlan(deck, config);
  const unsupported = { ...config, theme: { ...config.theme, renderer: 'not-maintained-html-v1' } };
  const unsupportedPlan = { ...result.plan, theme: { ...result.plan.theme, renderer: 'not-maintained-html-v1' } };
  assert.throws(() => renderHtml(deck, unsupportedPlan, unsupported), /No HTML renderer is implemented for declared renderer not-maintained-html-v1/);
});

test('renderer dispatch rejects plan and configuration renderer disagreement', async () => {
  const deck = deckFromFixture('v1-valid-consulting-deck.md');
  const config = await resolvedConfig('v1-valid-consulting-deck.render.yaml');
  const result = buildRenderPlan(deck, config);
  const mismatched = { ...result.plan, theme: { ...result.plan.theme, renderer: 'different-renderer-v1' } };
  assert.throws(() => renderHtml(deck, mismatched, config), /Render Plan renderer different-renderer-v1 does not match resolved Theme renderer brief-ink-html-v1/);
});
