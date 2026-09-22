import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { parseDeck } from '../src/parser.js';
import { resolveRenderConfig } from '../src/render-config.js';
import { buildRenderPlan } from '../src/render-plan.js';
import { inspectPptxPackage, resolvePptxArtifactPaths } from '../src/pptx-package.js';
import { preparePptxTheme, renderPreparedPptxTheme, verifyPreparedPptxTheme } from '../src/pptx-theme-registry.js';
import { assertSafeOutputDirectory } from '../src/html-renderer.js';

const root = resolve(import.meta.dirname, '..');

async function editorialFixture() {
  const deckPath = resolve(root, 'examples', 'brief-ink-pptx-poc.deck.md');
  const configPath = resolve(root, 'examples', 'brief-ink-pptx-poc.render.yaml');
  const config = await resolveRenderConfig(configPath);
  assert.ok(config.config, JSON.stringify(config.issues));
  assert.equal(config.issues.filter((item) => item.severity === 'error').length, 0);
  const parsed = parseDeck(readFileSync(deckPath, 'utf8'), deckPath);
  assert.equal(parsed.diagnostics.length, 0);
  return { deck: parsed.deck, config: config.config };
}

async function packageText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const slideFiles = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  return (await Promise.all(slideFiles.map((name) => zip.file(name)!.async('string')))).join('\n');
}

async function slideXml(bytes: Uint8Array, number: number): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file(`ppt/slides/slide${number}.xml`)!.async('string');
}

test('brief-ink maps the native POC fixture to maintained PPTX templates', async () => {
  const { deck, config } = await editorialFixture();
  const result = buildRenderPlan(deck, config, 'pptx');
  assert.deepEqual(result.issues, []);
  assert.equal(result.plan.theme.renderer, 'brief-ink-pptx-v1');
  assert.deepEqual(result.plan.slides.map((slide) => slide.template), [
    'brief-ink-pptx-cover-v1',
    'brief-ink-pptx-narrative-v1',
    'brief-ink-pptx-comparison-2col-v1',
  ]);
});

test('brief-ink native POC preserves its wide geometry and editable DrawingML text', async () => {
  const { deck, config } = await editorialFixture();
  const prepared = await preparePptxTheme(deck, config);
  const planning = buildRenderPlan(deck, config, 'pptx', prepared);
  assert.deepEqual(planning.issues, []);
  const bytes = await renderPreparedPptxTheme(prepared, { deck, plan: planning.plan, config });
  const inspection = await inspectPptxPackage(bytes);
  const adapterIssues = await verifyPreparedPptxTheme(prepared, { deck, plan: planning.plan, config, inspection }, bytes);
  assert.equal(inspection.slideCount, 3);
  assert.deepEqual(inspection.geometry, { widthEmu: 12192000, heightEmu: 6858000 });
  assert.equal(inspection.issues.length, 0);
  assert.deepEqual(adapterIssues, []);
  assert.ok(inspection.bytes.byteLength > 0);
  assert.match(inspection.bytes.sha256, /^[a-f0-9]{64}$/);
  assert.ok(inspection.slides.every((slide) => slide.drawingMlText.length > 0));
});

test('Brief Ink PPTX explicitly remains unsupported for expanded primary-supporting-context without a template or fallback', async () => {
  const deckPath = resolve(root, 'examples', 'primary-supporting-context-v2.deck.md');
  const configPath = resolve(root, 'examples', 'brief-ink-pptx-poc.render.yaml');
  const parsed = parseDeck(readFileSync(deckPath, 'utf8'), deckPath);
  assert.equal(parsed.diagnostics.length, 0);
  const resolved = await resolveRenderConfig(configPath);
  assert.ok(resolved.config, JSON.stringify(resolved.issues));
  const config = resolved.config;
  const prepared = await preparePptxTheme(parsed.deck, config);
  const planning = buildRenderPlan(parsed.deck, config, 'pptx', prepared);

  assert.ok(planning.issues.some((item) => item.code === 'unsupported-structure'));
  assert.equal(planning.plan.slides[0].template, undefined);
  assert.equal(planning.plan.slides[0].renderable, false);
  assert.ok(!planning.plan.slides.some((slide) => slide.template === 'brief-ink-pptx-narrative-v1' || slide.template === 'brief-ink-pptx-comparison-2col-v1'));
});

test('native PPTX artifact names are isolated from Web artifacts', () => {
  assert.deepEqual(resolvePptxArtifactPaths(resolve(root, 'examples/build')), {
    pptxPath: resolve(root, 'examples/build/index.pptx'),
    qaPath: resolve(root, 'examples/build/pptx.qa.json'),
  });
  assert.deepEqual(resolvePptxArtifactPaths('/tmp/client', '/tmp/client/strategy.pptx'), {
    pptxPath: '/tmp/client/strategy.pptx',
    qaPath: '/tmp/client/strategy.pptx.qa.json',
  });
  assert.throws(() => resolvePptxArtifactPaths('/tmp/client', '/tmp/client/strategy.html'), /\.pptx extension/);
});

test('generated PPTX artifacts cannot be written below the Skill source tree', () => {
  const artifacts = resolvePptxArtifactPaths(resolve(root, 'examples/build'));
  assert.throws(() => assertSafeOutputDirectory(resolve(artifacts.pptxPath, '..'), root), /Refusing to write/);
});
