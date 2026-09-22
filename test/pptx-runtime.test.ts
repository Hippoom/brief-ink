import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { parseDeck } from '../src/parser.js';
import { resolveRenderConfig } from '../src/render-config.js';
import { buildRenderPlan } from '../src/render-plan.js';
import { inspectPptxPackage } from '../src/pptx-package.js';
import { PptxPackage } from '../src/targets/pptx/package-runtime.js';
import { pptxTargetRuntime } from '../src/targets/pptx/runtime.js';
import { renderPptx } from '../src/pptx-renderer.js';

const root = resolve(import.meta.dirname, '..');
const src = resolve(root, 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

async function editorialFixture() {
  const deckPath = resolve(root, 'examples/brief-ink-pptx-poc.deck.md');
  const configPath = resolve(root, 'examples/brief-ink-pptx-poc.render.yaml');
  const config = await resolveRenderConfig(configPath);
  assert.ok(config.config);
  assert.equal(config.issues.filter((item) => item.severity === 'error').length, 0);
  const parsed = parseDeck(readFileSync(deckPath, 'utf8'), deckPath);
  assert.equal(parsed.diagnostics.length, 0);
  return { deck: parsed.deck, config: config.config };
}

test('PPTX runtime dependencies have one production import owner each', async () => {
  const imports = new Map([
    ['pptxgenjs', resolve(src, 'targets/pptx/runtime.ts')],
    ['jszip', resolve(src, 'targets/pptx/package-runtime.ts')],
  ]);

  for (const file of sourceFiles(src)) {
    const source = readFileSync(file, 'utf8');
    for (const [dependency, owner] of imports) {
      const directImport = new RegExp(`(?:from\\s+|import\\s*)['\"]${dependency}['\"]|require\\(\\s*['\"]${dependency}['\"]\\s*\\)`).test(source);
      if (directImport) assert.equal(file, owner, `${dependency} must be imported only by ${owner}`);
    }
  }
});

test('Brief Ink PPTX renderer receives presentation creation through its injected context', () => {
  const renderer = readFileSync(resolve(src, 'renderers/brief-ink-pptx-v1.ts'), 'utf8');

  assert.match(renderer, /renderBriefInkPptxV1\(\{ deck, plan, config, runtime \}: PptxRenderContext\)/);
  assert.match(renderer, /runtime\.createPresentation\(\)/);
  assert.doesNotMatch(renderer, /import\s*\{[^}]*createPptxPresentation/);
});

test('PPTX runtime produces an Editorial package consumable by the package facade', async () => {
  const { deck, config } = await editorialFixture();
  const plan = buildRenderPlan(deck, config, 'pptx').plan;
  const bytes = await renderPptx(deck, plan, config);
  const packageFile = await PptxPackage.loadAsync(bytes);

  assert.ok(bytes.byteLength > 0);
  assert.ok(packageFile.file('[Content_Types].xml'));
  assert.ok(packageFile.file('ppt/presentation.xml'));
  assert.equal(Object.keys(packageFile.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length, 3);
});

test('host PPTX runtime owns native presentation creation and generic inspection', async () => {
  const presentation = pptxTargetRuntime.createPresentation();
  presentation.layout = 'LAYOUT_WIDE';
  presentation.addSlide().addText('Runtime ownership');
  const bytes = await presentation.write({ outputType: 'uint8array', compression: true });

  assert.ok(bytes instanceof Uint8Array);
  const inspection = await pptxTargetRuntime.inspect(bytes);
  assert.equal(inspection.zip.valid, true);
  assert.equal(inspection.slideCount, 1);
});

test('generic PPTX inspection reports Editorial package facts without renderer policy', async () => {
  const { deck, config } = await editorialFixture();
  const plan = buildRenderPlan(deck, config, 'pptx').plan;
  const inspection = await inspectPptxPackage(await renderPptx(deck, plan, config));

  assert.equal(inspection.schema, 'slide-pptx-package-inspection/v1');
  assert.equal(inspection.zip.valid, true);
  assert.equal(inspection.opc.valid, true);
  assert.equal(inspection.xml.wellFormed, true);
  assert.deepEqual(inspection.opc.missingParts, []);
  assert.equal(inspection.slideCount, 3);
  assert.deepEqual(inspection.geometry, { widthEmu: 12192000, heightEmu: 6858000 });
  assert.match(inspection.bytes.sha256, /^[a-f0-9]{64}$/);
  assert.equal(inspection.parts.media.length, 0);
  assert.equal(inspection.relationships.external.length, 0);
  assert.ok(inspection.slides.every((slide) => slide.drawingMlText.length > 0));
  assert.ok(inspection.slides.every((slide) => !slide.hasRasterPicture && !slide.imageRelationship));
  assert.deepEqual(inspection.issues, []);
});

test('generic PPTX inspection reports invalid bytes without throwing', async () => {
  const inspection = await inspectPptxPackage(new TextEncoder().encode('not a zip package'));

  assert.equal(inspection.zip.valid, false);
  assert.equal(inspection.slideCount, 0);
  assert.equal(inspection.opc.valid, false);
  assert.ok(inspection.issues.some((issue) => issue.code === 'pptx-package-invalid'));
  assert.match(inspection.bytes.sha256, /^[a-f0-9]{64}$/);
});
