import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  PRIVATE_THEME_ROOT_ENV,
  loadPrivateThemeProvider,
  resolvePrivateThemeRoot,
  type PrivateThemeProviderLoadError,
  type ThemeProvider,
} from './theme-provider.js';
import type { ResolvedRenderConfig } from './types.js';

/** XDG configuration filename for explicit Theme-to-provider bindings. */
export const THEME_PROVIDER_REGISTRY_FILE = 'theme-providers.yaml';
export const THEME_PROVIDER_REGISTRY_DIRECTORY = 'slides';
export const THEME_PROVIDER_REGISTRY_SCHEMA = 'slide-provider-registry/v1';
const PUBLIC_THEME_IDS = new Set(['brief-ink']);

export type ThemeProviderSource = 'xdg-registry' | 'legacy-environment';

export interface ThemeProviderRegistryError {
  readonly code:
    | 'theme-provider-registry-invalid'
    | 'theme-provider-registry-binding-invalid'
    | 'theme-provider-registry-provider-mismatch'
    | 'theme-provider-registry-theme-unowned'
    | 'theme-provider-registry-provider-unavailable'
    | 'theme-provider-registry-provider-has-bindings'
    | 'theme-provider-registry-provider-missing'
    | 'theme-provider-registry-binding-missing'
    | 'theme-provider-registry-binding-exists'
    | 'theme-provider-registry-write-failed'
    | PrivateThemeProviderLoadError['code'];
  /** Safe operational text: never contains roots, provider IDs, or loader details. */
  readonly message: string;
}

export interface ThemeProviderSelection {
  readonly provider: ThemeProvider;
  readonly source: ThemeProviderSource;
}

export type ThemeProviderSelectionResult =
  | { readonly selection: ThemeProviderSelection; readonly error?: never }
  | { readonly selection?: never; readonly error?: ThemeProviderRegistryError };

/** Public registry listing exposes only opaque refs and Theme IDs already bound in the registry. */
export interface RegisteredThemeProvider {
  /** Operator-chosen opaque alias; never the provider module's exported ID. */
  readonly providerRef: string;
  /** Compatibility spelling for the opaque providerRef, never a module ID. */
  readonly id: string;
  readonly themes: readonly string[];
}

/** Public binding listing never exposes roots or provider module identities. */
export interface RegisteredThemeBinding {
  readonly themeId: string;
  readonly providerRef: string;
  /** Compatibility spelling for the opaque providerRef, never a module ID. */
  readonly providerId: string;
}

export interface ThemeProviderRegistryListing {
  readonly providers: readonly RegisteredThemeProvider[];
  readonly bindings: readonly RegisteredThemeBinding[];
}

export type ThemeProviderRegistryResult<T> =
  | { readonly value: T; readonly error?: never }
  | { readonly value?: never; readonly error: ThemeProviderRegistryError };

export interface BindThemeProviderOptions {
  readonly themeId: string;
  readonly providerRef?: string;
  /** Compatibility spelling for opaque providerRef. */
  readonly providerId?: string;
  /** Existing bindings are immutable unless callers explicitly opt into replacement. */
  readonly replace?: boolean;
}

interface RegistryBinding {
  readonly themeId: string;
  readonly providerRef: string;
}

interface RegistryData {
  readonly providers: Map<string, string>;
  readonly bindings: Map<string, RegistryBinding>;
}

const selectedProviders = new WeakMap<ResolvedRenderConfig, ThemeProviderSelection>();

/**
 * Returns the XDG registry location without reading it. `XDG_CONFIG_HOME` must
 * be absolute when set; otherwise the standard `$HOME/.config` location is
 * used. The path itself is never included in diagnostics or serialized data.
 */
export function resolveThemeProviderRegistryPath(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.XDG_CONFIG_HOME?.trim();
  const configHome = configured
    ? (isAbsolute(configured) ? configured : '')
    : join(homedir(), '.config');
  return configHome ? join(resolve(configHome), THEME_PROVIDER_REGISTRY_DIRECTORY, THEME_PROVIDER_REGISTRY_FILE) : '';
}

/** Lists registered providers and Theme bindings without revealing local roots. */
export async function listThemeProviderRegistry(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ThemeProviderRegistryResult<ThemeProviderRegistryListing>> {
  const registry = readRegistry(environment);
  if (registry.error) return { error: registry.error };
  const bindings = [...registry.data.bindings.values()]
    .map(({ themeId, providerRef }) => publicBinding(themeId, providerRef))
    .sort((a, b) => a.themeId.localeCompare(b.themeId));
  const themesByProvider = new Map<string, string[]>();
  for (const binding of bindings) {
    const themes = themesByProvider.get(binding.providerRef) ?? [];
    themes.push(binding.themeId);
    themesByProvider.set(binding.providerRef, themes);
  }
  return {
    value: {
      providers: [...registry.data.providers.keys()]
        .map((providerRef) => publicProvider(providerRef, themesByProvider.get(providerRef) ?? []))
        .sort((a, b) => a.providerRef.localeCompare(b.providerRef)),
      bindings,
    },
  };
}

/** Adds an operator-chosen opaque provider reference after fixed-entry validation. */
export async function addThemeProviderRoot(
  providerRef: string,
  root?: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ThemeProviderRegistryResult<RegisteredThemeProvider>> {
  if (!validIdentifier(providerRef) || !root) return { error: registryError('theme-provider-registry-provider-unavailable', 'Theme provider registration requires an explicit provider reference and root.') };
  const loaded = await loadProviderRoot(root);
  if (!loaded.provider || !loaded.root) return { error: safeProviderLoadError(loaded.error) };
  const registry = readRegistry(environment);
  if (registry.error) return { error: registry.error };
  const existingRoot = registry.data.providers.get(providerRef);
  if (existingRoot && existingRoot !== loaded.root) {
    return { error: registryError('theme-provider-registry-provider-mismatch', 'A different provider root is already registered for this provider reference.') };
  }
  registry.data.providers.set(providerRef, loaded.root);
  const written = writeRegistry(registry.data, environment);
  if (written.error) return { error: written.error };
  return { value: publicProvider(providerRef, []) };
}

/** Imports the explicitly configured legacy bridge into an opaque provider reference. */
export async function addThemeProviderFromLegacyEnvironment(
  providerRef?: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ThemeProviderRegistryResult<RegisteredThemeProvider>> {
  const configuredRoot = environment[PRIVATE_THEME_ROOT_ENV]?.trim();
  if (!configuredRoot || !providerRef) return { error: registryError('theme-provider-registry-provider-unavailable', 'Theme provider registration requires an explicit provider reference and configured legacy provider.') };
  return addThemeProviderRoot(providerRef, configuredRoot, environment);
}

/**
 * Creates an exact Theme binding. The provider is loaded from its registered
 * root and must own exactly the requested Theme. Replacement is opt-in.
 */
export async function bindThemeProvider(
  options: BindThemeProviderOptions,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ThemeProviderRegistryResult<RegisteredThemeBinding>> {
  const providerRef = options.providerRef ?? options.providerId;
  if (!validIdentifier(options.themeId) || !validIdentifier(providerRef)) {
    return { error: registryError('theme-provider-registry-binding-invalid', 'Theme provider binding requires safe Theme and provider identifiers.') };
  }
  const registry = readRegistry(environment);
  if (registry.error) return { error: registry.error };
  const root = registry.data.providers.get(providerRef);
  if (!root) return { error: registryError('theme-provider-registry-provider-missing', 'The requested Theme provider is not registered.') };
  const loaded = await loadProviderRoot(root);
  if (!loaded.provider) return { error: safeProviderLoadError(loaded.error) };
  if (PUBLIC_THEME_IDS.has(options.themeId)) {
    return { error: registryError('theme-provider-registry-binding-invalid', 'A bundled public Theme cannot be bound to an external provider.') };
  }
  if (!ownsTheme(loaded.provider, options.themeId)) {
    return { error: registryError('theme-provider-registry-theme-unowned', 'The requested Theme is not owned by the selected provider.') };
  }
  const existing = registry.data.bindings.get(options.themeId);
  if (existing && !options.replace) return { error: registryError('theme-provider-registry-binding-exists', 'A Theme binding already exists; replacement requires explicit approval.') };
  registry.data.bindings.set(options.themeId, { themeId: options.themeId, providerRef: providerRef });
  const written = writeRegistry(registry.data, environment);
  if (written.error) return { error: written.error };
  return { value: publicBinding(options.themeId, providerRef) };
}

/** Removes one exact Theme binding; providers remain registered. */
export function unbindThemeProvider(
  themeId: string,
  environment: NodeJS.ProcessEnv = process.env,
): ThemeProviderRegistryResult<void> {
  if (!validIdentifier(themeId)) return { error: registryError('theme-provider-registry-binding-invalid', 'Theme provider unbinding requires a safe Theme identifier.') };
  const registry = readRegistry(environment);
  if (registry.error) return { error: registry.error };
  if (!registry.data.bindings.delete(themeId)) return { error: registryError('theme-provider-registry-binding-missing', 'No Theme binding exists for the requested Theme.') };
  const written = writeRegistry(registry.data, environment);
  return written.error ? { error: written.error } : { value: undefined };
}

/** Removes a provider only after all of its Theme bindings have been removed. */
export function removeThemeProvider(
  providerRef: string,
  environment: NodeJS.ProcessEnv = process.env,
): ThemeProviderRegistryResult<void> {
  if (!validIdentifier(providerRef)) return { error: registryError('theme-provider-registry-binding-invalid', 'Theme provider removal requires a safe provider identifier.') };
  const registry = readRegistry(environment);
  if (registry.error) return { error: registry.error };
  if (!registry.data.providers.has(providerRef)) return { error: registryError('theme-provider-registry-provider-missing', 'The requested Theme provider is not registered.') };
  if ([...registry.data.bindings.values()].some((binding) => binding.providerRef === providerRef)) {
    return { error: registryError('theme-provider-registry-provider-has-bindings', 'Remove this provider’s Theme bindings before removing the provider.') };
  }
  registry.data.providers.delete(providerRef);
  const written = writeRegistry(registry.data, environment);
  return written.error ? { error: written.error } : { value: undefined };
}

/**
 * Resolve one Theme through an exact XDG binding. A present matching binding is
 * authoritative: a broken binding fails closed and is never replaced by the
 * legacy environment bridge. If no binding exists, the legacy bridge remains a
 * compatibility-only fallback.
 */
export async function selectThemeProvider(
  themeId: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ThemeProviderSelectionResult> {
  // A nonblank legacy bridge is an explicit compatibility override. It is
  // terminal on any failure or non-ownership and never falls through to XDG.
  if (environment[PRIVATE_THEME_ROOT_ENV]?.trim()) {
    const legacy = await loadPrivateThemeProvider(environment);
    if (!legacy.provider) return { error: safeLegacySelectionError(legacy.error) };
    if (!ownsTheme(legacy.provider, themeId)) {
      return { error: registryError('theme-provider-registry-theme-unowned', 'The legacy Theme provider does not own the selected Theme.') };
    }
    return { selection: { provider: legacy.provider, source: 'legacy-environment' } };
  }

  const registry = readRegistry(environment);
  if (registry.error) return { error: registry.error };
  const binding = registry.data.bindings.get(themeId);
  if (!binding) {
    const legacy = await loadPrivateThemeProvider(environment);
    return legacy.provider
      ? { error: registryError('theme-provider-registry-theme-unowned', 'The legacy Theme provider does not own the selected Theme.') }
      : { error: safeLegacySelectionError(legacy.error) };
  }
  const root = registry.data.providers.get(binding.providerRef);
  if (!root) return { error: registryError('theme-provider-registry-provider-missing', 'The selected Theme binding has no registered provider.') };
  const loaded = await loadProviderRoot(root);
  if (!loaded.provider) return { error: safeProviderLoadError(loaded.error) };
  if (!ownsTheme(loaded.provider, themeId)) return { error: registryError('theme-provider-registry-theme-unowned', 'The selected Theme binding is not owned by its declared provider.') };
  return { selection: { provider: loaded.provider, source: 'xdg-registry' } };
}

/** Associates a resolved config with its selected provider without serializing it. */
export function bindThemeProviderSelection(config: ResolvedRenderConfig, selection: ThemeProviderSelection): void {
  selectedProviders.set(config, selection);
}

/** Retrieves only invocation-local selection; no discovery occurs here. */
export function themeProviderSelectionFor(config: ResolvedRenderConfig): ThemeProviderSelection | undefined {
  return selectedProviders.get(config);
}

function readRegistry(environment: NodeJS.ProcessEnv):
  | { readonly data: RegistryData; readonly error?: never }
  | { readonly data?: never; readonly error: ThemeProviderRegistryError } {
  const configuredXdgHome = environment.XDG_CONFIG_HOME?.trim();
  if (configuredXdgHome && !isAbsolute(configuredXdgHome)) return { error: registryError('theme-provider-registry-invalid', 'XDG configuration must use an absolute directory.') };
  const registryPath = resolveThemeProviderRegistryPath(environment);
  if (!registryPath || !existsSync(registryPath)) return { data: { providers: new Map(), bindings: new Map() } };
  try {
    const stat = lstatSync(registryPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe');
    const document = parseYaml(readFileSync(registryPath, 'utf8'));
    return parseRegistryDocument(document);
  } catch {
    return { error: registryError('theme-provider-registry-invalid', 'Theme provider registry is unreadable or invalid.') };
  }
}

function parseRegistryDocument(document: unknown):
  | { readonly data: RegistryData; readonly error?: never }
  | { readonly data?: never; readonly error: ThemeProviderRegistryError } {
  if (!isObject(document) || !onlyKeys(document, ['schema', 'providers', 'bindings']) || document.schema !== THEME_PROVIDER_REGISTRY_SCHEMA || !isObject(document.bindings)) {
    return { error: registryError('theme-provider-registry-invalid', 'Theme provider registry must use the approved schema.') };
  }
  const providers = new Map<string, string>();
  if (document.providers !== undefined) {
    if (!isObject(document.providers)) return { error: registryError('theme-provider-registry-invalid', 'Theme provider registry providers are invalid.') };
    for (const [id, value] of Object.entries(document.providers)) {
      if (!validIdentifier(id) || !isObject(value) || !onlyKeys(value, ['root']) || typeof value.root !== 'string' || !validRoot(value.root)) {
        return { error: registryError('theme-provider-registry-invalid', 'Theme provider registry providers are invalid.') };
      }
      providers.set(id, value.root.trim());
    }
  }
  const bindings = new Map<string, RegistryBinding>();
  for (const [themeId, value] of Object.entries(document.bindings)) {
    if (!validIdentifier(themeId) || PUBLIC_THEME_IDS.has(themeId) || !isObject(value) || !onlyKeys(value, ['provider_ref']) || !validIdentifier(value.provider_ref)) {
      return { error: registryError('theme-provider-registry-binding-invalid', 'Theme provider registry bindings are invalid.') };
    }
    if (!providers.has(value.provider_ref)) return { error: registryError('theme-provider-registry-binding-invalid', 'Theme provider registry bindings require registered providers.') };
    bindings.set(themeId, { themeId, providerRef: value.provider_ref });
  }
  return { data: { providers, bindings } };
}

function writeRegistry(data: RegistryData, environment: NodeJS.ProcessEnv): { readonly error?: ThemeProviderRegistryError } {
  const registryPath = resolveThemeProviderRegistryPath(environment);
  if (!registryPath) return { error: registryError('theme-provider-registry-write-failed', 'Theme provider registry could not be safely written.') };
  const directory = resolve(registryPath, '..');
  const temporary = join(directory, `.${THEME_PROVIDER_REGISTRY_FILE}.${process.pid}.${Date.now()}.tmp`);
  const document = {
    schema: THEME_PROVIDER_REGISTRY_SCHEMA,
    providers: Object.fromEntries([...data.providers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([providerRef, root]) => [providerRef, { root }])),
    bindings: Object.fromEntries([...data.bindings.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([themeId, binding]) => [themeId, { provider_ref: binding.providerRef }])),
  };
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    writeFileSync(temporary, stringifyYaml(document), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    renameSync(temporary, registryPath);
    chmodSync(registryPath, 0o600);
    return {};
  } catch {
    rmSync(temporary, { force: true });
    return { error: registryError('theme-provider-registry-write-failed', 'Theme provider registry could not be safely written.') };
  }
}

async function loadProviderRoot(root: string): Promise<{ readonly provider?: ThemeProvider; readonly root?: string; readonly error?: ThemeProviderRegistryError }> {
  let canonicalRoot: string | undefined;
  try {
    canonicalRoot = resolvePrivateThemeRoot({ [PRIVATE_THEME_ROOT_ENV]: root });
  } catch {
    return { error: registryError('theme-provider-registry-provider-unavailable', 'The selected Theme provider is unavailable.') };
  }
  const loaded = await loadPrivateThemeProvider({ [PRIVATE_THEME_ROOT_ENV]: canonicalRoot });
  return loaded.provider
    ? { provider: loaded.provider, root: canonicalRoot }
    : { error: safeProviderLoadError(loaded.error) };
}

function publicProvider(providerRef: string, boundThemes: readonly string[]): RegisteredThemeProvider {
  return { providerRef, id: providerRef, themes: [...boundThemes].sort() };
}

function publicBinding(themeId: string, providerRef: string): RegisteredThemeBinding {
  return { themeId, providerRef, providerId: providerRef };
}

function safeProviderLoadError(error: PrivateThemeProviderLoadError | ThemeProviderRegistryError | undefined): ThemeProviderRegistryError {
  if (error?.code === 'private-theme-root-unavailable') return registryError('theme-provider-registry-provider-unavailable', 'The selected Theme provider is unavailable.');
  return registryError('theme-provider-registry-provider-unavailable', 'The selected Theme provider could not be loaded safely.');
}

function safeLegacySelectionError(error: PrivateThemeProviderLoadError | undefined): ThemeProviderRegistryError {
  if (!error) return registryError('private-theme-provider-invalid', 'The legacy Theme provider could not be loaded safely.');
  if (error.code === 'private-theme-root-unavailable') return { code: error.code, message: error.message };
  return { code: error.code, message: 'The legacy Theme provider could not be loaded safely.' };
}

function ownsTheme(provider: ThemeProvider, themeId: string): boolean {
  return provider.themes.filter((theme) => theme.id === themeId).length === 1;
}

function validIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
}

function validRoot(value: string): boolean {
  return Boolean(value.trim()) && isAbsolute(value.trim());
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function registryError(code: ThemeProviderRegistryError['code'], message: string): ThemeProviderRegistryError {
  return { code, message };
}
