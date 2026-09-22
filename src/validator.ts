import { existsSync } from 'node:fs';
import {
  DECK_SCHEMA_V1,
  DECK_SCHEMA_V2,
  DETAIL_LEVELS,
  KINDS,
  PROOF_REQUIREMENTS,
  RELATIONSHIP_MODELS,
  STORY_ROLES,
  STRUCTURES,
  type Deck,
  type Diagnostic,
  type Slide,
} from './types.js';

const SUPPORTED_SCHEMAS = new Set([DECK_SCHEMA_V1, DECK_SCHEMA_V2]);
const VISUAL_AUTHORING_KEYS = new Set([
  'css', 'style', 'styles', 'class', 'class_name', 'template', 'templates', 'layout', 'visual', 'render', 'variant',
  'color', 'colors', 'font', 'fonts', 'x', 'y', 'left', 'top', 'right', 'bottom', 'width', 'height', 'size', 'sizes',
  'position', 'coordinates', 'geometry', 'grid', 'margin', 'margins', 'padding', 'per_slide_override', 'slide_override',
]);
const CYCLE_KEYS = new Set(['id', 'label', 'emphasis', 'inputs', 'exploration_scope', 'convergence_outputs']);
const HANDOFF_KEYS = new Set(['id', 'label', 'from_cycle_id', 'to_cycle_id']);
const PAYLOAD_KEYS = new Set(['cycles', 'handoff']);
const EXPLORE_CONVERGE_META_KEYS = new Set(['id', 'kind', 'section', 'structure', 'assets', 'explore_converge_cycles']);
const PRIMARY_SUPPORTING_META_KEYS = new Set(['id', 'kind', 'section', 'structure', 'assets', 'primary_supporting_context', 'content_positioning']);
const PRIMARY_SUPPORTING_PAYLOAD_KEYS = new Set(['primary', 'supporting_contexts', 'continuity', 'primary_groups', 'primary_groups_relation', 'callout']);
const PRIMARY_SUPPORTING_PRIMARY_KEYS = new Set(['id', 'label', 'statement', 'self_sufficient']);
const PRIMARY_SUPPORTING_CONTEXT_KEYS = new Set(['id', 'label', 'statement', 'supports_primary_id', 'support_relation', 'material']);
const PRIMARY_SUPPORTING_MATERIAL_KEYS = new Set(['status', 'asset_id']);
const PRIMARY_SUPPORTING_CONTINUITY_KEYS = new Set(['id', 'label', 'from_supporting_context_id', 'to_supporting_context_id']);
const PRIMARY_SUPPORTING_GROUP_KEYS = new Set(['id', 'label', 'items']);
const PRIMARY_SUPPORTING_CALLOUT_KEYS = new Set(['id', 'label', 'quote', 'statement']);
const PRIMARY_SUPPORTING_RELATIONS = new Set(['illustration', 'example', 'evidence', 'action', 'reference']);
const STORY_BRIEF_KEYS = new Set(['audience_outcome', 'decision_or_action', 'narrative', 'constraints']);
const CONTENT_POSITIONING_KEYS = new Set([
  'audience_question',
  'desired_outcome',
  'story_role',
  'relationship_model',
  'proof_requirement',
  'detail_level',
]);

function add(diagnostics: Diagnostic[], severity: Diagnostic['severity'], code: string, message: string, slide?: Slide, line?: number, suggestion?: string): void {
  diagnostics.push({ severity, code, message, suggestion, slideId: slide?.meta?.id, location: line ? { line } : slide ? { line: slide.sourceLine } : undefined });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTopicLike(title: string): boolean {
  return title.trim().split(/\s+/).length <= 4 && !/[.!?：:—–-]/.test(title);
}

function hasMarkdownTable(content: string): boolean {
  return /\|.+\|\s*\n\|\s*:?-{3,}/.test(content);
}

function hasOrderedSequence(content: string): boolean {
  return /^\s*\d+[.)]\s+/m.test(content) || /^#{3,}\s*(Phase|Step)\b/im.test(content);
}

function validateVisualAuthoringKeys(value: unknown, diagnostics: Diagnostic[], label: string, slide?: Slide, line?: number): void {
  if (Array.isArray(value)) {
    for (const item of value) validateVisualAuthoringKeys(item, diagnostics, label, slide, line);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (VISUAL_AUTHORING_KEYS.has(key.toLowerCase())) {
      add(diagnostics, 'error', 'prohibited-deck-visual-authoring', `${label} contains prohibited visual or geometry field: ${key}.`, slide, line, 'Keep business semantics in deck Markdown; themes own templates, CSS, colors, and geometry.');
    }
    validateVisualAuthoringKeys(child, diagnostics, label, slide, line);
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateStringList(value: unknown, field: string, diagnostics: Diagnostic[], slide: Slide): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !nonEmptyString(item))) {
    add(diagnostics, 'error', `invalid-explore-converge-${field}`, `explore_converge_cycles cycle field ${field} must be a non-empty ordered list of non-empty strings.`, slide, slide.sourceLine, 'Provide the required semantic entries without visual instructions.');
    return;
  }
  if (value.length > 4) {
    add(diagnostics, 'warning', 'explore-converge-density-risk', `explore_converge_cycles cycle field ${field} contains ${value.length} items and may exceed the maintained template capacity.`, slide, slide.sourceLine, 'Split the cycle detail or consolidate decision-irrelevant items without changing the semantic structure.');
  }
}

function validatePrimarySupportingContext(slide: Slide, diagnostics: Diagnostic[]): void {
  for (const key of Object.keys(slide.meta ?? {})) {
    if (!PRIMARY_SUPPORTING_META_KEYS.has(key)) add(diagnostics, 'error', 'invalid-primary-supporting-context-meta-field', `primary-supporting-context slide-meta contains unsupported field: ${key}.`, slide, slide.sourceLine, 'Use only documented slide metadata and the primary_supporting_context semantic payload.');
  }
  const payload = slide.meta?.primary_supporting_context;
  if (payload === undefined) {
    add(diagnostics, 'error', 'missing-primary-supporting-context-payload', 'structure=primary-supporting-context requires primary_supporting_context in slide-meta.', slide, slide.sourceLine, 'Add one primary argument and one or two explicitly supporting contexts.');
    return;
  }
  if (!isObject(payload)) {
    add(diagnostics, 'error', 'invalid-primary-supporting-context-payload', 'primary_supporting_context must be a YAML mapping.', slide, slide.sourceLine);
    return;
  }
  for (const key of Object.keys(payload)) if (!PRIMARY_SUPPORTING_PAYLOAD_KEYS.has(key)) add(diagnostics, 'error', 'invalid-primary-supporting-context-payload', `primary_supporting_context contains unsupported field: ${key}.`, slide, slide.sourceLine);
  validateVisualAuthoringKeys(payload, diagnostics, 'primary_supporting_context', slide, slide.sourceLine);

  const primary = payload.primary;
  if (!isObject(primary)) {
    add(diagnostics, 'error', 'invalid-primary-supporting-context-primary', 'primary_supporting_context.primary must be a YAML mapping.', slide, slide.sourceLine);
    return;
  }
  for (const key of Object.keys(primary)) if (!PRIMARY_SUPPORTING_PRIMARY_KEYS.has(key)) add(diagnostics, 'error', 'invalid-primary-supporting-context-primary', `Primary contains unsupported field: ${key}.`, slide, slide.sourceLine);
  if (!nonEmptyString(primary.id) || !nonEmptyString(primary.statement) || primary.self_sufficient !== true) {
    add(diagnostics, 'error', 'invalid-primary-supporting-context-primary', 'Primary requires non-empty id, statement, and self_sufficient: true.', slide, slide.sourceLine, 'Declare one self-sufficient primary business argument.');
  }
  if (primary.label !== undefined && !nonEmptyString(primary.label)) {
    add(diagnostics, 'error', 'invalid-primary-supporting-context-primary', 'Primary label is optional, but when declared it must be a non-empty string.', slide, slide.sourceLine);
  }
  const ids = new Set<string>();
  const registerId = (id: unknown, label: string): void => {
    if (!nonEmptyString(id)) return;
    if (ids.has(id)) add(diagnostics, 'error', 'duplicate-primary-supporting-context-id', `${label} id ${id} is duplicated in the primary_supporting_context payload.`, slide, slide.sourceLine);
    else ids.add(id);
  };
  const primaryId = nonEmptyString(primary.id) ? primary.id : undefined;
  registerId(primaryId, 'Primary');

  const declaredAssetIds = new Set(
    Array.isArray(slide.meta?.assets)
      ? slide.meta.assets.flatMap((asset) => isObject(asset) && nonEmptyString(asset.id) ? [asset.id] : [])
      : [],
  );
  const contexts = payload.supporting_contexts;
  if (!Array.isArray(contexts) || contexts.length < 1 || contexts.length > 2) {
    add(diagnostics, 'error', 'primary-supporting-context-count', 'primary_supporting_context requires one or two supporting_contexts.', slide, slide.sourceLine, 'Declare one or two subordinate contexts only.');
    return;
  }
  contexts.forEach((context, index) => {
    if (!isObject(context)) {
      add(diagnostics, 'error', 'invalid-primary-supporting-context-supporting-context', `Supporting context ${index + 1} must be a YAML mapping.`, slide, slide.sourceLine);
      return;
    }
    for (const key of Object.keys(context)) if (!PRIMARY_SUPPORTING_CONTEXT_KEYS.has(key)) add(diagnostics, 'error', 'invalid-primary-supporting-context-supporting-context', `Supporting context ${index + 1} contains unsupported field: ${key}.`, slide, slide.sourceLine);
    if (!nonEmptyString(context.id) || !nonEmptyString(context.label) || !nonEmptyString(context.statement)) add(diagnostics, 'error', 'invalid-primary-supporting-context-supporting-context', `Supporting context ${index + 1} requires non-empty id, label, and statement.`, slide, slide.sourceLine);
    else registerId(context.id, `Supporting context ${index + 1}`);
    if (!primaryId || context.supports_primary_id !== primaryId) add(diagnostics, 'error', 'invalid-primary-supporting-context-primary-reference', `Supporting context ${index + 1} must set supports_primary_id to the declared primary id.`, slide, slide.sourceLine);
    if (typeof context.support_relation !== 'string' || !PRIMARY_SUPPORTING_RELATIONS.has(context.support_relation)) add(diagnostics, 'error', 'invalid-primary-supporting-context-support-relation', `Supporting context ${index + 1} support_relation must be one of: ${[...PRIMARY_SUPPORTING_RELATIONS].join(', ')}.`, slide, slide.sourceLine);
    const material = context.material;
    if (!isObject(material)) {
      add(diagnostics, 'error', 'invalid-primary-supporting-context-material', `Supporting context ${index + 1} requires a material mapping.`, slide, slide.sourceLine);
      return;
    }
    for (const key of Object.keys(material)) if (!PRIMARY_SUPPORTING_MATERIAL_KEYS.has(key)) add(diagnostics, 'error', 'invalid-primary-supporting-context-material', `Supporting context ${index + 1} material contains unsupported field: ${key}.`, slide, slide.sourceLine);
    if (material.status !== 'asset' && material.status !== 'placeholder') add(diagnostics, 'error', 'invalid-primary-supporting-context-material', `Supporting context ${index + 1} material.status must be asset or placeholder.`, slide, slide.sourceLine);
    if (material.status === 'asset' && !nonEmptyString(material.asset_id)) add(diagnostics, 'error', 'invalid-primary-supporting-context-asset-id', `Supporting context ${index + 1} material.asset_id is required when status is asset.`, slide, slide.sourceLine);
    if (material.status === 'asset' && nonEmptyString(material.asset_id) && !declaredAssetIds.has(material.asset_id)) add(diagnostics, 'error', 'unknown-primary-supporting-context-asset-id', `Supporting context ${index + 1} material.asset_id must reference an id declared in slide-meta.assets.`, slide, slide.sourceLine, 'Declare the asset once in slide-meta.assets or use status: placeholder.');
    if (material.status === 'placeholder' && material.asset_id !== undefined) add(diagnostics, 'error', 'invalid-primary-supporting-context-asset-id', `Supporting context ${index + 1} material.asset_id must be omitted when status is placeholder.`, slide, slide.sourceLine);
  });

  const primaryGroups = payload.primary_groups;
  if (primaryGroups !== undefined) {
    if (!Array.isArray(primaryGroups) || primaryGroups.length < 1 || primaryGroups.length > 3) {
      add(diagnostics, 'error', 'primary-supporting-context-primary-group-count', 'primary_groups must contain one to three ordered groups when declared.', slide, slide.sourceLine, 'Declare one to three semantic groups only.');
    } else {
      primaryGroups.forEach((group, index) => {
        if (!isObject(group)) {
          add(diagnostics, 'error', 'invalid-primary-supporting-context-primary-group', `Primary group ${index + 1} must be a YAML mapping.`, slide, slide.sourceLine);
          return;
        }
        for (const key of Object.keys(group)) if (!PRIMARY_SUPPORTING_GROUP_KEYS.has(key)) add(diagnostics, 'error', 'invalid-primary-supporting-context-primary-group', `Primary group ${index + 1} contains unsupported field: ${key}.`, slide, slide.sourceLine);
        if (!nonEmptyString(group.id) || !nonEmptyString(group.label)) add(diagnostics, 'error', 'invalid-primary-supporting-context-primary-group', `Primary group ${index + 1} requires non-empty id and label.`, slide, slide.sourceLine);
        else registerId(group.id, `Primary group ${index + 1}`);
        if (!Array.isArray(group.items) || group.items.length === 0 || group.items.some((item) => !nonEmptyString(item))) add(diagnostics, 'error', 'invalid-primary-supporting-context-primary-group-items', `Primary group ${index + 1} items must be a non-empty ordered list of non-empty strings.`, slide, slide.sourceLine, 'Keep each item as an ordered semantic statement without visual instructions.');
      });
    }
  }

  const primaryGroupsRelation = payload.primary_groups_relation;
  if (primaryGroupsRelation !== undefined && primaryGroups === undefined) add(diagnostics, 'error', 'invalid-primary-supporting-context-primary-groups-relation', 'primary_groups_relation requires primary_groups.', slide, slide.sourceLine);
  if (primaryGroupsRelation !== undefined && primaryGroupsRelation !== 'sequence' && primaryGroupsRelation !== 'parallel') add(diagnostics, 'error', 'invalid-primary-supporting-context-primary-groups-relation', 'primary_groups_relation must be sequence or parallel when declared.', slide, slide.sourceLine);

  const callout = payload.callout;
  if (callout !== undefined) {
    if (!isObject(callout)) {
      add(diagnostics, 'error', 'invalid-primary-supporting-context-callout', 'callout must be a YAML mapping when declared.', slide, slide.sourceLine);
    } else {
      for (const key of Object.keys(callout)) if (!PRIMARY_SUPPORTING_CALLOUT_KEYS.has(key)) add(diagnostics, 'error', 'invalid-primary-supporting-context-callout', `Callout contains unsupported field: ${key}.`, slide, slide.sourceLine);
      if (!nonEmptyString(callout.id) || !nonEmptyString(callout.label) || !nonEmptyString(callout.statement) || (callout.quote !== undefined && !nonEmptyString(callout.quote))) add(diagnostics, 'error', 'invalid-primary-supporting-context-callout', 'Callout requires non-empty id, label, and statement; quote is optional but non-empty when declared.', slide, slide.sourceLine);
      else registerId(callout.id, 'Callout');
    }
  }

  const continuity = payload.continuity;
  if (isObject(continuity) && nonEmptyString(continuity.id)) registerId(continuity.id, 'Continuity');
  if (contexts.length === 1) {
    if (continuity !== undefined) add(diagnostics, 'error', 'invalid-primary-supporting-context-continuity', 'continuity must be omitted when there is one supporting context.', slide, slide.sourceLine);
    return;
  }
  if (!isObject(continuity)) {
    add(diagnostics, 'error', 'invalid-primary-supporting-context-continuity', 'Two supporting contexts require one named continuity mapping.', slide, slide.sourceLine);
    return;
  }
  for (const key of Object.keys(continuity)) if (!PRIMARY_SUPPORTING_CONTINUITY_KEYS.has(key)) add(diagnostics, 'error', 'invalid-primary-supporting-context-continuity', `Continuity contains unsupported field: ${key}.`, slide, slide.sourceLine);
  const firstId = isObject(contexts[0]) && nonEmptyString(contexts[0].id) ? contexts[0].id : undefined;
  const secondId = isObject(contexts[1]) && nonEmptyString(contexts[1].id) ? contexts[1].id : undefined;
  if (!nonEmptyString(continuity.id) || !nonEmptyString(continuity.label) || continuity.from_supporting_context_id !== firstId || continuity.to_supporting_context_id !== secondId) {
    add(diagnostics, 'error', 'invalid-primary-supporting-context-continuity', 'Continuity requires non-empty id and label, and must run forward from supporting_contexts[0] to supporting_contexts[1].', slide, slide.sourceLine, 'Name the semantic progression between the two supporting contexts.');
  }
}

function validateExploreConvergeCycles(slide: Slide, diagnostics: Diagnostic[]): void {
  for (const key of Object.keys(slide.meta ?? {})) {
    if (!EXPLORE_CONVERGE_META_KEYS.has(key)) {
      add(diagnostics, 'error', 'invalid-explore-converge-meta-field', `explore-converge-cycles slide-meta contains unsupported field: ${key}.`, slide, slide.sourceLine, 'Use only documented slide metadata and the explore_converge_cycles semantic payload.');
    }
  }
  const payload = slide.meta?.explore_converge_cycles;
  if (payload === undefined) {
    add(diagnostics, 'error', 'missing-explore-converge-cycles-payload', 'structure=explore-converge-cycles requires explore_converge_cycles in slide-meta.', slide, slide.sourceLine, 'Add the required two cycles and one named handoff semantic payload.');
    return;
  }
  if (!isObject(payload)) {
    add(diagnostics, 'error', 'invalid-explore-converge-cycles-payload', 'explore_converge_cycles must be a YAML mapping.', slide, slide.sourceLine);
    return;
  }
  for (const key of Object.keys(payload)) if (!PAYLOAD_KEYS.has(key)) add(diagnostics, 'error', 'invalid-explore-converge-cycles-payload', `explore_converge_cycles contains unsupported field: ${key}.`, slide, slide.sourceLine, 'Use only cycles and handoff.');
  validateVisualAuthoringKeys(payload, diagnostics, 'explore_converge_cycles', slide, slide.sourceLine);

  const cycles = payload.cycles;
  if (!Array.isArray(cycles) || cycles.length !== 2) {
    add(diagnostics, 'error', 'explore-converge-cycle-count', 'explore_converge_cycles requires exactly two cycles.', slide, slide.sourceLine, 'Provide cycle[0] and cycle[1] only.');
    return;
  }
  const ids = new Set<string>();
  cycles.forEach((cycle, index) => {
    if (!isObject(cycle)) {
      add(diagnostics, 'error', 'invalid-explore-converge-cycle', `Cycle ${index + 1} must be a YAML mapping.`, slide, slide.sourceLine);
      return;
    }
    for (const key of Object.keys(cycle)) if (!CYCLE_KEYS.has(key)) add(diagnostics, 'error', 'invalid-explore-converge-cycle', `Cycle ${index + 1} contains unsupported field: ${key}.`, slide, slide.sourceLine, 'Use only the documented semantic fields.');
    if (!nonEmptyString(cycle.id)) add(diagnostics, 'error', 'invalid-explore-converge-cycle-id', `Cycle ${index + 1} requires a non-empty id.`, slide, slide.sourceLine);
    else if (ids.has(cycle.id)) add(diagnostics, 'error', 'duplicate-explore-converge-cycle-id', `Cycle id ${cycle.id} is duplicated.`, slide, slide.sourceLine);
    else ids.add(cycle.id);
    if (!nonEmptyString(cycle.label)) add(diagnostics, 'error', 'invalid-explore-converge-label', `Cycle ${index + 1} requires a non-empty label.`, slide, slide.sourceLine);
    const expectedEmphasis = index === 0 ? 'focal' : 'standard';
    if (cycle.emphasis !== expectedEmphasis) add(diagnostics, 'error', 'invalid-explore-converge-emphasis', `Cycle ${index + 1} must declare emphasis: ${expectedEmphasis}.`, slide, slide.sourceLine, 'The two fixed emphasis states preserve the maintained template contract.');
    validateStringList(cycle.inputs, 'inputs', diagnostics, slide);
    validateStringList(cycle.exploration_scope, 'exploration-scope', diagnostics, slide);
    validateStringList(cycle.convergence_outputs, 'convergence-outputs', diagnostics, slide);
  });

  const handoff = payload.handoff;
  if (!isObject(handoff)) {
    add(diagnostics, 'error', 'invalid-explore-converge-handoff', 'explore_converge_cycles requires one named handoff mapping.', slide, slide.sourceLine);
    return;
  }
  for (const key of Object.keys(handoff)) if (!HANDOFF_KEYS.has(key)) add(diagnostics, 'error', 'invalid-explore-converge-handoff', `Handoff contains unsupported field: ${key}.`, slide, slide.sourceLine, 'Use only id, label, from_cycle_id, and to_cycle_id.');
  if (!nonEmptyString(handoff.id) || !nonEmptyString(handoff.label)) add(diagnostics, 'error', 'invalid-explore-converge-handoff', 'Handoff requires non-empty id and label values.', slide, slide.sourceLine, 'Name the business handoff explicitly.');
  if (!nonEmptyString(handoff.from_cycle_id) || !nonEmptyString(handoff.to_cycle_id)) add(diagnostics, 'error', 'invalid-explore-converge-handoff-reference', 'Handoff requires from_cycle_id and to_cycle_id.', slide, slide.sourceLine);
  else {
    const firstId = isObject(cycles[0]) && typeof cycles[0].id === 'string' ? cycles[0].id : undefined;
    const secondId = isObject(cycles[1]) && typeof cycles[1].id === 'string' ? cycles[1].id : undefined;
    if (!ids.has(handoff.from_cycle_id) || !ids.has(handoff.to_cycle_id)) add(diagnostics, 'error', 'invalid-explore-converge-handoff-reference', 'Handoff must reference the two declared cycle IDs.', slide, slide.sourceLine);
    else if (handoff.from_cycle_id !== firstId || handoff.to_cycle_id !== secondId) add(diagnostics, 'error', 'explore-converge-handoff-must-be-adjacent-forward', 'Handoff must run forward from cycle[0] to adjacent cycle[1].', slide, slide.sourceLine, 'Set from_cycle_id to cycle[0].id and to_cycle_id to cycle[1].id.');
  }
}

const superscriptDigits: Record<string, string> = { '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

function normalizeFootnoteNumber(value: string): string {
  return superscriptDigits[value] ?? value;
}

function markerNumbers(text: string): string[] {
  return [...text.matchAll(/[¹²³⁴⁵⁶⁷⁸⁹]|\[(\d+)\]/g)].map((match) => normalizeFootnoteNumber(match[1] ?? match[0]));
}

function footnoteNumbers(text: string): Set<string> {
  return new Set([...text.matchAll(/^\s*(\d+|[¹²³⁴⁵⁶⁷⁸⁹])(?:[.)])?\s+/gm)].map((match) => normalizeFootnoteNumber(match[1])));
}

function containsVisualInstruction(content: string): boolean {
  return /\b(?:css|html)\s*[{:]|\b(?:font-size|background-color|grid-template|margin|padding)\s*:|\b(?:left|top|right|bottom|width|height|x|y)\s*[:=]\s*\d+(?:px|%|rem|em)?\b|\b(?:place|position|set)\s+(?:at|to)\s+(?:x\s*[:=]?\s*\d+|y\s*[:=]?\s*\d+|\d+px)|\b(?:use|place|add)\s+(?:(?:\d+|one|two|three|four|five)\s+)?(?:blue|green|red)\s+(?:cards?|arrows?|columns?)\b/i.test(content);
}

function validateStoryBrief(deck: Deck, diagnostics: Diagnostic[]): void {
  if (!nonEmptyString(deck.meta.audience)) {
    add(diagnostics, 'error', 'missing-v2-audience', 'slide-deck/v2 requires a non-empty top-level audience.', undefined, 1, 'State the decision-making audience in deck frontmatter.');
  }

  const storyBrief = deck.meta.story_brief;
  if (storyBrief === undefined) {
    add(diagnostics, 'error', 'missing-story-brief', 'slide-deck/v2 requires a story_brief mapping in deck frontmatter.', undefined, 1, 'Declare audience_outcome, decision_or_action, narrative, and constraints.');
    return;
  }
  if (!isObject(storyBrief)) {
    add(diagnostics, 'error', 'invalid-story-brief', 'story_brief must be a YAML mapping.', undefined, 1);
    return;
  }
  validateVisualAuthoringKeys(storyBrief, diagnostics, 'story_brief', undefined, 1);
  for (const key of Object.keys(storyBrief)) {
    if (!STORY_BRIEF_KEYS.has(key)) add(diagnostics, 'error', 'invalid-story-brief-field', `story_brief contains unsupported field: ${key}.`, undefined, 1, 'Use only audience_outcome, decision_or_action, narrative, and constraints.');
  }
  for (const field of ['audience_outcome', 'decision_or_action', 'narrative'] as const) {
    if (!nonEmptyString(storyBrief[field])) add(diagnostics, 'error', 'invalid-story-brief', `story_brief.${field} must be a non-empty string.`, undefined, 1);
  }
  const constraints = storyBrief.constraints;
  if (!Array.isArray(constraints) || constraints.length < 1 || constraints.length > 8 || constraints.some((constraint) => !nonEmptyString(constraint))) {
    add(diagnostics, 'error', 'invalid-story-brief-constraint', 'story_brief.constraints must contain 1 to 8 non-empty strings.', undefined, 1, 'List only non-negotiable business-content boundaries.');
  }
}

function validateContentPositioning(slide: Slide, diagnostics: Diagnostic[]): void {
  const positioning = slide.meta?.content_positioning;
  if (positioning === undefined) return;
  if (!isObject(positioning)) {
    add(diagnostics, 'error', 'invalid-content-positioning', 'content_positioning must be a YAML mapping.', slide, slide.sourceLine);
    return;
  }
  validateVisualAuthoringKeys(positioning, diagnostics, 'content_positioning', slide, slide.sourceLine);
  for (const key of Object.keys(positioning)) {
    if (!CONTENT_POSITIONING_KEYS.has(key)) add(diagnostics, 'error', 'invalid-content-positioning-field', `content_positioning contains unsupported field: ${key}.`, slide, slide.sourceLine, 'Use only the documented audience, story, relationship, proof, and detail fields.');
  }
  for (const field of ['audience_question', 'desired_outcome'] as const) {
    if (positioning[field] !== undefined && !nonEmptyString(positioning[field])) add(diagnostics, 'error', 'invalid-content-positioning-value', `content_positioning.${field} must be a non-empty string.`, slide, slide.sourceLine);
  }
  const enumFields: Array<[keyof typeof positioning, readonly string[]]> = [
    ['story_role', STORY_ROLES],
    ['relationship_model', RELATIONSHIP_MODELS],
    ['proof_requirement', PROOF_REQUIREMENTS],
    ['detail_level', DETAIL_LEVELS],
  ];
  for (const [field, values] of enumFields) {
    const value = positioning[field];
    if (value !== undefined && (typeof value !== 'string' || !values.includes(value))) {
      add(diagnostics, 'error', 'invalid-content-positioning-value', `content_positioning.${field} must be one of: ${values.join(', ')}.`, slide, slide.sourceLine);
    }
  }
}

function validateStructure(slide: Slide, diagnostics: Diagnostic[]): void {
  const structure = slide.meta?.structure;
  const content = slide.content ?? '';
  if (!structure) return;
  if (structure === 'table' && !hasMarkdownTable(content)) add(diagnostics, 'error', 'table-without-table', 'structure=table requires a Markdown table in **Content**.', slide, slide.blockLines.content, 'Add a Markdown table or change `structure` to a matching value.');
  if (structure === 'sequence' && !hasOrderedSequence(content)) add(diagnostics, 'error', 'sequence-without-order', 'structure=sequence requires an ordered list or explicit Phase/Step sections in **Content**.', slide, slide.blockLines.content, 'Use an ordered list under **Content**, or change `structure`.');
  if (structure === 'explore-converge-cycles') validateExploreConvergeCycles(slide, diagnostics);
  if (structure === 'primary-supporting-context') validatePrimarySupportingContext(slide, diagnostics);
  if (structure === 'chart' || structure === 'relationship-map') add(diagnostics, 'warning', 'structure-not-yet-renderable', `structure=${structure} is valid but not supported by the Web MVP.`, slide, slide.sourceLine);
  if (structure === 'grouped-items' && (content.match(/^###\s+/gm) ?? []).length > 4) add(diagnostics, 'warning', 'too-many-groups', 'grouped-items has more than four peer groups and may exceed a stable template.', slide, slide.blockLines.content, 'Split the slide or consolidate groups without losing business meaning.');
  if (structure === 'comparison' && (content.match(/^###\s+/gm) ?? []).length > 3) add(diagnostics, 'warning', 'too-many-comparison-items', 'comparison has more than three peer items; consider a table or split slide.', slide, slide.blockLines.content);
}

function validateSlide(slide: Slide, diagnostics: Diagnostic[], schema: string | undefined): void {
  const meta = slide.meta;
  if (slide.number === null) add(diagnostics, 'error', 'invalid-slide-number', 'Slide heading must use `## Slide N — Title`.', slide);
  if (!slide.title) add(diagnostics, 'error', 'missing-title', 'Slide title is required.', slide);
  if (!meta) return;
  validateVisualAuthoringKeys(meta, diagnostics, 'slide-meta', slide, slide.sourceLine);
  if (schema === DECK_SCHEMA_V2) validateContentPositioning(slide, diagnostics);
  if (!meta.id || typeof meta.id !== 'string') add(diagnostics, 'error', 'missing-slide-id', 'slide-meta requires a string `id`.', slide);
  if (!meta.kind || !KINDS.includes(meta.kind as (typeof KINDS)[number])) add(diagnostics, 'error', 'invalid-kind', `slide-meta kind must be one of: ${KINDS.join(', ')}.`, slide);

  if (meta.kind === 'content' || meta.kind === 'appendix') {
    if (meta.section !== undefined && (typeof meta.section !== 'string' || !meta.section.trim())) add(diagnostics, 'error', 'invalid-section', 'section is optional, but when declared it must be a non-empty string.', slide);
    if (!meta.structure || !STRUCTURES.includes(meta.structure as (typeof STRUCTURES)[number])) add(diagnostics, 'error', 'invalid-structure', `${meta.kind} slides require a supported structure.`, slide);
  }
  if (meta.kind === 'content') {
    if (!slide.keyMessage) add(diagnostics, 'error', 'missing-key-message', 'content slides require **Key Message**.', slide, slide.sourceLine, 'Add a one-sentence takeaway after slide-meta.');
    if (meta.structure === 'explore-converge-cycles') {
      if (slide.content) add(diagnostics, 'error', 'explore-converge-content-not-allowed', 'explore-converge-cycles uses its typed slide-meta payload as the complete visible semantic source and must not include **Content**.', slide, slide.blockLines.content, 'Move business meaning into the documented cycle and handoff fields, then remove **Content**.');
    } else if (meta.structure === 'primary-supporting-context') {
      if (slide.content) add(diagnostics, 'error', 'primary-supporting-context-content-not-allowed', 'primary-supporting-context uses its typed slide-meta payload as the complete visible semantic source and must not include **Content**.', slide, slide.blockLines.content, 'Move business meaning into primary_supporting_context, then remove **Content**.');
    } else if (!slide.content) {
      add(diagnostics, 'error', 'missing-content', 'content slides require **Content**.', slide, slide.sourceLine, 'Add visible supporting content after **Key Message**.');
    }
    if (slide.keyMessage && slide.title.toLowerCase() === slide.keyMessage.toLowerCase()) add(diagnostics, 'warning', 'duplicated-key-message', 'Key Message repeats the Title rather than explaining or qualifying it.', slide, slide.blockLines.keyMessage);
    if (isTopicLike(slide.title)) add(diagnostics, 'warning', 'topic-like-title', 'Title appears topic-based rather than conclusion-based.', slide, slide.sourceLine, 'State the page conclusion in the title where possible.');
  }

  if (slide.content) {
    if ((slide.content.match(/^\s{2,}[-*+]\s+/gm) ?? []).length > 6) add(diagnostics, 'warning', 'deep-bullet-nesting', 'Content has substantial nested bullet detail and may be difficult to render or scan.', slide, slide.blockLines.content);
    if (containsVisualInstruction(slide.content)) add(diagnostics, 'error', 'prohibited-deck-visual-authoring', 'Content contains visual implementation or geometry instructions.', slide, slide.blockLines.content, 'Keep only business content and semantic relationships in deck Markdown.');
    const markers = markerNumbers(`${slide.title}\n${slide.keyMessage ?? ''}\n${slide.content}`);
    if (markers.length > 0) {
      const entries = footnoteNumbers(slide.footnotes ?? '');
      for (const marker of markers) if (!entries.has(marker)) add(diagnostics, 'error', 'unmatched-footnote-marker', `Footnote marker ${marker} has no matching **Footnotes** entry.`, slide, slide.blockLines.content, 'Add a matching footnote entry or remove the marker.');
    }
  }
  if (slide.footnotes?.match(/Source to confirm|Working hypothesis|Client input/i)) add(diagnostics, 'warning', 'unverified-source-status', 'Footnotes include unverified source or hypothesis status.', slide, slide.blockLines.footnotes);

  const assets = meta.assets;
  if (Array.isArray(assets)) for (const asset of assets) {
    if (asset && typeof asset === 'object' && (asset as Record<string, unknown>).required === true) {
      const path = (asset as Record<string, unknown>).path;
      if (typeof path !== 'string' || !existsSync(path)) add(diagnostics, 'error', 'missing-required-asset', 'A required asset is missing or has no valid path.', slide, slide.sourceLine);
    }
  }
  validateStructure(slide, diagnostics);
}

export function validateDeck(deck: Deck): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  validateVisualAuthoringKeys(deck.meta, diagnostics, 'deck frontmatter', undefined, 1);
  if (!SUPPORTED_SCHEMAS.has(deck.meta.schema as typeof DECK_SCHEMA_V1 | typeof DECK_SCHEMA_V2)) {
    add(diagnostics, 'error', 'unsupported-schema', `Deck schema must be ${DECK_SCHEMA_V1} or ${DECK_SCHEMA_V2}.`, undefined, 1, `Set schema to ${DECK_SCHEMA_V1} or ${DECK_SCHEMA_V2} in deck frontmatter.`);
  }
  if (deck.meta.schema === DECK_SCHEMA_V2) validateStoryBrief(deck, diagnostics);
  if (deck.slides.length === 0) add(diagnostics, 'error', 'no-slides', 'Deck contains no slide headings.', undefined, 1);
  const ids = new Set<string>();
  const numbers = new Set<number>();
  for (const slide of deck.slides) {
    validateSlide(slide, diagnostics, deck.meta.schema);
    if (slide.number !== null) {
      if (numbers.has(slide.number)) add(diagnostics, 'error', 'duplicate-slide-number', `Slide number ${slide.number} is duplicated.`, slide);
      numbers.add(slide.number);
    }
    if (slide.meta?.id && typeof slide.meta.id === 'string') {
      if (ids.has(slide.meta.id)) add(diagnostics, 'error', 'duplicate-slide-id', `Slide ID ${slide.meta.id} is duplicated.`, slide);
      ids.add(slide.meta.id);
    }
  }
  return diagnostics;
}
