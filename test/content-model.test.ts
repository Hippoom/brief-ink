import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { normalizeContentModel } from '../src/content-model.js';
import { preflightContent, preflightContentModel } from '../src/content-preflight.js';
import { parseDeck } from '../src/parser.js';

const root = resolve(import.meta.dirname, '..');

function deckFixture(name: string) {
  const path = join(root, 'examples', name);
  return parseDeck(readFileSync(path, 'utf8'), path).deck;
}

test('normalizes legacy structures into bounded Content Patterns without mutating the Deck', () => {
  const deck = deckFixture('v1-valid-consulting-deck.md');
  const before = JSON.stringify(deck);
  const model = normalizeContentModel(deck);

  assert.equal(model.schema, 'slide-content-model/v1');
  assert.equal(model.deck, deck);
  assert.equal(JSON.stringify(deck), before);
  assert.deepEqual(
    model.slides.map(({ contentPattern, relationshipIntent, provenance }) => ({ contentPattern, relationshipIntent, provenance })),
    [
      { contentPattern: undefined, relationshipIntent: undefined, provenance: { sourceSchema: 'legacy-v1-v2', patternSource: 'absent', intentSource: 'absent' } },
      { contentPattern: undefined, relationshipIntent: undefined, provenance: { sourceSchema: 'legacy-v1-v2', patternSource: 'absent', intentSource: 'absent' } },
      { contentPattern: 'single-argument', relationshipIntent: undefined, provenance: { sourceSchema: 'legacy-v1-v2', patternSource: 'legacy-structure', intentSource: 'absent' } },
      { contentPattern: 'peer-groups', relationshipIntent: 'group', provenance: { sourceSchema: 'legacy-v1-v2', patternSource: 'legacy-structure', intentSource: 'pattern-default' } },
      { contentPattern: 'comparison', relationshipIntent: 'compare', provenance: { sourceSchema: 'legacy-v1-v2', patternSource: 'legacy-structure', intentSource: 'pattern-default' } },
      { contentPattern: 'ordered-stages', relationshipIntent: 'sequence', provenance: { sourceSchema: 'legacy-v1-v2', patternSource: 'legacy-structure', intentSource: 'pattern-default' } },
      { contentPattern: 'layered-model', relationshipIntent: 'hierarchy', provenance: { sourceSchema: 'legacy-v1-v2', patternSource: 'legacy-structure', intentSource: 'pattern-default' } },
      { contentPattern: 'tabular-reference', relationshipIntent: undefined, provenance: { sourceSchema: 'legacy-v1-v2', patternSource: 'legacy-structure', intentSource: 'absent' } },
    ],
  );
});

test('keeps an explicit v2 relationship model over a pattern default', () => {
  const deck = deckFixture('v2-content-preflight-valid.deck.md');
  const model = normalizeContentModel(deck);
  const recommendation = model.slides.find(({ slide }) => slide.meta?.id === 'activation-recommendation');

  assert.ok(recommendation);
  assert.equal(recommendation.contentPattern, 'ordered-stages');
  assert.equal(recommendation.relationshipIntent, 'sequence');
  assert.equal(recommendation.provenance.intentSource, 'legacy-relationship-model');
});

test('preserves typed payload references and leaves absent relationship intent absent', () => {
  const deck = deckFixture('primary-supporting-context-v1.deck.md');
  const model = normalizeContentModel(deck);
  const slide = model.slides[0];

  assert.equal(slide.contentPattern, 'primary-supporting');
  assert.equal(slide.relationshipIntent, 'supports');
  assert.equal(slide.provenance.intentSource, 'pattern-default');
  assert.equal(slide.slide.meta?.primary_supporting_context?.primary.id, 'governed-first-phase');
  assert.equal(slide.slide.meta?.primary_supporting_context?.supporting_contexts[0].supports_primary_id, 'governed-first-phase');
});

test('normalized Content Model preserves existing Content Preflight results', () => {
  for (const name of ['v1-valid-consulting-deck.md', 'v2-content-preflight-valid.deck.md', 'v2-content-preflight-quality-risks.deck.md']) {
    const deck = deckFixture(name);
    assert.deepEqual(preflightContentModel(normalizeContentModel(deck)), preflightContent(deck), name);
  }
});
