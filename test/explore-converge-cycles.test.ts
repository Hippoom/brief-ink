import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseDeck } from '../src/parser.js';
import { resolveRenderConfig } from '../src/render-config.js';
import { buildRenderPlan } from '../src/render-plan.js';
import { renderHtml } from '../src/html-renderer.js';
import { validateDeck } from '../src/validator.js';

const root = resolve(import.meta.dirname, '..');
const fixture = (name: string) => join(root, 'examples', name);

function deckFromFixture(name: string) {
  const sourcePath = fixture(name);
  return parseDeck(readFileSync(sourcePath, 'utf8'), sourcePath).deck;
}

function diagnosticCodes(name: string): string[] {
  return validateDeck(deckFromFixture(name)).map((diagnostic) => diagnostic.code);
}

test('English explore-converge fixture passes semantic validation', async () => {
  assert.deepEqual(diagnosticCodes('explore-converge-cycles-valid.deck.md'), []);
});

test('bilingual explore-converge fixture has no blocking semantic diagnostics', async () => {
  const diagnostics = validateDeck(deckFromFixture('explore-converge-cycles-bilingual.deck.md'));
  assert.equal(diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length, 0);
});

test('invalid fixture exposes strict semantic and visual-authoring diagnostics', async () => {
  const codes = diagnosticCodes('explore-converge-cycles-invalid.deck.md');
  for (const expected of [
    'invalid-explore-converge-cycles-payload',
    'prohibited-deck-visual-authoring',
    'invalid-explore-converge-emphasis',
    'invalid-explore-converge-inputs',
    'duplicate-explore-converge-cycle-id',
    'invalid-explore-converge-handoff-reference',
  ]) assert.ok(codes.includes(expected), `Missing diagnostic: ${expected}`);
});

async function renderedFixture(deckName: string, configName: string): Promise<string> {
  const deck = deckFromFixture(deckName);
  const resolved = await resolveRenderConfig(fixture(configName));
  assert.ok(resolved.config, JSON.stringify(resolved.issues));
  assert.equal(resolved.issues.filter((item) => item.severity === 'error').length, 0);
  const result = buildRenderPlan(deck, resolved.config);
  assert.deepEqual(result.issues, []);
  assert.equal(result.plan.slides[0].template, 'explore-converge-cycles');
  return renderHtml(deck, result.plan, resolved.config);
}

test('brief-ink renders a maintained content-first Stage-panel composition without fallback', async () => {
  const html = await renderedFixture('explore-converge-cycles-valid.deck.md', 'explore-converge-cycles-valid.render.yaml');
  assert.equal((html.match(/class="cycle cycle-/g) ?? []).length, 2);
  assert.match(html, /class="cycle cycle-focal"/);
  assert.match(html, /class="cycle cycle-standard"/);
  assert.ok(html.indexOf('cycle-focal') < html.indexOf('cycle-standard'));
  assert.match(html, /data-cycle-id="customer-needs"/);
  assert.match(html, /data-cycle-id="priority-actions"/);
  assert.equal((html.match(/data-handoff-id=/g) ?? []).length, 1);
  assert.equal((html.match(/class="cycle-stage-grid"/g) ?? []).length, 2);
  assert.equal((html.match(/class="cycle-stage-panel cycle-field cycle-/g) ?? []).length, 6);
  assert.match(html, /class="cycle-stage-grid">\s*<section class="cycle-stage-panel cycle-field cycle-inputs"[\s\S]*?cycle-exploration[\s\S]*?cycle-convergence/);
  assert.match(html, /class="cycle-handoff"/);
  assert.match(html, /class="handoff-arrow" aria-hidden="true"/);
  assert.match(html, /Translate validated opportunities into accountable actions/);
  assert.match(html, /<h2 id="cycle-customer-needs-title">Explore customer needs<\/h2>/);
  assert.match(html, /<h3>Inputs<\/h3>/);
  assert.match(html, /<h3>Exploration scope<\/h3>/);
  assert.match(html, /<h3>Convergence outputs<\/h3>/);
  assert.equal((html.match(/Customer signals from journeys, service contacts, and observed behaviour/g) ?? []).length, 1);
  assert.equal((html.match(/<svg/g) ?? []).length, 0);
  assert.equal((html.match(/<img/g) ?? []).length, 0);
  assert.equal((html.match(/style="/g) ?? []).length, 0);
  assert.doesNotMatch(html, /cycle-diamond|cycle-phase-surface|clip-path|@supports not/);
  assert.match(html, /overflow-wrap: anywhere/);
  assert.match(html, /\.cycle-stage-panel \{[^}]*border-radius: 0/);
  assert.match(html, /\.cycle-stage-panel:not\(:last-child\)::after \{[^}]*border-left: 7px solid var\(--accent\)/);
  assert.match(html, /class="deck density-compact"/);
});

test('bilingual Stage-panel render preserves source content without truncation markup', async () => {
  const html = await renderedFixture('explore-converge-cycles-bilingual.deck.md', 'explore-converge-cycles-bilingual.render.yaml');
  assert.match(html, /探索客户需求 \/ Explore customer needs/);
  assert.match(html, /跨客群与关键时刻验证优先机会假设/);
  assert.match(html, /Translate validated opportunities into accountable actions/);
  assert.doesNotMatch(html, /text-overflow:\s*ellipsis|line-clamp|white-space:\s*nowrap/);
});

test('renderer rejects an invalid cycle payload that bypasses semantic validation', async () => {
  const deck = structuredClone(deckFromFixture('explore-converge-cycles-valid.deck.md'));
  const resolved = await resolveRenderConfig(fixture('explore-converge-cycles-valid.render.yaml'));
  const config = resolved.config;
  assert.ok(config, JSON.stringify(resolved.issues));
  const result = buildRenderPlan(deck, config);
  assert.deepEqual(result.issues, []);
  const payload = deck.slides[0].meta?.explore_converge_cycles;
  assert.ok(payload);
  payload.handoff.to_cycle_id = payload.cycles[0].id;
  assert.throws(() => renderHtml(deck, result.plan, config), /Renderer received invalid explore-converge-cycles payload/);
});

test('a declared but unmapped maintained structure fails instead of falling back', async () => {
  const deck = deckFromFixture('explore-converge-cycles-valid.deck.md');
  const resolved = await resolveRenderConfig(fixture('explore-converge-cycles-valid.render.yaml'));
  assert.ok(resolved.config, JSON.stringify(resolved.issues));
  const config = {
    ...resolved.config,
    theme: {
      ...resolved.config.theme,
      templates: { ...resolved.config.theme.templates, structures: { ...resolved.config.theme.templates.structures } },
    },
  };
  delete config.theme.templates.structures['explore-converge-cycles'];
  const result = buildRenderPlan(deck, config);
  assert.equal(result.plan.slides[0].template, undefined);
  assert.ok(result.issues.some((item) => item.code === 'missing-template-mapping'));
});

test('render configuration rejects visual-authoring keys distinctly', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'slide-render-config-'));
  const configPath = join(directory, 'invalid.render.yaml');
  try {
    writeFileSync(configPath, 'theme: brief-ink\nprofile: compact\nlayout: custom-grid\n', 'utf8');
    const resolved = await resolveRenderConfig(configPath);
    assert.ok(resolved.issues.some((item) => item.code === 'prohibited-configuration-visual-authoring'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('legacy narrative template remains renderable', async () => {
  const sourcePath = fixture('v1-valid-consulting-deck.md');
  const deck = parseDeck(readFileSync(sourcePath, 'utf8'), sourcePath).deck;
  const configPath = fixture('v1-valid-consulting-deck.render.yaml');
  const resolved = await resolveRenderConfig(configPath);
  assert.ok(resolved.config, JSON.stringify(resolved.issues));
  const result = buildRenderPlan(deck, resolved.config);
  assert.deepEqual(result.issues, []);
  const html = renderHtml(deck, result.plan, resolved.config);
  assert.match(html, /class="narrative"/);
});
