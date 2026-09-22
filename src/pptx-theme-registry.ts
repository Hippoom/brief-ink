import { rendererCapability } from './renderer-capabilities.js';
import { inspectPptxPackage, type PptxPackageInspection } from './pptx-package.js';
import { renderBriefInkPptxV1 } from './renderers/brief-ink-pptx-v1.js';
import { pptxTargetRuntime, type PptxTargetRuntime } from './targets/pptx/runtime.js';
import {
  ThemeRegistry,
  type ThemeAdapter,
  type ThemePreparation,
  type ThemeProvider,
} from './theme-provider.js';
import { selectThemeProvider, themeProviderSelectionFor } from './theme-provider-registry.js';
import type { Deck, RenderIssue, RenderPlan, ResolvedRenderConfig } from './types.js';

export interface PptxRenderContext {
  readonly deck: Deck;
  readonly plan: RenderPlan;
  readonly config: ResolvedRenderConfig;
  /** Host-selected, Theme-neutral target services injected for adapter use. */
  readonly runtime: PptxTargetRuntime;
  /** Present only for adapter verification after generic package inspection. */
  readonly inspection?: PptxPackageInspection;
}

export interface PptxThemePreparationContext {
  readonly deck: Deck;
  readonly config: ResolvedRenderConfig;
}

export interface PptxThemeVerificationContext extends PptxRenderContext {
  readonly inspection: PptxPackageInspection;
}

export interface PreparedPptxTheme {
  readonly adapter?: PptxThemeAdapter;
  readonly runtimeState?: unknown;
  readonly templateIds?: ReadonlySet<string>;
  readonly issues: readonly RenderIssue[];
}

export type PptxThemeAdapter = ThemeAdapter<PptxRenderContext, Uint8Array, unknown, RenderIssue, PptxThemePreparationContext>;

function maintainedPptxAdapter(id: string): PptxThemeAdapter {
  const capability = rendererCapability(id);
  if (!capability) throw new Error(`Missing renderer capability for PPTX adapter ${id}.`);
  return {
    id,
    target: 'pptx',
    templateIds: capability.templates,
    preflight: ({ deck }) => ({ issues: preflightBriefInkPptxV1(deck) }),
    render: (context) => renderBriefInkPptxV1(context),
    verify: verifyBriefInkPptxV1,
  };
}

const maintainedPptxProvider: ThemeProvider = {
  id: 'maintained-pptx-renderers',
  themes: [{
    id: 'brief-ink',
    version: 1,
    adapters: [maintainedPptxAdapter('brief-ink-pptx-v1')],
  }],
};

export function createPptxThemeRegistry(): ThemeRegistry {
  return createPptxThemeRegistryForProviders([maintainedPptxProvider]);
}

/** Public maintained adapters remain available for direct dispatch compatibility. */
export const pptxThemeRegistry = createPptxThemeRegistry();

/** Resolves and prepares the selected PPTX Theme before generic plan construction. */
export async function preparePptxTheme(deck: Deck, config: ResolvedRenderConfig): Promise<PreparedPptxTheme> {
  const selectedPublicTheme = pptxThemeRegistry.resolveTheme(config.theme.name) !== undefined;
  const invocationSelection = themeProviderSelectionFor(config);
  const selected = invocationSelection ? { selection: invocationSelection } : await selectThemeProvider(config.theme.name);
  let registry = pptxThemeRegistry;
  if (selected.selection) {
    if (selectedPublicTheme) return { issues: [privateProviderInvalidIssue(new Error('A public Theme cannot be shadowed by a selected provider.'))] };
    try {
      registry = createPptxThemeRegistryForProviders([maintainedPptxProvider, selected.selection.provider]);
    } catch (error) {
      return { issues: [privateProviderInvalidIssue(error)] };
    }
  } else if (!selectedPublicTheme) {
    return { issues: [privateProviderLoadIssue(selected.error)] };
  }

  const adapter = registry.resolveAdapter(config.theme.name, 'pptx') as PptxThemeAdapter | undefined;
  if (!adapter || adapter.id !== config.theme.pptx?.renderer) {
    return {
      issues: [{
        severity: 'error', stage: 'preflight', owner: 'theme', code: 'unregistered-theme-adapter',
        message: `No PPTX Theme adapter is registered for declared renderer ${config.theme.pptx?.renderer ?? '(none)'}.`,
        suggestion: 'Register an explicit PPTX adapter for the selected Theme; do not select a fallback renderer.',
      }],
    };
  }
  const context: PptxThemePreparationContext = { deck, config };
  const preflight = await adapter.preflight?.(context);
  const prepared: ThemePreparation<unknown, RenderIssue> | undefined = await adapter.prepare?.(context);
  return { adapter, runtimeState: prepared?.runtimeState, templateIds: adapter.templateIds, issues: [...(preflight?.issues ?? []), ...(prepared?.issues ?? [])] };
}

/** Render through the prepared adapter; core does not branch on renderer identity. */
export async function renderPreparedPptxTheme(prepared: PreparedPptxTheme, context: Omit<PptxRenderContext, 'runtime'>): Promise<Uint8Array> {
  const adapter = prepared.adapter;
  if (!adapter || adapter.id !== context.plan.theme.renderer || adapter.id !== context.config.theme.pptx?.renderer) {
    throw new Error(`No PPTX renderer is implemented for declared renderer ${context.config.theme.pptx?.renderer ?? '(none)'}.`);
  }
  return await adapter.render({ ...context, runtime: pptxTargetRuntime }, prepared.runtimeState);
}

/** Verify adapter-owned policy after generic package inspection. */
export async function verifyPreparedPptxTheme(prepared: PreparedPptxTheme, context: Omit<PptxThemeVerificationContext, 'runtime'>, bytes: Uint8Array): Promise<readonly RenderIssue[]> {
  if (!prepared.adapter) return [{
    severity: 'error', stage: 'qa', owner: 'theme', code: 'unregistered-theme-adapter',
    message: `No prepared PPTX Theme adapter is available for ${context.config.theme.name}.`,
    suggestion: 'Resolve and prepare an explicit PPTX adapter before rendering.',
  }];
  return await prepared.adapter.verify?.({ ...context, runtime: pptxTargetRuntime }, bytes) ?? [];
}

function createPptxThemeRegistryForProviders(providers: readonly ThemeProvider[]): ThemeRegistry {
  assertUniquePptxAdapterIds(providers);
  const registry = new ThemeRegistry();
  for (const provider of providers) registry.register(pptxOnlyProvider(provider));
  return registry;
}

function pptxOnlyProvider(provider: ThemeProvider): ThemeProvider {
  return {
    id: provider.id,
    themes: provider.themes.flatMap((theme) => {
      const adapters = theme.adapters.filter((adapter) => adapter.target === 'pptx');
      return adapters.length === 0 ? [] : [{ ...theme, adapters }];
    }),
  };
}

function assertUniquePptxAdapterIds(providers: readonly ThemeProvider[]): void {
  const owners = new Map<string, string>();
  for (const provider of providers) for (const theme of provider.themes) for (const adapter of theme.adapters) {
    if (adapter.target !== 'pptx') continue;
    const owner = owners.get(adapter.id);
    if (owner) throw new Error(`PPTX Theme adapter "${adapter.id}" is registered by both ${owner} and ${provider.id}/${theme.id}.`);
    owners.set(adapter.id, `${provider.id}/${theme.id}`);
  }
}

function privateProviderLoadIssue(error: { readonly code: string; readonly message: string } | undefined): RenderIssue {
  return {
    severity: 'error', stage: 'preflight', owner: 'theme', code: error?.code ?? 'theme-provider-unavailable',
    message: error?.message ?? 'No explicit Theme provider is available for the selected Theme.',
    suggestion: 'Configure a valid private Theme provider for the selected non-public PPTX Theme; do not select a fallback renderer.',
  };
}

function privateProviderInvalidIssue(error: unknown): RenderIssue {
  return {
    severity: 'error', stage: 'preflight', owner: 'theme', code: 'private-theme-provider-invalid',
    message: error instanceof Error ? error.message : String(error),
    suggestion: 'Fix the private Theme provider registration; duplicate Theme and PPTX adapter identities are not allowed.',
  };
}

function qaIssue(code: string, message: string, suggestion: string): RenderIssue {
  return { severity: 'error', stage: 'qa', owner: 'renderer', code, message, suggestion };
}

function preflightIssue(slide: Deck['slides'][number], code: string, message: string, suggestion: string): RenderIssue {
  return { severity: 'error', stage: 'preflight', owner: 'theme', code, message, suggestion, slideId: typeof slide.meta?.id === 'string' ? slide.meta.id : undefined, location: { line: slide.sourceLine } };
}

function hasUnsupportedPptxBodyBlock(slide: Deck['slides'][number]): boolean {
  const comparison = slide.meta?.structure === 'comparison';
  return (slide.content ?? '').replace(/\r\n/g, '\n').split('\n').some((line) => {
    if (!line.trim()) return false;
    if (comparison && /^###\s+\S.+$/.test(line)) return false;
    return /^#{1,6}\s+|^>\s?|^\||^\s{2,}[-*+]\s+|^\s{2,}\d+[.)]\s+/.test(line);
  });
}

function preflightBriefInkPptxV1(deck: Deck): RenderIssue[] {
  const issues: RenderIssue[] = [];
  for (const slide of deck.slides) {
    const assets = Array.isArray(slide.meta?.assets)
      ? slide.meta.assets.filter((asset): asset is { required: boolean; path: string } => Boolean(asset) && typeof asset === 'object' && (asset as { required?: unknown }).required === true && typeof (asset as { path?: unknown }).path === 'string')
      : [];
    if (assets.length > 0) issues.push(preflightIssue(slide, 'pptx-assets-not-supported', 'The maintained Brief Ink PPTX adapter does not support declared slide assets.', 'Remove the declared asset only if it is not decision-relevant, or use a target adapter that declares asset support.'));
    if (hasUnsupportedPptxBodyBlock(slide)) issues.push(preflightIssue(slide, 'pptx-unsupported-body-block', 'The maintained Brief Ink PPTX adapter supports flat paragraphs and top-level lists only; comparison permits only its two ### group headings.', 'Use a maintained adapter that supports this body grammar without changing business content.'));
    if (slide.meta?.structure === 'comparison' && ((slide.content ?? '').match(/^###\s+\S.+$/gm)?.length ?? 0) !== 2) issues.push(preflightIssue(slide, 'pptx-comparison-requires-two-groups', 'The maintained Brief Ink PPTX comparison template requires exactly two level-three heading groups.', 'Use exactly two ### headings, or select a maintained adapter that supports the structure.'));
  }
  return issues;
}

function expectedText(deck: Deck, index: number): string[] {
  const slide = deck.slides[index];
  return [slide.title, slide.subtitle, slide.context, slide.keyMessage, slide.content, slide.footnotes]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => value.split('\n'))
    .map((value) => value.replace(/^#{1,6}\s+|^[-*+]\s+|^\d+[.)]\s+/, ''))
    .map((value) => value.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

async function verifyBriefInkPptxV1(context: PptxThemeVerificationContext, _bytes: Uint8Array): Promise<readonly RenderIssue[]> {
  const { inspection, deck, plan } = context;
  if (!inspection) return [qaIssue('pptx-inspection-missing', 'PPTX adapter verification requires the generic package inspection result.', 'Inspect the generated package before adapter verification.')];
  const issues: RenderIssue[] = [];
  if (inspection.slideCount !== plan.slides.length) issues.push(qaIssue('pptx-slide-count-mismatch', `PPTX package has ${inspection.slideCount} slide parts but Render Plan has ${plan.slides.length} slides.`, 'Fix native slide generation before writing the artifact.'));
  if (inspection.parts.media.length > 0 && inspection.slides.some((slide) => slide.imageRelationship)) issues.push(qaIssue('pptx-raster-media-prohibited', 'PPTX package contains image media referenced by a slide; the editable POC permits native text and shapes only.', 'Remove image-based slide content from the native renderer.'));
  for (const slide of inspection.slides) {
    if (slide.hasRasterPicture) issues.push(qaIssue('pptx-raster-slide-body-prohibited', `Slide ${slide.index + 1} contains a picture shape.`, 'Use native text and shapes only for this POC.'));
    const slideText = slide.drawingMlText.join(' ').replace(/\s+/g, ' ').trim();
    const missing = expectedText(deck, slide.index).filter((value) => !slideText.includes(value));
    if (missing.length > 0) issues.push(qaIssue('pptx-editable-text-missing', `Slide ${slide.index + 1} is missing native DrawingML text: ${missing.join(' | ')}.`, 'Keep all supported business text in native PPTX text boxes.'));
  }
  return issues;
}

/** Kept importable to make generic inspection use explicit at adapter boundaries. */
export { inspectPptxPackage };
