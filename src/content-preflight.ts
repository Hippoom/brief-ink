import { normalizeContentModel } from './content-model.js';
import { DECK_SCHEMA_V2, type ContentPositioning, type ContentPreflightIssue, type Deck, type NormalizedContentModel, type Slide, type Structure } from './types.js';

const DECISION_ROLES = new Set(['recommend', 'decide', 'commit']);

const COMPATIBLE_STRUCTURES: Partial<Record<NonNullable<ContentPositioning['relationship_model']>, readonly Structure[]>> = {
  'single-idea': ['narrative'],
  grouping: ['grouped-items'],
  comparison: ['comparison'],
  sequence: ['sequence'],
  layers: ['layers'],
  'tabular-reference': ['table'],
  'explore-converge-cycles': ['explore-converge-cycles'],
  'primary-supporting-context': ['primary-supporting-context'],
};

function add(issues: ContentPreflightIssue[], code: string, message: string, slide?: Slide, suggestion?: string): void {
  issues.push({
    severity: 'warning',
    stage: 'content-preflight',
    owner: 'content',
    code,
    message,
    suggestion,
    slideId: slide?.meta?.id,
    location: slide ? { line: slide.sourceLine } : { line: 1 },
  });
}

function isContentBearingSlide(slide: Slide): boolean {
  return slide.meta?.kind === 'content' || slide.meta?.kind === 'appendix';
}

function hasPositioningCore(positioning: ContentPositioning): boolean {
  return Boolean(positioning.audience_question && positioning.desired_outcome && positioning.story_role);
}

function requiresFootnotes(positioning: ContentPositioning): boolean {
  return positioning.proof_requirement === 'source-cited' || positioning.proof_requirement === 'decision-evidence';
}

/** Runs advisory review against the internal normalized Content Model. */
export function preflightContentModel(model: NormalizedContentModel): ContentPreflightIssue[] {
  const deck = model.deck;
  if (deck.meta.schema !== DECK_SCHEMA_V2) return [];

  const issues: ContentPreflightIssue[] = [];
  const contentSlides = model.slides.filter(({ slide }) => isContentBearingSlide(slide));
  for (const { slide, contentPattern, relationshipIntent, provenance } of contentSlides) {
    const positioning = slide.meta?.content_positioning;
    if (!positioning) {
      add(issues, 'content-preflight-missing-slide-positioning', 'This slide has no content_positioning declaration, so its audience purpose cannot be reviewed deterministically.', slide, 'Add the audience question, desired outcome, and story role needed to explain this slide’s contribution.');
      continue;
    }
    if (!hasPositioningCore(positioning)) {
      add(issues, 'content-preflight-incomplete-positioning', 'content_positioning is missing audience_question, desired_outcome, or story_role.', slide, 'Complete the minimum audience-purpose fields before relying on optional relationship, proof, or detail declarations.');
    }

    const compatibleStructures = positioning.relationship_model ? COMPATIBLE_STRUCTURES[positioning.relationship_model] : undefined;
    const structure = slide.meta?.structure as Structure | undefined;
    if (compatibleStructures && structure && !compatibleStructures.includes(structure)) {
      add(issues, 'content-preflight-relationship-structure-tension', `relationship_model=${positioning.relationship_model} and structure=${structure} express different semantic relationships.`, slide, 'Reassess the semantic relationship and update the declared structure or relationship model; do not request a visual-template substitute.');
    }
    // Normalized semantic values are intentionally not used to select templates
    // or change legacy advisory diagnostics during the compatibility period.
    void contentPattern;
    void relationshipIntent;
    void provenance;
    if (requiresFootnotes(positioning) && !slide.footnotes?.trim()) {
      add(issues, 'content-preflight-evidence-missing', `proof_requirement=${positioning.proof_requirement} requires visible source evidence, but this slide has no Footnotes block.`, slide, 'Add source evidence, or classify the claim explicitly as a hypothesis or validation need.');
    }
    if (positioning.detail_level === 'reference' && slide.meta?.kind !== 'appendix') {
      add(issues, 'content-preflight-reference-detail-on-core-slide', 'detail_level=reference is declared on a non-appendix slide.', slide, 'Move reference detail to an appendix or explicitly justify why the live audience needs it here.');
    }
  }

  if (deck.meta.story_brief?.decision_or_action && !contentSlides.some(({ slide }) => DECISION_ROLES.has(slide.meta?.content_positioning?.story_role ?? ''))) {
    add(issues, 'content-preflight-decision-unrepresented', 'story_brief.decision_or_action is declared, but no content or appendix slide is positioned as recommend, decide, or commit.', undefined, 'Add a decision-oriented slide that makes the requested action explicit for the audience.');
  }

  return issues;
}

/** Compatibility wrapper for existing callers and v1/v2 command behavior. */
export function preflightContent(deck: Deck): ContentPreflightIssue[] {
  return preflightContentModel(normalizeContentModel(deck));
}
