import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pdfPageCount } from '../src/browser-renderer.js';
import { assertSafeRenderArtifacts, resolveRenderArtifacts } from '../src/html-renderer.js';
import type { ResolvedRenderConfig } from '../src/types.js';

const root = resolve(import.meta.dirname, '..');

function config(sourcePath: string): ResolvedRenderConfig {
  return {
    sourcePath,
    theme: {
      name: 'brief-ink', version: 1, defaultProfile: 'compact', sourcePath: join(root, 'references/styles/brief-ink/manifest.yaml'),
      renderer: 'brief-ink-html-v1', tokensPath: join(root, 'references/styles/brief-ink/tokens.yaml'),
      supportedStructures: [], templates: { structures: {} },
    },
    profile: {
      name: 'compact', sourcePath: 'test', densityMode: 'compact', footerPolicy: 'standard', assetPolicy: 'strict',
      qa: { failOnOverflow: true, failOnMissingAsset: true },
    },
    output: { directory: 'build', html: true, pdf: true, png: false, pptx: false },
    qa: { failOnOverflow: true, failOnMissingAsset: true },
  };
}

test('artifact paths use stable names and preserve --out siblings', async () => {
  const renderConfig = config('/tmp/client/deck.render.yaml');
  assert.deepEqual(resolveRenderArtifacts(renderConfig), {
    htmlPath: '/tmp/client/build/index.html',
    pdfPath: '/tmp/client/build/index.pdf',
    qaPath: '/tmp/client/build/qa.json',
  });
  assert.deepEqual(resolveRenderArtifacts(renderConfig, '/tmp/client/output/strategy.html'), {
    htmlPath: '/tmp/client/output/strategy.html',
    pdfPath: '/tmp/client/output/strategy.pdf',
    qaPath: '/tmp/client/output/strategy.qa.json',
  });
});

test('artifact safety rejects generated deliverables under the Skill source', async () => {
  const artifacts = {
    htmlPath: join(root, 'build/index.html'),
    pdfPath: '/tmp/client/index.pdf',
    qaPath: '/tmp/client/qa.json',
  };
  assert.throws(() => assertSafeRenderArtifacts(artifacts, root), /htmlPath: Refusing to write generated deliverables below the Skill source directory/);
});

test('PDF page count detects page objects without matching Pages nodes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'slide-skill-pdf-pages-'));
  const pdfPath = join(directory, 'sample.pdf');
  try {
    writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj<</Type/Page>>endobj\n2 0 obj<</Type/Pages>>endobj\n3 0 obj<</Type/Page >>endobj\n');
    assert.equal(pdfPageCount(pdfPath), 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
