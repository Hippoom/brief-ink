import { realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RenderIssue, ResolvedProfile, ThemeManifest, ThemeOptions } from './types.js';

/** The only environment variable accepted for an operator-provided private Theme root. */
export const PRIVATE_THEME_ROOT_ENV = 'SLIDE_PRIVATE_THEME_ROOT';

export type ThemeTarget = 'web' | 'pptx';

export interface ThemePreflightResult<Issue = unknown> {
  issues: readonly Issue[];
}

/**
 * Opaque provider preparation result. `runtimeState` remains in-process and
 * provider-owned; preparation data is never persisted into a Render Plan.
 */
export interface ThemePreparation<RuntimeState = unknown, Issue = unknown> extends ThemePreflightResult<Issue> {
  runtimeState?: RuntimeState;
}

/**
 * A target-specific Theme implementation. Runtime state and artifacts are
 * deliberately generic so the platform does not need to know Theme details.
 */
export interface ThemeAdapter<
  RenderContext = unknown,
  Artifact = unknown,
  RuntimeState = unknown,
  Issue = unknown,
  PreparationContext = RenderContext,
> {
  readonly id: string;
  readonly target: ThemeTarget;
  readonly templateIds: ReadonlySet<string>;
  preflight?(context: PreparationContext): ThemePreflightResult<Issue> | Promise<ThemePreflightResult<Issue>>;
  prepare?(context: PreparationContext): ThemePreparation<RuntimeState, Issue> | Promise<ThemePreparation<RuntimeState, Issue>>;
  render(context: RenderContext, runtimeState?: RuntimeState): Artifact | Promise<Artifact>;
  verify?(context: RenderContext, artifact: Artifact): readonly Issue[] | Promise<readonly Issue[]>;
}

export interface ThemeDefinition {
  readonly id: string;
  readonly version: string | number;
  readonly adapters: readonly ThemeAdapter[];
}

/**
 * Theme configuration belongs to its provider. Core passes raw YAML values and
 * accepts only a generic manifest/profile/options result plus structured issues.
 */
export interface ThemeConfigurationContext {
  readonly themeId: string;
  readonly configPath: string;
  readonly configDirectory: string;
  readonly rawProfile: unknown;
  readonly rawThemeOptions: unknown;
}

export interface ThemeConfigurationResolution {
  readonly manifest: ThemeManifest;
  readonly profile: ResolvedProfile;
  readonly options?: ThemeOptions;
  readonly issues?: readonly RenderIssue[];
}

export interface ThemeConfigurationProvider {
  resolveConfiguration?(context: ThemeConfigurationContext): ThemeConfigurationResolution | Promise<ThemeConfigurationResolution>;
}

/** A provider may expose public or operator-configured private Themes. */
export interface ThemeProvider extends ThemeConfigurationProvider {
  readonly id: string;
  readonly themes: readonly ThemeDefinition[];
}

export interface RegisteredTheme {
  readonly provider: ThemeProvider;
  readonly definition: ThemeDefinition;
}

/**
 * Keeps Theme identities and adapter template namespaces unambiguous.
 * It intentionally performs no discovery: providers must be registered by the
 * caller, which prevents a missing private root from falling back to a Theme.
 */
export class ThemeRegistry {
  private readonly providers = new Map<string, ThemeProvider>();
  private readonly themes = new Map<string, RegisteredTheme>();

  register(provider: ThemeProvider): void {
    assertNonEmpty(provider.id, 'Theme provider id');
    if (this.providers.has(provider.id)) {
      throw new Error(`Theme provider "${provider.id}" is already registered.`);
    }

    const pendingThemes: Array<[string, RegisteredTheme]> = [];
    const themeIds = new Set<string>();
    for (const definition of provider.themes) {
      assertNonEmpty(definition.id, 'Theme id');
      if (themeIds.has(definition.id)) {
        throw new Error(`Theme provider "${provider.id}" defines Theme "${definition.id}" more than once.`);
      }
      themeIds.add(definition.id);
      if (this.themes.has(definition.id)) {
        throw new Error(`Theme "${definition.id}" is already registered by another provider.`);
      }
      validateAdapters(definition);
      pendingThemes.push([definition.id, { provider, definition }]);
    }

    this.providers.set(provider.id, provider);
    for (const [themeId, registeredTheme] of pendingThemes) {
      this.themes.set(themeId, registeredTheme);
    }
  }

  getProvider(providerId: string): ThemeProvider | undefined {
    return this.providers.get(providerId);
  }

  resolveTheme(themeId: string): RegisteredTheme | undefined {
    return this.themes.get(themeId);
  }

  resolveAdapter(themeId: string, target: ThemeTarget): ThemeAdapter | undefined {
    return this.themes.get(themeId)?.definition.adapters.find((adapter) => adapter.target === target);
  }
}

/** Raised when an explicitly configured private Theme root is unsafe or unavailable. */
export class PrivateThemeRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivateThemeRootError';
  }
}

/**
 * Resolves an explicitly configured private Theme root without a default path.
 * An unset or blank variable means no private provider is available. A supplied
 * value must be an existing absolute directory and is canonicalized to its
 * real path; invalid settings fail closed instead of falling back elsewhere.
 */
export function resolvePrivateThemeRoot(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const configuredRoot = environment[PRIVATE_THEME_ROOT_ENV]?.trim();
  if (!configuredRoot) return undefined;

  if (!isAbsolute(configuredRoot)) {
    throw new PrivateThemeRootError(`${PRIVATE_THEME_ROOT_ENV} must be an absolute directory path.`);
  }

  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(configuredRoot);
  } catch {
    throw new PrivateThemeRootError(`${PRIVATE_THEME_ROOT_ENV} does not reference an existing directory.`);
  }

  try {
    if (!statSync(canonicalRoot).isDirectory()) {
      throw new PrivateThemeRootError(`${PRIVATE_THEME_ROOT_ENV} must reference a directory.`);
    }
  } catch (error) {
    if (error instanceof PrivateThemeRootError) throw error;
    throw new PrivateThemeRootError(`${PRIVATE_THEME_ROOT_ENV} does not reference an accessible directory.`);
  }

  return canonicalRoot;
}

/** The fixed, non-discoverable entry point for an operator-provided Theme provider. */
export const PRIVATE_THEME_PROVIDER_ENTRY = 'provider.mjs';

export type PrivateThemeProviderLoadErrorCode =
  | 'private-theme-root-unavailable'
  | 'private-theme-root-invalid'
  | 'private-theme-provider-entry-unavailable'
  | 'private-theme-provider-entry-unsafe'
  | 'private-theme-provider-import-failed'
  | 'private-theme-provider-export-invalid'
  | 'private-theme-provider-invalid';

export interface PrivateThemeProviderLoadError {
  readonly code: PrivateThemeProviderLoadErrorCode;
  readonly message: string;
}

export type PrivateThemeProviderLoadResult =
  | { readonly provider: ThemeProvider; readonly error?: never }
  | { readonly provider?: never; readonly error: PrivateThemeProviderLoadError };

/**
 * Loads only `<SLIDE_PRIVATE_THEME_ROOT>/provider.mjs`; it never scans for
 * providers or selects a fallback path. The entry and root are both resolved
 * through real paths before import so symlink traversal outside the root fails
 * closed. A module may use `export default provider` or `export { provider }`.
 */
export async function loadPrivateThemeProvider(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<PrivateThemeProviderLoadResult> {
  let canonicalRoot: string | undefined;
  try {
    canonicalRoot = resolvePrivateThemeRoot(environment);
  } catch (error) {
    return privateProviderLoadError('private-theme-root-invalid', errorMessage(error));
  }

  if (!canonicalRoot) {
    return privateProviderLoadError(
      'private-theme-root-unavailable',
      `${PRIVATE_THEME_ROOT_ENV} is not configured.`,
    );
  }

  const configuredEntry = join(canonicalRoot, PRIVATE_THEME_PROVIDER_ENTRY);
  let canonicalEntry: string;
  try {
    canonicalEntry = realpathSync(configuredEntry);
  } catch {
    return privateProviderLoadError(
      'private-theme-provider-entry-unavailable',
      `Private Theme provider entry "${PRIVATE_THEME_PROVIDER_ENTRY}" is unavailable.`,
    );
  }

  try {
    if (!statSync(canonicalEntry).isFile()) {
      return privateProviderLoadError(
        'private-theme-provider-entry-unavailable',
        `Private Theme provider entry "${PRIVATE_THEME_PROVIDER_ENTRY}" must be a file.`,
      );
    }
  } catch {
    return privateProviderLoadError(
      'private-theme-provider-entry-unavailable',
      `Private Theme provider entry "${PRIVATE_THEME_PROVIDER_ENTRY}" is inaccessible.`,
    );
  }

  if (dirname(canonicalEntry) !== canonicalRoot || !isPhysicallyContained(canonicalRoot, canonicalEntry)) {
    return privateProviderLoadError(
      'private-theme-provider-entry-unsafe',
      `Private Theme provider entry "${PRIVATE_THEME_PROVIDER_ENTRY}" must remain directly inside ${PRIVATE_THEME_ROOT_ENV}.`,
    );
  }

  let module: Record<string, unknown>;
  try {
    module = await import(pathToFileURL(canonicalEntry).href) as Record<string, unknown>;
  } catch (error) {
    return privateProviderLoadError('private-theme-provider-import-failed', errorMessage(error));
  }

  const providers = Object.values(module).filter(isThemeProviderShape);
  if (providers.length !== 1) {
    return privateProviderLoadError(
      'private-theme-provider-export-invalid',
      providers.length === 0
        ? 'Private Theme provider entry must export one ThemeProvider as its default or named export.'
        : 'Private Theme provider entry must export exactly one ThemeProvider.',
    );
  }
  const [provider] = providers;

  try {
    new ThemeRegistry().register(provider);
  } catch (error) {
    return privateProviderLoadError('private-theme-provider-invalid', errorMessage(error));
  }

  return { provider };
}

function privateProviderLoadError(
  code: PrivateThemeProviderLoadErrorCode,
  message: string,
): PrivateThemeProviderLoadResult {
  return { error: { code, message } };
}

function isPhysicallyContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot !== ''
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot);
}

function isThemeProviderShape(value: unknown): value is ThemeProvider {
  if (!value || typeof value !== 'object') return false;
  const provider = value as { id?: unknown; themes?: unknown };
  return typeof provider.id === 'string'
    && provider.id.trim().length > 0
    && Array.isArray(provider.themes)
    && provider.themes.length > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateAdapters(definition: ThemeDefinition): void {
  const targets = new Set<ThemeTarget>();
  const adapterIds = new Set<string>();
  const templateOwners = new Map<string, string>();

  for (const adapter of definition.adapters) {
    assertNonEmpty(adapter.id, `Theme adapter id for Theme "${definition.id}"`);
    if (!adapterIds.add(adapter.id)) {
      throw new Error(`Theme "${definition.id}" defines adapter "${adapter.id}" more than once.`);
    }
    if (targets.has(adapter.target)) {
      throw new Error(`Theme "${definition.id}" defines more than one "${adapter.target}" adapter.`);
    }
    targets.add(adapter.target);

    for (const templateId of adapter.templateIds) {
      assertNonEmpty(templateId, `Template id for adapter "${adapter.id}"`);
      const owner = templateOwners.get(templateId);
      if (owner) {
        throw new Error(`Theme "${definition.id}" assigns template "${templateId}" to both "${owner}" and "${adapter.id}".`);
      }
      templateOwners.set(templateId, adapter.id);
    }
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} must not be empty.`);
}
