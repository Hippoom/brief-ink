import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type {
  RenderIssue,
  RenderOutputPolicy,
  RenderQaPolicy,
  ResolvedProfile,
  ResolvedRenderConfig,
  ThemeManifest,
} from './types.js';
import { rendererCapability } from './renderer-capabilities.js';
import {
  type ThemeConfigurationContext,
  type ThemeConfigurationResolution,
  type ThemeProvider,
} from './theme-provider.js';
import {
  bindThemeProviderSelection,
  selectThemeProvider,
  type ThemeProviderSelection,
} from './theme-provider-registry.js';

const SKILL_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STYLES_ROOT = resolve(SKILL_ROOT, 'references', 'styles');
const PROFILE_KEYS = new Set(['extends', 'density_mode', 'footer_policy', 'asset_policy', 'qa']);
const RENDER_CONFIG_KEYS = new Set(['theme', 'profile', 'theme_options', 'output', 'qa']);
const OUTPUT_KEYS = new Set(['directory', 'html', 'pdf', 'png', 'pptx']);
const QA_KEYS = new Set(['fail_on_overflow', 'fail_on_missing_asset']);
const DENSITY_MODES = new Set(['standard', 'compact']);
const FOOTER_POLICIES = new Set(['standard', 'minimal', 'hidden']);
const ASSET_POLICIES = new Set(['strict', 'allow-placeholder']);
const VISUAL_AUTHORING_KEYS = new Set([
  'css', 'style', 'styles', 'class', 'class_name', 'template', 'templates', 'layout', 'visual', 'render', 'variant',
  'color', 'colors', 'font', 'fonts', 'x', 'y', 'left', 'top', 'right', 'bottom', 'width', 'height', 'size', 'sizes',
  'position', 'coordinates', 'geometry', 'grid', 'margin', 'margins', 'padding', 'per_slide_override', 'slide_override',
]);

type YamlObject = Record<string, unknown>;

export interface ResolveRenderConfigResult {
  config?: ResolvedRenderConfig;
  issues: RenderIssue[];
}

function issue(
  issues: RenderIssue[],
  severity: RenderIssue['severity'],
  code: string,
  message: string,
  suggestion?: string,
): void {
  issues.push({ severity, stage: 'configuration', owner: 'configuration', code, message, suggestion });
}

function isObject(value: unknown): value is YamlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readYaml(path: string, issues: RenderIssue[], codePrefix: string): YamlObject | undefined {
  try {
    const value = parseYaml(readFileSync(path, 'utf8'));
    if (!isObject(value)) {
      issue(issues, 'error', `${codePrefix}-not-object`, `${path} must contain a YAML mapping.`);
      return undefined;
    }
    return value;
  } catch (error) {
    issue(issues, 'error', `${codePrefix}-read-failed`, `Could not load ${path}: ${(error as Error).message}`);
    return undefined;
  }
}

function rejectUnknownKeys(value: YamlObject, allowed: Set<string>, label: string, issues: RenderIssue[]): void {
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    if (VISUAL_AUTHORING_KEYS.has(key.toLowerCase())) {
      issue(issues, 'error', 'prohibited-configuration-visual-authoring', `${label} contains prohibited visual-authoring field: ${key}.`, 'Themes own CSS, templates, layout, colors, fonts, and geometry; use only documented delivery policy fields.');
    } else {
      issue(issues, 'error', 'prohibited-configuration-field', `${label} contains prohibited or unknown field: ${key}.`, 'Use only documented configuration fields; visual tokens and per-slide overrides belong in a maintained theme.');
    }
  }
}

function parseQa(value: unknown, base: RenderQaPolicy, label: string, issues: RenderIssue[]): RenderQaPolicy {
  if (value === undefined) return base;
  if (!isObject(value)) {
    issue(issues, 'error', 'invalid-qa-policy', `${label}.qa must be a YAML mapping.`);
    return base;
  }
  rejectUnknownKeys(value, QA_KEYS, `${label}.qa`, issues);
  const next = { ...base };
  if (value.fail_on_overflow !== undefined) {
    if (typeof value.fail_on_overflow !== 'boolean') issue(issues, 'error', 'invalid-qa-policy', `${label}.qa.fail_on_overflow must be boolean.`);
    else next.failOnOverflow = value.fail_on_overflow;
  }
  if (value.fail_on_missing_asset !== undefined) {
    if (typeof value.fail_on_missing_asset !== 'boolean') issue(issues, 'error', 'invalid-qa-policy', `${label}.qa.fail_on_missing_asset must be boolean.`);
    else next.failOnMissingAsset = value.fail_on_missing_asset;
  }
  return next;
}

function parseOutput(value: unknown, configDirectory: string, issues: RenderIssue[]): RenderOutputPolicy {
  const defaults: RenderOutputPolicy = { directory: 'build', html: true, pdf: false, png: false, pptx: false };
  if (value === undefined) return defaults;
  if (!isObject(value)) {
    issue(issues, 'error', 'invalid-output-policy', 'render.yaml output must be a YAML mapping.');
    return defaults;
  }
  rejectUnknownKeys(value, OUTPUT_KEYS, 'render.yaml output', issues);
  const output = { ...defaults };
  if (value.directory !== undefined) {
    if (typeof value.directory !== 'string' || !value.directory.trim()) {
      issue(issues, 'error', 'invalid-output-directory', 'output.directory must be a non-empty relative path.');
    } else if (isAbsolute(value.directory) || normalize(value.directory).split(sep).includes('..')) {
      issue(issues, 'error', 'unsafe-output-directory', 'output.directory must remain below the deck project directory; absolute paths and parent traversal are not allowed.', 'Use a relative path such as build or output/web.');
    } else {
      output.directory = value.directory;
    }
  }
  for (const key of ['html', 'pdf', 'png', 'pptx'] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'boolean') issue(issues, 'error', 'invalid-output-policy', `output.${key} must be boolean.`);
      else output[key] = value[key];
    }
  }
  if (!output.html && !output.pdf && !output.png && !output.pptx) issue(issues, 'warning', 'no-output-requested', `No HTML, PDF, PNG, or PPTX output is requested for config directory ${configDirectory}.`);
  return output;
}

function themeResourcePath(sourcePath: string, resource: string): string | undefined {
  if (isAbsolute(resource) || normalize(resource).split(sep).includes('..')) return undefined;
  const themeDirectory = dirname(sourcePath);
  const candidate = resolve(themeDirectory, resource);
  return relative(themeDirectory, candidate).split(sep).includes('..') ? undefined : candidate;
}

function themeManifestPath(themeRoot: string, themeName: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(themeName)) return undefined;
  const candidate = resolve(themeRoot, themeName, 'manifest.yaml');
  return relative(themeRoot, candidate).split(sep).includes('..') ? undefined : candidate;
}

function loadPublicManifest(themeName: string, issues: RenderIssue[]): ThemeManifest | undefined {
  const sourcePath = themeManifestPath(STYLES_ROOT, themeName);
  if (!sourcePath) {
    issue(issues, 'error', 'unknown-theme', `Theme ${themeName} is not a valid theme identifier.`);
    return undefined;
  }
  if (!existsSync(sourcePath)) {
    issue(issues, 'error', 'unknown-theme', `Theme ${themeName} has no public manifest at ${sourcePath}.`);
    return undefined;
  }
  const raw = readYaml(sourcePath, issues, 'theme-manifest');
  if (!raw) return undefined;
  const name = raw.name;
  const version = raw.version;
  const defaultProfile = raw.default_profile;
  const files = raw.files;
  const web = raw.web;
  const pptx = raw.pptx;
  if (name !== themeName) issue(issues, 'error', 'theme-name-mismatch', `Theme directory ${themeName} declares manifest name ${String(name)}.`);
  if (typeof version !== 'number') issue(issues, 'error', 'invalid-theme-manifest', `${sourcePath} requires numeric version.`);
  if (typeof defaultProfile !== 'string' || !defaultProfile) issue(issues, 'error', 'invalid-theme-manifest', `${sourcePath} requires default_profile.`);
  if (!isObject(files) || typeof files.tokens !== 'string' || !files.tokens) issue(issues, 'error', 'invalid-theme-manifest', `${sourcePath} requires files.tokens.`);
  if (!isObject(web) || typeof web.renderer !== 'string' || !web.renderer || !Array.isArray(web.supported_structures) || !isObject(web.templates) || !isObject(web.templates.structures)) {
    issue(issues, 'error', 'invalid-theme-manifest', `${sourcePath} requires web.renderer, web.supported_structures, and web.templates.structures mappings.`);
    return undefined;
  }
  const capability = rendererCapability(web.renderer);
  if (!capability) issue(issues, 'error', 'unknown-renderer-capability', `${sourcePath} declares an unregistered web.renderer: ${web.renderer}.`);
  const templates = {
    cover: typeof web.templates.cover === 'string' ? web.templates.cover : undefined,
    divider: typeof web.templates.divider === 'string' ? web.templates.divider : undefined,
    structures: Object.fromEntries(Object.entries(web.templates.structures).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
  };
  const templateIds = [templates.cover, templates.divider, ...Object.values(templates.structures)].filter((item): item is string => Boolean(item));
  if (capability) for (const template of templateIds) if (!capability.templates.has(template)) issue(issues, 'error', 'renderer-template-mismatch', `${sourcePath} maps template ${template} which is not maintained by renderer ${web.renderer}.`);
  const tokensReference = isObject(files) && typeof files.tokens === 'string' ? files.tokens : '';
  const tokensPath = tokensReference ? themeResourcePath(sourcePath, tokensReference) : undefined;
  if (tokensReference && !tokensPath) issue(issues, 'error', 'unsafe-theme-resource-path', `${sourcePath} tokens path must remain inside the selected theme directory.`);
  if (tokensPath && !existsSync(tokensPath)) issue(issues, 'error', 'missing-theme-tokens', `${sourcePath} references missing tokens file ${tokensPath}.`);
  const assetsReference = isObject(files) && typeof files.assets === 'string' ? files.assets : '';
  const assetsPath = assetsReference ? themeResourcePath(sourcePath, assetsReference) : undefined;
  if (assetsReference && !assetsPath) issue(issues, 'error', 'unsafe-theme-resource-path', `${sourcePath} assets path must remain inside the selected theme directory.`);
  if (assetsPath && !existsSync(assetsPath)) issue(issues, 'error', 'missing-theme-assets', `${sourcePath} references missing assets file ${assetsPath}.`);
  let pptxDescriptor: ThemeManifest['pptx'];
  if (pptx !== undefined) {
    if (!isObject(pptx) || typeof pptx.renderer !== 'string' || !pptx.renderer || typeof pptx.tokens !== 'string' || !pptx.tokens || !Array.isArray(pptx.supported_structures) || !isObject(pptx.templates) || !isObject(pptx.templates.structures)) {
      issue(issues, 'error', 'invalid-theme-manifest', `${sourcePath} pptx requires renderer, tokens, supported_structures, and templates.structures mappings.`);
    } else {
      const pptxCapability = rendererCapability(pptx.renderer);
      if (!pptxCapability) issue(issues, 'error', 'unknown-renderer-capability', `${sourcePath} declares an unregistered pptx.renderer: ${pptx.renderer}.`);
      const pptxTemplates = { cover: typeof pptx.templates.cover === 'string' ? pptx.templates.cover : undefined, divider: typeof pptx.templates.divider === 'string' ? pptx.templates.divider : undefined, structures: Object.fromEntries(Object.entries(pptx.templates.structures).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) };
      const pptxTemplateIds = [pptxTemplates.cover, pptxTemplates.divider, ...Object.values(pptxTemplates.structures)].filter((item): item is string => Boolean(item));
      if (pptxCapability) for (const template of pptxTemplateIds) if (!pptxCapability.templates.has(template)) issue(issues, 'error', 'renderer-template-mismatch', `${sourcePath} maps PPTX template ${template} which is not maintained by renderer ${pptx.renderer}.`);
      const pptxTokensPath = themeResourcePath(sourcePath, pptx.tokens);
      if (!pptxTokensPath) issue(issues, 'error', 'unsafe-theme-resource-path', `${sourcePath} PPTX tokens path must remain inside the selected theme directory.`);
      else if (!existsSync(pptxTokensPath)) issue(issues, 'error', 'missing-theme-tokens', `${sourcePath} references missing PPTX tokens file ${pptxTokensPath}.`);
      else pptxDescriptor = { renderer: pptx.renderer, tokensPath: pptxTokensPath, supportedStructures: pptx.supported_structures.filter((item): item is string => typeof item === 'string'), templates: pptxTemplates };
    }
  }
  return { name: typeof name === 'string' ? name : themeName, version: typeof version === 'number' ? version : 0, defaultProfile: typeof defaultProfile === 'string' ? defaultProfile : '', sourcePath, renderer: typeof web.renderer === 'string' ? web.renderer : '', tokensPath: tokensPath ?? '', assetsPath, supportedStructures: web.supported_structures.filter((item): item is string => typeof item === 'string'), templates, pptx: pptxDescriptor };
}

function profilePathForReference(reference: string, theme: ThemeManifest): string | undefined {
  const match = /^([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/.exec(reference);
  if (!match || match[1] !== theme.name) return undefined;
  return resolve(dirname(theme.sourcePath), 'profiles', `${match[2]}.yaml`);
}

function applyProfile(raw: YamlObject, sourcePath: string, name: string, inherited: ResolvedProfile | undefined, issues: RenderIssue[]): ResolvedProfile {
  rejectUnknownKeys(raw, PROFILE_KEYS, `profile ${sourcePath}`, issues);
  const base: ResolvedProfile = inherited ?? {
    name,
    sourcePath,
    densityMode: 'standard',
    footerPolicy: 'standard',
    assetPolicy: 'strict',
    qa: { failOnOverflow: true, failOnMissingAsset: true },
  };
  const profile = { ...base, name, sourcePath, qa: { ...base.qa } };
  if (raw.density_mode !== undefined) {
    if (typeof raw.density_mode !== 'string' || !DENSITY_MODES.has(raw.density_mode)) issue(issues, 'error', 'invalid-profile-value', `${sourcePath} density_mode must be standard or compact.`);
    else profile.densityMode = raw.density_mode as ResolvedProfile['densityMode'];
  }
  if (raw.footer_policy !== undefined) {
    if (typeof raw.footer_policy !== 'string' || !FOOTER_POLICIES.has(raw.footer_policy)) issue(issues, 'error', 'invalid-profile-value', `${sourcePath} footer_policy must be standard, minimal, or hidden.`);
    else profile.footerPolicy = raw.footer_policy as ResolvedProfile['footerPolicy'];
  }
  if (raw.asset_policy !== undefined) {
    if (typeof raw.asset_policy !== 'string' || !ASSET_POLICIES.has(raw.asset_policy)) issue(issues, 'error', 'invalid-profile-value', `${sourcePath} asset_policy must be strict or allow-placeholder.`);
    else profile.assetPolicy = raw.asset_policy as ResolvedProfile['assetPolicy'];
  }
  profile.qa = parseQa(raw.qa, profile.qa, `profile ${sourcePath}`, issues);
  return profile;
}

function resolveProfileFromPath(
  sourcePath: string,
  name: string,
  theme: ThemeManifest,
  issues: RenderIssue[],
  visited: Set<string>,
  projectProfile: boolean,
): ResolvedProfile | undefined {
  if (visited.has(sourcePath)) {
    issue(issues, 'error', 'profile-inheritance-cycle', `Profile inheritance cycle detected at ${sourcePath}.`);
    return undefined;
  }
  if (!existsSync(sourcePath)) {
    issue(issues, 'error', 'unknown-profile', `Profile ${name} was not found at ${sourcePath}.`);
    return undefined;
  }
  visited.add(sourcePath);
  const raw = readYaml(sourcePath, issues, 'profile');
  if (!raw) return undefined;
  let inherited: ResolvedProfile | undefined;
  const extendReference = raw.extends;
  if (extendReference !== undefined) {
    if (typeof extendReference !== 'string') issue(issues, 'error', 'invalid-profile-inheritance', `${sourcePath} extends must be a theme profile reference such as ${theme.name}/default.`);
    else {
      const parentPath = profilePathForReference(extendReference, theme);
      if (!parentPath) issue(issues, 'error', 'invalid-profile-inheritance', `${sourcePath} must extend a ${theme.name}/<profile> reference.`);
      else inherited = resolveProfileFromPath(parentPath, extendReference, theme, issues, visited, false);
    }
  } else if (projectProfile) {
    issue(issues, 'error', 'project-profile-missing-extends', `${sourcePath} is a project profile and must extend a ${theme.name}/<profile> theme profile.`);
  }
  return applyProfile(raw, sourcePath, name, inherited, issues);
}

function resolvePublicThemeOptions(context: ThemeConfigurationContext, manifest: ThemeManifest, issues: RenderIssue[]): ThemeConfigurationResolution['options'] {
  if (context.rawThemeOptions !== undefined) {
    issue(issues, 'error', 'theme-options-unsupported', `render.yaml theme_options are not supported by public Theme ${manifest.name}.`);
  }
  return undefined;
}

function resolvePublicConfiguration(context: ThemeConfigurationContext): ThemeConfigurationResolution {
  const issues: RenderIssue[] = [];
  const manifest = loadPublicManifest(context.themeId, issues);
  if (!manifest) throw new Error(issues.map((item) => item.message).join(' '));
  const profileReference = context.rawProfile ?? manifest.defaultProfile;
  if (typeof profileReference !== 'string' || !profileReference) throw new Error('render.yaml profile must be a built-in profile name or a relative project profile path.');
  const isProjectProfile = profileReference.startsWith('./') || profileReference.startsWith('../');
  const profilePath = isProjectProfile
    ? resolve(context.configDirectory, profileReference)
    : resolve(dirname(manifest.sourcePath), 'profiles', `${profileReference}.yaml`);
  const profile = resolveProfileFromPath(profilePath, profileReference, manifest, issues, new Set(), isProjectProfile);
  const options = resolvePublicThemeOptions(context, manifest, issues);
  if (!profile) throw new Error(issues.map((item) => item.message).join(' '));
  return { manifest, profile, options, issues };
}

const publicThemeProvider: ThemeProvider = {
  id: 'public-theme-configuration',
  themes: [{ id: 'brief-ink', version: 1, adapters: [] }],
  resolveConfiguration: resolvePublicConfiguration,
};

function isPublicTheme(themeId: string): boolean {
  return publicThemeProvider.themes.some((theme) => theme.id === themeId);
}

async function resolveThemeConfiguration(
  context: ThemeConfigurationContext,
  issues: RenderIssue[],
): Promise<{ readonly configuration: ThemeConfigurationResolution; readonly selection?: ThemeProviderSelection } | undefined> {
  const publicTheme = isPublicTheme(context.themeId);
  const selected = await selectThemeProvider(context.themeId);
  if (selected.selection) {
    const provider = selected.selection.provider;
    if (publicTheme) {
      issue(issues, 'error', 'duplicate-theme', `Theme ${context.themeId} is available from both public and explicitly selected providers.`);
      return undefined;
    }
    if (!provider.resolveConfiguration) {
      issue(issues, 'error', 'theme-configuration-unavailable', `The selected Theme provider does not implement configuration resolution for ${context.themeId}.`);
      return undefined;
    }
    try {
      const configuration = await provider.resolveConfiguration(context);
      issues.push(...(configuration.issues ?? []));
      return { configuration, selection: selected.selection };
    } catch {
      issue(issues, 'error', 'theme-configuration-resolution-failed', `Theme ${context.themeId} configuration could not be resolved by its selected provider.`);
      return undefined;
    }
  }
  if (selected.error && !publicTheme && selected.error.code.startsWith('theme-provider-registry-')) {
    issue(issues, 'error', selected.error.code, selected.error.message);
    return undefined;
  }
  if (publicTheme) {
    const configuration = resolvePublicConfiguration(context);
    issues.push(...(configuration.issues ?? []));
    return { configuration: { ...configuration, issues: undefined } };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(context.themeId)) {
    issue(issues, 'error', 'unknown-theme', `Theme ${context.themeId} is not a valid theme identifier.`);
  } else {
    issue(issues, 'error', 'unknown-theme', `Theme ${context.themeId} is not registered by a public or explicitly selected provider.`);
  }
  return undefined;
}

export async function resolveRenderConfig(sourcePath: string): Promise<ResolveRenderConfigResult> {
  const issues: RenderIssue[] = [];
  const absolutePath = resolve(sourcePath);
  const raw = readYaml(absolutePath, issues, 'render-config');
  if (!raw) return { issues };
  rejectUnknownKeys(raw, RENDER_CONFIG_KEYS, 'render.yaml', issues);
  if (typeof raw.theme !== 'string' || !raw.theme) {
    issue(issues, 'error', 'missing-theme', 'render.yaml requires a string theme.');
    return { issues };
  }
  const resolvedTheme = await resolveThemeConfiguration({
    themeId: raw.theme,
    configPath: absolutePath,
    configDirectory: dirname(absolutePath),
    rawProfile: raw.profile,
    rawThemeOptions: raw.theme_options,
  }, issues);
  if (!resolvedTheme) return { issues };
  const { configuration } = resolvedTheme;
  const output = parseOutput(raw.output, dirname(absolutePath), issues);
  const qa = parseQa(raw.qa, configuration.profile.qa, 'render.yaml', issues);
  if (issues.some((item) => item.severity === 'error')) return { issues };
  const config: ResolvedRenderConfig = {
    sourcePath: absolutePath,
    theme: configuration.manifest,
    profile: configuration.profile,
    themeOptions: configuration.options,
    output,
    qa,
  };
  if (resolvedTheme.selection) bindThemeProviderSelection(config, resolvedTheme.selection);
  return { config, issues };
}
