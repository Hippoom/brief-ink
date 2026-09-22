import type { Deck, RenderIssue, RenderPlan, RenderTarget, ResolvedRenderConfig, Slide, Structure, ThemeManifest } from './types.js';

/** Provider-owned preparation issues and template ownership used during planning. */
export interface PreparedThemeState {
  readonly issues?: readonly RenderIssue[];
  /** Closed template namespace supplied by the selected target adapter. */
  readonly templateIds?: ReadonlySet<string>;
}

function requiredAssets(slide: Slide): string[] {
  const assets = slide.meta?.assets;
  if (!Array.isArray(assets)) return [];
  return assets.flatMap((asset) => {
    if (!asset || typeof asset !== 'object') return [];
    const candidate = asset as Record<string, unknown>;
    return candidate.required === true && typeof candidate.path === 'string' ? [candidate.path] : [];
  });
}

function preflightIssue(issues: RenderIssue[], slide: Slide, code: string, message: string, suggestion: string): void {
  issues.push({
    severity: 'error',
    stage: 'preflight',
    owner: 'theme',
    code,
    message,
    suggestion,
    slideId: typeof slide.meta?.id === 'string' ? slide.meta.id : undefined,
    location: { line: slide.sourceLine },
  });
}

function hasUnsupportedPptxBodyBlock(slide: Slide): boolean {
  const comparison = slide.meta?.structure === 'comparison';
  return (slide.content ?? '').replace(/\r\n/g, '\n').split('\n').some((line) => {
    if (!line.trim()) return false;
    if (comparison && /^###\s+\S.+$/.test(line)) return false;
    return /^#{1,6}\s+|^>\s?|^\||^\s{2,}[-*+]\s+|^\s{2,}\d+[.)]\s+/.test(line);
  });
}

export interface BuildRenderPlanResult {
  plan: RenderPlan;
  issues: RenderIssue[];
}

export function buildRenderPlan(
  deck: Deck,
  config: ResolvedRenderConfig,
  target: RenderTarget = 'web',
  preparedTheme: PreparedThemeState = {},
): BuildRenderPlanResult {
  const issues: RenderIssue[] = [...(preparedTheme.issues ?? [])];
  const targetTheme: Pick<ThemeManifest, 'renderer' | 'supportedStructures' | 'templates'> | undefined = target === 'web'
    ? config.theme
    : config.theme.pptx;
  if (!targetTheme) {
    issues.push({
      severity: 'error', stage: 'preflight', owner: 'theme', code: 'unsupported-render-target',
      message: `${config.theme.name} has no maintained ${target.toUpperCase()} renderer.`,
      suggestion: `Select a Theme with an explicit ${target.toUpperCase()} manifest mapping; do not substitute another Theme.`,
    });
  }
  const slides = deck.slides.map((slide) => {
    const kind = slide.meta?.kind;
    const structure = slide.meta?.structure;
    const assets = requiredAssets(slide);
    let template: string | undefined;
    if (targetTheme) {
      if (kind === 'cover') template = targetTheme.templates.cover;
      else if (kind === 'divider') template = targetTheme.templates.divider;
      else if (typeof structure === 'string') {
        if (!targetTheme.supportedStructures.includes(structure)) {
          preflightIssue(issues, slide, 'unsupported-structure', `${config.theme.name} ${target.toUpperCase()} does not support structure: ${structure}.`, 'Use a supported semantic structure only if it preserves meaning, or add a maintained theme template.');
        } else {
          template = targetTheme.templates.structures[structure];
        }
      }
      if (!template) {
        if (kind === 'cover' || kind === 'divider') preflightIssue(issues, slide, 'missing-template-mapping', `${config.theme.name} has no maintained ${target.toUpperCase()} template mapping for kind: ${String(kind)}.`, 'Add the mapping to the theme manifest; do not add a one-off slide override.');
        else if (structure && targetTheme.supportedStructures.includes(structure)) preflightIssue(issues, slide, 'missing-template-mapping', `${config.theme.name} ${target.toUpperCase()} supports structure ${structure} but has no template mapping.`, 'Add the mapping to the theme manifest; do not substitute a closest template.');
      }
    }
    if (template && preparedTheme.templateIds && !preparedTheme.templateIds.has(template)) {
      preflightIssue(issues, slide, 'unregistered-theme-template', `The selected ${target.toUpperCase()} Theme adapter does not own planned template ${template}.`, 'Register the template on the selected adapter; do not substitute another adapter or template.');
      template = undefined;
    }
    return {
      slideId: typeof slide.meta?.id === 'string' ? slide.meta.id : '',
      number: slide.number ?? 0,
      kind: (kind ?? 'content') as RenderPlan['slides'][number]['kind'],
      structure: structure as Structure | undefined,
      template,
      renderable: Boolean(template),
      requiredAssets: assets,
    };
  });
  return {
    plan: {
      deck: { title: deck.meta.title, sourcePath: deck.sourcePath },
      theme: {
        name: config.theme.name,
        renderer: targetTheme?.renderer ?? '',
        profile: config.profile.name,
        densityMode: config.profile.densityMode,
        footerPolicy: config.profile.footerPolicy,
        assetPolicy: config.profile.assetPolicy,
        themeOptions: config.themeOptions,
      },
      slides,
      output: config.output,
      qa: config.qa,
    },
    issues,
  };
}
