import { rendererCapability } from './renderer-capabilities.js';
import { renderBriefInkHtmlV1 } from './renderers/brief-ink-html-v1.js';
import {
  ThemeRegistry,
  type ThemeAdapter,
  type ThemePreparation,
  type ThemeProvider,
} from './theme-provider.js';
import { selectThemeProvider, themeProviderSelectionFor } from './theme-provider-registry.js';
import type { Deck, RenderIssue, RenderPlan, ResolvedRenderConfig } from './types.js';

export interface HtmlRenderContext {
  readonly deck: Deck;
  readonly plan: RenderPlan;
  readonly config: ResolvedRenderConfig;
}

export interface HtmlThemePreparationContext {
  readonly deck: Deck;
  readonly config: ResolvedRenderConfig;
}

export interface PreparedHtmlTheme {
  readonly adapter?: HtmlThemeAdapter;
  readonly runtimeState?: unknown;
  readonly templateIds?: ReadonlySet<string>;
  readonly issues: readonly RenderIssue[];
}

export type HtmlThemeAdapter = ThemeAdapter<HtmlRenderContext, string, unknown, RenderIssue, HtmlThemePreparationContext>;

function maintainedHtmlAdapter(
  id: string,
  render: (context: HtmlRenderContext) => string,
): HtmlThemeAdapter {
  const capability = rendererCapability(id);
  if (!capability) throw new Error(`Missing renderer capability for HTML adapter ${id}.`);

  return {
    id,
    target: 'web',
    templateIds: capability.templates,
    render,
  };
}

const maintainedHtmlProvider: ThemeProvider = {
  id: 'maintained-html-renderers',
  themes: [
    {
      id: 'brief-ink',
      version: 1,
      adapters: [
        maintainedHtmlAdapter('brief-ink-html-v1', ({ deck, plan, config }) => renderBriefInkHtmlV1(deck, plan, config)),
      ],
    },
  ],
};

export function createHtmlThemeRegistry(): ThemeRegistry {
  return createHtmlThemeRegistryForProviders([maintainedHtmlProvider]);
}

/** Public maintained adapters remain available for direct dispatch compatibility. */
export const htmlThemeRegistry = createHtmlThemeRegistry();

/** Resolves and prepares the selected Web Theme before generic plan construction. */
export async function prepareHtmlTheme(deck: Deck, config: ResolvedRenderConfig): Promise<PreparedHtmlTheme> {
  const selectedPublicTheme = htmlThemeRegistry.resolveTheme(config.theme.name) !== undefined;
  const invocationSelection = themeProviderSelectionFor(config);
  const selected = invocationSelection ? { selection: invocationSelection } : await selectThemeProvider(config.theme.name);

  let registry = htmlThemeRegistry;
  if (selected.selection) {
    if (selectedPublicTheme) return { issues: [privateProviderInvalidIssue(new Error('A public Theme cannot be shadowed by a selected provider.'))] };
    try {
      registry = createHtmlThemeRegistryForProviders([maintainedHtmlProvider, selected.selection.provider]);
    } catch (error) {
      return { issues: [privateProviderInvalidIssue(error)] };
    }
  } else if (!selectedPublicTheme) {
    return { issues: [privateProviderLoadIssue(selected.error)] };
  }

  const adapter = registry.resolveAdapter(config.theme.name, 'web') as HtmlThemeAdapter | undefined;
  if (!adapter || adapter.id !== config.theme.renderer) {
    return {
      issues: [{
        severity: 'error', stage: 'preflight', owner: 'theme', code: 'unregistered-theme-adapter',
        message: `No Web Theme adapter is registered for declared renderer ${config.theme.renderer}.`,
        suggestion: 'Register an explicit adapter for the selected Theme; do not select a fallback renderer.',
      }],
    };
  }
  const context: HtmlThemePreparationContext = { deck, config };
  const preflight = await adapter.preflight?.(context);
  const prepared: ThemePreparation<unknown, RenderIssue> | undefined = await adapter.prepare?.(context);
  return {
    adapter,
    runtimeState: prepared?.runtimeState,
    templateIds: adapter.templateIds,
    issues: [...(preflight?.issues ?? []), ...(prepared?.issues ?? [])],
  };
}

function createHtmlThemeRegistryForProviders(providers: readonly ThemeProvider[]): ThemeRegistry {
  assertUniqueHtmlAdapterIds(providers);
  const registry = new ThemeRegistry();
  for (const provider of providers) registry.register(webOnlyProvider(provider));
  return registry;
}

function webOnlyProvider(provider: ThemeProvider): ThemeProvider {
  return {
    id: provider.id,
    themes: provider.themes.flatMap((theme) => {
      const adapters = theme.adapters.filter((adapter) => adapter.target === 'web');
      return adapters.length === 0 ? [] : [{ ...theme, adapters }];
    }),
  };
}

function assertUniqueHtmlAdapterIds(providers: readonly ThemeProvider[]): void {
  const owners = new Map<string, string>();
  for (const provider of providers) {
    for (const theme of provider.themes) {
      for (const adapter of theme.adapters) {
        if (adapter.target !== 'web') continue;
        const owner = owners.get(adapter.id);
        if (owner) throw new Error(`Web Theme adapter "${adapter.id}" is registered by both ${owner} and ${provider.id}/${theme.id}.`);
        owners.set(adapter.id, `${provider.id}/${theme.id}`);
      }
    }
  }
}

function privateProviderLoadIssue(error: { readonly code: string; readonly message: string } | undefined): RenderIssue {
  return {
    severity: 'error', stage: 'preflight', owner: 'theme', code: error?.code ?? 'theme-provider-unavailable',
    message: error?.message ?? 'No explicit Theme provider is available for the selected Theme.',
    suggestion: 'Configure a valid private Theme provider for the selected non-public Theme; do not select a fallback renderer.',
  };
}

function privateProviderInvalidIssue(error: unknown): RenderIssue {
  return {
    severity: 'error', stage: 'preflight', owner: 'theme', code: 'private-theme-provider-invalid',
    message: error instanceof Error ? error.message : String(error),
    suggestion: 'Fix the private Theme provider registration; duplicate Theme and Web adapter identities are not allowed.',
  };
}
