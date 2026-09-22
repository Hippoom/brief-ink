import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { preflightContent } from '../src/content-preflight.js';
import { parseDeck } from '../src/parser.js';
import { resolveRenderConfig } from '../src/render-config.js';
import { buildRenderPlan } from '../src/render-plan.js';
import { validateDeck } from '../src/validator.js';

const root = resolve(import.meta.dirname, '..');
const fixture = (name: string) => join(root, 'examples', name);

function parsedFixture(name: string) {
  const sourcePath = fixture(name);
  return parseDeck(readFileSync(sourcePath, 'utf8'), sourcePath);
}

function codes(name: string): string[] {
  return validateDeck(parsedFixture(name).deck).map((diagnostic) => diagnostic.code);
}

test('v2 complete content contract validates and has no Content Preflight issues', async () => {
  const parsed = parsedFixture('v2-content-preflight-valid.deck.md');
  assert.deepEqual(parsed.diagnostics, []);
  assert.deepEqual(validateDeck(parsed.deck), []);
  assert.deepEqual(preflightContent(parsed.deck), []);
});

test('v1 deck receives no v2 Content Preflight warning noise', async () => {
  const parsed = parsedFixture('v1-valid-consulting-deck.md');
  assert.deepEqual(preflightContent(parsed.deck), []);
});

test('v2 invalid metadata is a blocking semantic error', async () => {
  const expected = [
    'missing-v2-audience',
    'invalid-story-brief',
    'invalid-story-brief-constraint',
    'prohibited-deck-visual-authoring',
    'invalid-story-brief-field',
    'invalid-content-positioning-value',
    'invalid-content-positioning-field',
  ];
  const diagnosticCodes = codes('v2-content-preflight-invalid.deck.md');
  for (const code of expected) assert.ok(diagnosticCodes.includes(code), `Missing diagnostic: ${code}`);
});

test('v2 quality-risk fixture emits advisory content-owned Content Preflight warnings', async () => {
  const parsed = parsedFixture('v2-content-preflight-quality-risks.deck.md');
  assert.equal(validateDeck(parsed.deck).filter((diagnostic) => diagnostic.severity === 'error').length, 0);
  const issues = preflightContent(parsed.deck);
  assert.deepEqual(
    issues.map((issue) => issue.code),
    [
      'content-preflight-missing-slide-positioning',
      'content-preflight-incomplete-positioning',
      'content-preflight-relationship-structure-tension',
      'content-preflight-evidence-missing',
      'content-preflight-reference-detail-on-core-slide',
      'content-preflight-decision-unrepresented',
    ],
  );
  for (const issue of issues) {
    assert.equal(issue.severity, 'warning');
    assert.equal(issue.stage, 'content-preflight');
    assert.equal(issue.owner, 'content');
  }
});

test('v2 content positioning does not alter maintained template selection', async () => {
  const parsed = parsedFixture('v2-content-preflight-valid.deck.md');
  const resolved = await resolveRenderConfig(fixture('v2-content-preflight-valid.render.yaml'));
  assert.ok(resolved.config, JSON.stringify(resolved.issues));
  const plan = buildRenderPlan(parsed.deck, resolved.config);
  assert.deepEqual(plan.issues, []);
  const expectedTemplates = [
    ['cover', 'cover'],
    ['fragmented-identity', 'narrative'],
    ['activation-recommendation', 'sequence'],
    ['decision-criteria-reference', 'table'],
  ];
  assert.deepEqual(
    plan.plan.slides.map((slide) => [slide.slideId, slide.template]),
    expectedTemplates,
  );

  const changedPositioningDeck = structuredClone(parsed.deck);
  const positioning = changedPositioningDeck.slides[2].meta?.content_positioning;
  assert.ok(positioning);
  positioning.story_role = 'commit';
  positioning.detail_level = 'headline';
  positioning.proof_requirement = 'none';
  const changedPlan = buildRenderPlan(changedPositioningDeck, resolved.config);
  assert.deepEqual(changedPlan.issues, []);
  assert.deepEqual(
    changedPlan.plan.slides.map((slide) => [slide.slideId, slide.template]),
    expectedTemplates,
  );
  assert.equal(JSON.stringify(plan.plan).includes('content_positioning'), false);
  assert.equal(JSON.stringify(changedPlan.plan).includes('content_positioning'), false);
});
