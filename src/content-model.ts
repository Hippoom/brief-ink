import type {
  ContentPattern,
  Deck,
  NormalizedContentModel,
  NormalizedSlideSemantics,
  RelationshipIntent,
  RelationshipModel,
  Structure,
} from './types.js';

const PATTERN_BY_STRUCTURE: Partial<Record<Structure, ContentPattern>> = {
  narrative: 'single-argument',
  'grouped-items': 'peer-groups',
  comparison: 'comparison',
  sequence: 'ordered-stages',
  layers: 'layered-model',
  table: 'tabular-reference',
  chart: 'quantitative-evidence',
  'relationship-map': 'connected-system',
  'explore-converge-cycles': 'explore-converge',
  'primary-supporting-context': 'primary-supporting',
};

const INTENT_BY_LEGACY_MODEL: Partial<Record<RelationshipModel, RelationshipIntent>> = {
  'single-idea': 'explain',
  grouping: 'group',
  comparison: 'compare',
  sequence: 'sequence',
  layers: 'hierarchy',
  'tabular-reference': 'reference',
  'decision-gate': 'decision-gate',
  handoff: 'handoff',
  'explore-converge-cycles': 'explore-converge',
  'primary-supporting-context': 'supports',
};

const DEFAULT_INTENT_BY_PATTERN: Partial<Record<ContentPattern, RelationshipIntent>> = {
  'peer-groups': 'group',
  comparison: 'compare',
  'ordered-stages': 'sequence',
  'layered-model': 'hierarchy',
  'explore-converge': 'explore-converge',
  'primary-supporting': 'supports',
};

function normalizeSlide(deck: Deck, index: number): NormalizedSlideSemantics {
  const slide = deck.slides[index];
  const structure = slide.meta?.structure as Structure | undefined;
  const contentPattern = structure ? PATTERN_BY_STRUCTURE[structure] : undefined;
  const legacyModel = slide.meta?.content_positioning?.relationship_model;
  const explicitIntent = legacyModel ? INTENT_BY_LEGACY_MODEL[legacyModel] : undefined;
  const relationshipIntent = explicitIntent ?? (contentPattern ? DEFAULT_INTENT_BY_PATTERN[contentPattern] : undefined);

  return {
    slide,
    ...(contentPattern ? { contentPattern } : {}),
    ...(relationshipIntent ? { relationshipIntent } : {}),
    provenance: {
      sourceSchema: 'legacy-v1-v2',
      patternSource: contentPattern ? 'legacy-structure' : 'absent',
      intentSource: explicitIntent ? 'legacy-relationship-model' : relationshipIntent ? 'pattern-default' : 'absent',
    },
  };
}

/**
 * Creates a pure, non-mutating normalized projection for semantic consumers.
 * It deliberately does not parse or emit the future `content_model` DSL field.
 */
export function normalizeContentModel(deck: Deck): NormalizedContentModel {
  return {
    schema: 'slide-content-model/v1',
    deck,
    slides: deck.slides.map((_, index) => normalizeSlide(deck, index)),
  };
}
