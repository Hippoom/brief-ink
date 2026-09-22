import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { renderHtml } from '../src/html-renderer.js';
import { parseDeck } from '../src/parser.js';
import { resolveRenderConfig } from '../src/render-config.js';
import { buildRenderPlan } from '../src/render-plan.js';
import { validateDeck } from '../src/validator.js';

const root = resolve(import.meta.dirname, '..');
const fixture = (name: string) => join(root, 'examples', name);

function deckFromFixture(name: string) {
  const sourcePath = fixture(name);
  return parseDeck(readFileSync(sourcePath, 'utf8'), sourcePath).deck;
}

async function webConfig() {
  const resolved = await resolveRenderConfig(fixture('primary-supporting-context-valid.render.yaml'));
  assert.ok(resolved.config, JSON.stringify(resolved.issues));
  assert.equal(resolved.issues.filter((item) => item.severity === 'error').length, 0);
  return resolved.config;
}

test('section is optional narrative metadata for content slides', () => {
  const deck = structuredClone(deckFromFixture('primary-supporting-context-v1.deck.md'));
  delete deck.slides[0].meta?.section;
  assert.deepEqual(validateDeck(deck), []);
  deck.slides[0].meta!.section = ' ';
  assert.ok(validateDeck(deck).some((diagnostic) => diagnostic.code === 'invalid-section'));
});

test('primary-supporting-context fixtures pass their schema-aware semantic contracts', () => {
  for (const name of ['primary-supporting-context-v1.deck.md', 'primary-supporting-context-v2.deck.md']) {
    assert.deepEqual(validateDeck(deckFromFixture(name)), [], name);
  }
});

test('Brief Ink Web renders expanded primary-supporting semantics exactly once and in declared order', async () => {
  const deck = deckFromFixture('primary-supporting-context-v2.deck.md');
  const config = await webConfig();
  const result = buildRenderPlan(deck, config);
  assert.deepEqual(result.issues, []);
  assert.equal(result.plan.slides[0].template, 'primary-supporting-context');

  const html = renderHtml(deck, result.plan, config);
  assert.equal((html.match(/class="primary-context"/g) ?? []).length, 1);
  assert.equal((html.match(/class="primary-group" data-primary-group-id=/g) ?? []).length, 2);
  assert.equal((html.match(/class="primary-supporting-callout" data-callout-id=/g) ?? []).length, 1);
  assert.ok(html.indexOf('data-primary-group-id="governance-foundations"') < html.indexOf('data-primary-group-id="operating-guardrails"'));
  assert.equal((html.match(/Shared identity and consent standards/g) ?? []).length, 1);
  assert.equal((html.match(/Accountable ownership and decision rights/g) ?? []).length, 1);
  assert.equal((html.match(/Sponsor the governed first phase and use pilot evidence to decide whether coordinated activation is ready to scale\./g) ?? []).length, 1);
  assert.equal((html.match(/class="supporting-context" data-supporting-context-id=/g) ?? []).length, 2);
  assert.equal((html.match(/class="supporting-continuity"/g) ?? []).length, 1);
  assert.ok(html.indexOf('data-supporting-context-id="journey-pilot"') < html.indexOf('data-supporting-context-id="decision-evidence"'));
  assert.equal((html.match(/A governed first phase can establish shared identity, consent, and measurement standards before coordinated activation is scaled\./g) ?? []).length, 1);
  assert.equal((html.match(/A selected journey can test orchestration rules, accountable ownership, and frontline handoffs in controlled conditions\./g) ?? []).length, 1);
  assert.equal((html.match(/Activation, customer, and operating evidence can determine whether the shared model is ready for broader adoption\./g) ?? []).length, 1);
  assert.match(html, /class="support-material-placeholder" role="note"/);
  assert.match(html, /class="support-material-declared" role="note"/);
  assert.doesNotMatch(html, /decision-evidence-summary\.png|<img|fetch\(/);
});

test('one-support rendering omits continuity and keeps the semantic placeholder treatment', async () => {
  const deck = deckFromFixture('primary-supporting-context-v1.deck.md');
  const config = await webConfig();
  const result = buildRenderPlan(deck, config);
  assert.deepEqual(result.issues, []);
  const html = renderHtml(deck, result.plan, config);
  assert.equal((html.match(/class="primary-context"/g) ?? []).length, 1);
  assert.equal((html.match(/class="supporting-context" data-supporting-context-id=/g) ?? []).length, 1);
  assert.doesNotMatch(html, /class="supporting-continuity"/);
  assert.match(html, /class="support-material-placeholder" role="note"/);
});

test('primary label is optional but non-empty when supplied', async () => {
  const deck = structuredClone(deckFromFixture('primary-supporting-context-v2.deck.md'));
  const primary = (deck.slides[0].meta?.primary_supporting_context as { primary: { label?: string } }).primary;
  delete primary.label;
  assert.deepEqual(validateDeck(deck), []);
  const config = await webConfig();
  const plan = buildRenderPlan(deck, config);
  const html = renderHtml(deck, plan.plan, config);
  assert.equal((html.match(/class="primary-context"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<h2 id="primary-governed-first-phase-title"/);
  assert.match(html, /aria-label="Primary argument"/);
  assert.equal((html.match(/A governed first phase can establish shared identity/g) ?? []).length, 1);

  primary.label = ' ';
  assert.ok(validateDeck(deck).some((diagnostic) => diagnostic.code === 'invalid-primary-supporting-context-primary'));
});

test('primary-group relation and callout quote preserve bounded semantics', async () => {
  const deck = structuredClone(deckFromFixture('primary-supporting-context-v2.deck.md'));
  const payload = deck.slides[0].meta?.primary_supporting_context as {
    primary_groups_relation?: string;
    callout?: { quote?: string; statement: string };
  };
  payload.primary_groups_relation = 'sequence';
  payload.callout = { ...payload.callout!, quote: 'A governed first phase starts with accountable scope.' };
  assert.deepEqual(validateDeck(deck), []);
  const config = await webConfig();
  const plan = buildRenderPlan(deck, config);
  const html = renderHtml(deck, plan.plan, config);
  assert.match(html, /data-primary-groups-relation="sequence"/);
  assert.match(html, /class="primary-group-ordinal"/);
  assert.match(html, /<blockquote class="callout-quote">A governed first phase starts with accountable scope\.<\/blockquote>/);
  assert.ok(html.indexOf('A governed first phase starts with accountable scope.') < html.indexOf('Sponsor the governed first phase'));

  payload.primary_groups_relation = 'invalid';
  assert.ok(validateDeck(deck).some((diagnostic) => diagnostic.code === 'invalid-primary-supporting-context-primary-groups-relation'));
  payload.primary_groups_relation = undefined;
  delete (payload as { primary_groups_relation?: string }).primary_groups_relation;
  payload.callout!.quote = ' ';
  assert.ok(validateDeck(deck).some((diagnostic) => diagnostic.code === 'invalid-primary-supporting-context-callout'));
});

test('primary groups and a callout extend the semantic payload without changing old primary-supporting behavior', () => {
  const deck = structuredClone(deckFromFixture('primary-supporting-context-v1.deck.md'));
  const payload = deck.slides[0].meta?.primary_supporting_context as {
    primary_groups?: Array<{ id: string; label: string; items: string[] }>;
    callout?: { id: string; label: string; statement: string };
  };
  payload.primary_groups = [
    { id: 'first-phase-standards', label: 'First-phase standards', items: ['Shared identity', 'Consent controls'] },
    { id: 'local-ownership', label: 'Local ownership', items: ['Proposition ownership remains local'] },
  ];
  payload.callout = {
    id: 'decision-boundary',
    label: 'Decision boundary',
    statement: 'Leadership sponsors the governed first phase without committing to scale before evidence is reviewed.',
  };

  assert.deepEqual(validateDeck(deck), []);
});

test('primary groups and callout enforce count, ordered items, global IDs, allowlists, and nested visual checks', () => {
  const invalidCases: Array<{ name: string; mutate: (payload: Record<string, unknown>) => void; code: string }> = [
    {
      name: 'too many groups',
      mutate: (payload) => {
        payload.primary_groups = [
          { id: 'group-a', label: 'A', items: ['A'] },
          { id: 'group-b', label: 'B', items: ['B'] },
          { id: 'group-c', label: 'C', items: ['C'] },
          { id: 'group-d', label: 'D', items: ['D'] },
        ];
      },
      code: 'primary-supporting-context-primary-group-count',
    },
    {
      name: 'empty group item list',
      mutate: (payload) => {
        payload.primary_groups = [{ id: 'group-a', label: 'A', items: [] }];
      },
      code: 'invalid-primary-supporting-context-primary-group-items',
    },
    {
      name: 'duplicate ID across payload namespace',
      mutate: (payload) => {
        payload.primary_groups = [{ id: 'governed-first-phase', label: 'Duplicate primary', items: ['A'] }];
      },
      code: 'duplicate-primary-supporting-context-id',
    },
    {
      name: 'unsupported callout field',
      mutate: (payload) => {
        payload.callout = { id: 'boundary', label: 'Boundary', statement: 'Statement', unsupported: true };
      },
      code: 'invalid-primary-supporting-context-callout',
    },
    {
      name: 'nested visual authoring field',
      mutate: (payload) => {
        payload.primary_groups = [{ id: 'group-a', label: 'A', items: ['A'], style: 'card' }];
      },
      code: 'prohibited-deck-visual-authoring',
    },
  ];

  for (const { name, mutate, code } of invalidCases) {
    const deck = structuredClone(deckFromFixture('primary-supporting-context-v1.deck.md'));
    const payload = deck.slides[0].meta?.primary_supporting_context as unknown as Record<string, unknown>;
    mutate(payload);
    assert.ok(validateDeck(deck).some((diagnostic) => diagnostic.code === code), name);
  }
});

test('renderer rejects malformed expanded payloads that bypass semantic validation', async () => {
  const deck = structuredClone(deckFromFixture('primary-supporting-context-v2.deck.md'));
  const config = await webConfig();
  const result = buildRenderPlan(deck, config);
  assert.deepEqual(result.issues, []);
  const payload = deck.slides[0].meta?.primary_supporting_context as { primary_groups: Array<{ items: string[] }>; supporting_contexts: Array<{ supports_primary_id: string }>; callout: { statement: string } };
  payload.primary_groups[0].items = [];
  assert.throws(() => renderHtml(deck, result.plan, config), /Renderer received invalid primary-supporting-context payload/);

  payload.primary_groups[0].items = ['Restored semantic item'];
  payload.callout.statement = '';
  assert.throws(() => renderHtml(deck, result.plan, config), /Renderer received invalid primary-supporting-context payload/);

  payload.callout.statement = 'Restored callout statement';
  payload.supporting_contexts[1].supports_primary_id = 'wrong-primary';
  assert.throws(() => renderHtml(deck, result.plan, config), /Renderer received invalid primary-supporting-context payload/);
});
