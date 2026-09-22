export const DECK_SCHEMA_V1 = 'slide-deck/v1' as const;
export const DECK_SCHEMA_V2 = 'slide-deck/v2' as const;
export type DeckSchema = typeof DECK_SCHEMA_V1 | typeof DECK_SCHEMA_V2;

export const KINDS = ['cover', 'divider', 'content', 'appendix'] as const;
export type SlideKind = (typeof KINDS)[number];

export const STRUCTURES = [
  'narrative',
  'grouped-items',
  'comparison',
  'sequence',
  'layers',
  'table',
  'chart',
  'relationship-map',
  'explore-converge-cycles',
  'primary-supporting-context',
] as const;
export type Structure = (typeof STRUCTURES)[number];

export interface ExploreConvergeCycle {
  id: string;
  label: string;
  emphasis: 'focal' | 'standard';
  inputs: string[];
  exploration_scope: string[];
  convergence_outputs: string[];
}

export interface ExploreConvergeHandoff {
  id: string;
  label: string;
  from_cycle_id: string;
  to_cycle_id: string;
}

export interface ExploreConvergeCyclesPayload {
  cycles: ExploreConvergeCycle[];
  handoff: ExploreConvergeHandoff;
}

export type PrimarySupportingMaterialStatus = 'asset' | 'placeholder';
export type PrimarySupportingRelation = 'illustration' | 'example' | 'evidence' | 'action' | 'reference';

export interface PrimarySupportingMaterial {
  status: PrimarySupportingMaterialStatus;
  asset_id?: string;
}

export interface PrimarySupportingPrimary {
  id: string;
  /** Optional reader-facing kicker; omit it when it only repeats the slide title. */
  label?: string;
  statement: string;
  self_sufficient: true;
}

export interface PrimarySupportingContext {
  id: string;
  label: string;
  statement: string;
  supports_primary_id: string;
  support_relation: PrimarySupportingRelation;
  material: PrimarySupportingMaterial;
}

export interface PrimarySupportingContinuity {
  id: string;
  label: string;
  from_supporting_context_id: string;
  to_supporting_context_id: string;
}

export type PrimarySupportingGroupsRelation = 'parallel' | 'sequence';

export interface PrimarySupportingPrimaryGroup {
  id: string;
  label: string;
  items: string[];
}

export interface PrimarySupportingCallout {
  id: string;
  label: string;
  /** Optional attributed/quoted voice, distinct from the supporting explanation. */
  quote?: string;
  statement: string;
}

export interface PrimarySupportingContextPayload {
  primary: PrimarySupportingPrimary;
  supporting_contexts: PrimarySupportingContext[];
  continuity?: PrimarySupportingContinuity;
  primary_groups?: PrimarySupportingPrimaryGroup[];
  /** Optional semantic relation of the ordered group array; absent is not a sequence claim. */
  primary_groups_relation?: PrimarySupportingGroupsRelation;
  callout?: PrimarySupportingCallout;
}

export type Severity = 'error' | 'warning' | 'note';

export interface SourceLocation {
  line: number;
  column?: number;
}

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  suggestion?: string;
  slideId?: string;
  location?: SourceLocation;
}

export const STORY_ROLES = ['orient', 'frame', 'explain', 'compare', 'recommend', 'decide', 'commit', 'reference'] as const;
export type StoryRole = (typeof STORY_ROLES)[number];

export const RELATIONSHIP_MODELS = [
  'single-idea',
  'grouping',
  'comparison',
  'sequence',
  'layers',
  'tabular-reference',
  'decision-gate',
  'handoff',
  'explore-converge-cycles',
  'primary-supporting-context',
] as const;
export type RelationshipModel = (typeof RELATIONSHIP_MODELS)[number];

export const PROOF_REQUIREMENTS = [
  'none',
  'illustrative-example',
  'source-cited',
  'hypothesis-labelled',
  'validate-before-decision',
  'decision-evidence',
] as const;
export type ProofRequirement = (typeof PROOF_REQUIREMENTS)[number];

export const DETAIL_LEVELS = ['headline', 'executive', 'working', 'reference'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export interface StoryBrief {
  audience_outcome: string;
  decision_or_action: string;
  narrative: string;
  constraints: string[];
}

export interface ContentPositioning {
  audience_question?: string;
  desired_outcome?: string;
  story_role?: StoryRole;
  relationship_model?: RelationshipModel;
  proof_requirement?: ProofRequirement;
  detail_level?: DetailLevel;
}

/**
 * Platform-owned bounded content decomposition types. These are an internal
 * normalized vocabulary in the v1/v2 compatibility period; they do not add a
 * new Deck authoring field yet.
 */
export type ContentPattern =
  | 'single-argument'
  | 'peer-groups'
  | 'comparison'
  | 'ordered-stages'
  | 'layered-model'
  | 'tabular-reference'
  | 'quantitative-evidence'
  | 'connected-system'
  | 'explore-converge'
  | 'primary-supporting';

/** Optional reader/business interpretation of a bounded Content Pattern. */
export type RelationshipIntent =
  | 'explain'
  | 'group'
  | 'compare'
  | 'sequence'
  | 'hierarchy'
  | 'reference'
  | 'decision-gate'
  | 'handoff'
  | 'explore-converge'
  | 'supports';

export interface NormalizedSlideSemantics {
  readonly slide: Slide;
  readonly contentPattern?: ContentPattern;
  readonly relationshipIntent?: RelationshipIntent;
  readonly provenance: {
    readonly sourceSchema: 'legacy-v1-v2';
    readonly patternSource: 'legacy-structure' | 'absent';
    readonly intentSource: 'legacy-relationship-model' | 'pattern-default' | 'absent';
  };
}

/**
 * Internal, non-serialized projection of a parsed Deck into the platform's
 * Slide Semantic Model. The current parse command continues to emit Deck.
 */
export interface NormalizedContentModel {
  readonly schema: 'slide-content-model/v1';
  readonly deck: Deck;
  readonly slides: readonly NormalizedSlideSemantics[];
}

export interface DeckMeta {
  schema?: string;
  title?: string;
  audience?: string;
  language?: string;
  purpose?: string;
  source_status?: string;
  story_brief?: StoryBrief;
  [key: string]: unknown;
}

export interface SlideMeta {
  id?: string;
  kind?: string;
  section?: string;
  structure?: string;
  assets?: unknown[];
  explore_converge_cycles?: ExploreConvergeCyclesPayload;
  primary_supporting_context?: PrimarySupportingContextPayload;
  content_positioning?: ContentPositioning;
  [key: string]: unknown;
}

export interface Slide {
  number: number | null;
  title: string;
  meta: SlideMeta | null;
  subtitle?: string;
  context?: string;
  keyMessage?: string;
  content?: string;
  speakerNotes?: string;
  footnotes?: string;
  sourceLine: number;
  blockLines: Partial<Record<'subtitle' | 'context' | 'keyMessage' | 'content' | 'speakerNotes' | 'footnotes', number>>;
}

export interface Deck {
  meta: DeckMeta;
  slides: Slide[];
  sourcePath?: string;
}

export interface ParseResult {
  deck: Deck;
  diagnostics: Diagnostic[];
}

export type ContentPreflightStage = 'content-preflight';
export type ContentPreflightOwner = 'content';

export interface ContentPreflightIssue extends Diagnostic {
  stage: ContentPreflightStage;
  owner: ContentPreflightOwner;
}

export interface ContentPreflightReport {
  schema: 'slide-content-preflight/v1';
  deck: {
    sourcePath: string;
    sourceSha256: string;
    deckSchema?: string;
    title?: string;
  };
  summary: {
    errors: number;
    warnings: number;
    notes: number;
  };
  issues: Array<Diagnostic | ContentPreflightIssue>;
}

export type RenderIssueStage = 'configuration' | 'preflight' | 'render' | 'qa';
export type RenderIssueOwner = 'content' | 'configuration' | 'theme' | 'renderer' | 'asset';

export interface RenderIssue extends Diagnostic {
  stage: RenderIssueStage;
  owner: RenderIssueOwner;
}

export type RenderTarget = 'web' | 'pptx';

export interface RenderOutputPolicy {
  directory: string;
  html: boolean;
  pdf: boolean;
  png: boolean;
  pptx: boolean;
}

export interface RenderQaPolicy {
  failOnOverflow: boolean;
  failOnMissingAsset: boolean;
}

export interface ResolvedProfile {
  name: string;
  sourcePath: string;
  densityMode: 'standard' | 'compact';
  footerPolicy: 'standard' | 'minimal' | 'hidden';
  assetPolicy: 'strict' | 'allow-placeholder';
  qa: RenderQaPolicy;
}

/** Provider-owned Theme options. Core preserves these values but never interprets them. */
export type ThemeOptions = Readonly<Record<string, unknown>>;

export interface ThemeTemplateMapping {
  cover?: string;
  divider?: string;
  structures: Record<string, string>;
}

export interface PptxThemeDescriptor {
  renderer: string;
  tokensPath: string;
  supportedStructures: string[];
  templates: ThemeTemplateMapping;
}

export interface ThemeManifest {
  name: string;
  version: number;
  defaultProfile: string;
  sourcePath: string;
  renderer: string;
  tokensPath: string;
  assetsPath?: string;
  supportedStructures: string[];
  templates: ThemeTemplateMapping;
  pptx?: PptxThemeDescriptor;
}

export interface ResolvedRenderConfig {
  sourcePath: string;
  theme: ThemeManifest;
  profile: ResolvedProfile;
  /** Resolved and interpreted by the selected Theme provider. */
  themeOptions?: ThemeOptions;
  output: RenderOutputPolicy;
  qa: RenderQaPolicy;
}

export interface RenderPlanSlide {
  slideId: string;
  number: number;
  kind: SlideKind;
  structure?: Structure;
  template?: string;
  renderable: boolean;
  requiredAssets: string[];
}

export interface RenderPlan {
  deck: {
    title?: string;
    sourcePath?: string;
  };
  theme: {
    name: string;
    renderer: string;
    profile: string;
    densityMode: ResolvedProfile['densityMode'];
    footerPolicy: ResolvedProfile['footerPolicy'];
    assetPolicy: ResolvedProfile['assetPolicy'];
    /** Provider-owned resolved options, persisted opaquely for the selected Theme. */
    themeOptions?: ThemeOptions;
  };
  slides: RenderPlanSlide[];
  output: RenderOutputPolicy;
  qa: RenderQaPolicy;
}
