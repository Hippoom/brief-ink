import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { exportPdfAfterQa } from '../src/browser-renderer.js';
import { renderHtml } from '../src/html-renderer.js';
import { parseDeck } from '../src/parser.js';
import { buildRenderPlan } from '../src/render-plan.js';
import { resolveRenderConfig } from '../src/render-config.js';

const root = resolve(import.meta.dirname, '..');
const deckPath = join(root, 'examples', 'v1-valid-consulting-deck.md');

async function chromiumReady(): Promise<boolean> {
  try {
    const playwright = await Function('return import("playwright")')() as {
      chromium: { launch(options: { headless: true }): Promise<{ close(): Promise<void> }> };
    };
    const browser = await playwright.chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

const browserTest = await chromiumReady() ? test : test.skip;

for (const configName of ['v1-valid-consulting-deck.render.yaml']) {
  browserTest(`${configName} exports one non-empty PDF page per planned slide`, async () => {
    const source = readFileSync(deckPath, 'utf8');
    const parsed = parseDeck(source, deckPath);
    assert.equal(parsed.diagnostics.filter((entry) => entry.severity === 'error').length, 0);
    const resolved = await resolveRenderConfig(join(root, 'examples', configName));
    assert.ok(resolved.config, JSON.stringify(resolved.issues));
    const config = resolved.config;
    const plan = buildRenderPlan(parsed.deck, config);
    assert.equal(plan.issues.filter((entry) => entry.severity === 'error').length, 0);
    const html = renderHtml(parsed.deck, plan.plan, config);
    const directory = mkdtempSync(join(tmpdir(), 'slide-skill-browser-pdf-'));
    const pdfPath = join(directory, 'deck.pdf');
    try {
      const result = await exportPdfAfterQa(html, plan.plan, config, pdfPath);
      assert.equal(result.issues.filter((entry) => entry.severity === 'error').length, 0, JSON.stringify(result.issues, null, 2));
      assert.equal(result.pdfWritten, true);
      assert.equal(existsSync(pdfPath), true);
      assert.ok(statSync(pdfPath).size > 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
