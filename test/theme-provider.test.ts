import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  PRIVATE_THEME_PROVIDER_ENTRY,
  PRIVATE_THEME_ROOT_ENV,
  PrivateThemeRootError,
  ThemeRegistry,
  loadPrivateThemeProvider,
  resolvePrivateThemeRoot,
  type ThemeAdapter,
} from '../src/theme-provider.js';
import {
  addThemeProviderFromLegacyEnvironment,
  addThemeProviderRoot,
  bindThemeProvider,
  listThemeProviderRegistry,
  removeThemeProvider,
  selectThemeProvider,
  unbindThemeProvider,
} from '../src/theme-provider-registry.js';
import { prepareHtmlTheme } from '../src/html-theme-registry.js';
import { renderHtml } from '../src/html-renderer.js';
import { buildRenderPlan } from '../src/render-plan.js';
import { parseDeck } from '../src/parser.js';
import { resolveRenderConfig } from '../src/render-config.js';

const root = resolve(import.meta.dirname, '..');
const editorialManifest = join(root, 'references', 'styles', 'brief-ink', 'manifest.yaml');

function renderConfigFixture(theme: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'slide-render-config-'));
  const sourcePath = join(directory, 'render.yaml');
  writeFileSync(sourcePath, `theme: ${theme}\n`, 'utf8');
  return sourcePath;
}

function writePrivateTheme(privateRoot: string, theme: string): void {
  const themeDirectory = join(privateRoot, theme);
  cpSync(join(root, 'references', 'styles', 'brief-ink'), themeDirectory, { recursive: true });
  const manifest = readFileSync(join(themeDirectory, 'manifest.yaml'), 'utf8')
    .replace('name: brief-ink', `name: ${theme}`);
  writeFileSync(join(themeDirectory, 'manifest.yaml'), manifest, 'utf8');
  writeProviderEntry(privateRoot, `
    import { join } from 'node:path';
    const root = import.meta.dirname;
    export default {
      id: 'private-config-provider',
      themes: [{ id: '${theme}', version: 1, adapters: [] }],
      resolveConfiguration: ({ themeId }) => ({
        manifest: {
          name: themeId, version: 1, defaultProfile: 'default',
          sourcePath: join(root, themeId, 'manifest.yaml'),
          renderer: 'brief-ink-html-v1', tokensPath: join(root, themeId, 'tokens.yaml'),
          supportedStructures: ['narrative'], templates: { cover: 'cover', divider: 'divider', structures: { narrative: 'narrative' } },
        },
        profile: {
          name: 'default', sourcePath: join(root, themeId, 'profiles', 'default.yaml'),
          densityMode: 'standard', footerPolicy: 'standard', assetPolicy: 'strict',
          qa: { failOnOverflow: true, failOnMissingAsset: true },
        },
      }),
    };
  `);
}

function adapter(id: string, target: 'web' | 'pptx', templates: string[]): ThemeAdapter<string, string> {
  return {
    id,
    target,
    templateIds: new Set(templates),
    render: (context) => context,
  };
}

function writeProviderEntry(privateRoot: string, moduleSource: string): string {
  const entryPath = join(privateRoot, PRIVATE_THEME_PROVIDER_ENTRY);
  writeFileSync(entryPath, moduleSource, 'utf8');
  return entryPath;
}

test('ThemeRegistry resolves explicitly registered target adapters', async () => {
  const registry = new ThemeRegistry();
  const web = adapter('test-web-v1', 'web', ['cover']);
  const pptx = adapter('test-pptx-v1', 'pptx', ['cover-pptx']);
  const provider = {
    id: 'test-provider',
    themes: [{ id: 'test-theme', version: 1, adapters: [web, pptx] }],
  };

  registry.register(provider);

  assert.equal(registry.getProvider('test-provider'), provider);
  assert.equal(registry.resolveTheme('test-theme')?.provider, provider);
  assert.equal(registry.resolveAdapter('test-theme', 'web'), web);
  assert.equal(registry.resolveAdapter('test-theme', 'pptx'), pptx);
  assert.equal(registry.resolveAdapter('missing-theme', 'web'), undefined);
});

test('ThemeRegistry rejects duplicate Theme, target, and template registrations', async () => {
  const registry = new ThemeRegistry();
  registry.register({ id: 'first', themes: [{ id: 'theme', version: 1, adapters: [] }] });
  assert.throws(
    () => registry.register({ id: 'second', themes: [{ id: 'theme', version: 1, adapters: [] }] }),
    /already registered by another provider/,
  );

  assert.throws(
    () => new ThemeRegistry().register({
      id: 'duplicate-target',
      themes: [{ id: 'theme', version: 1, adapters: [adapter('a', 'web', []), adapter('b', 'web', [])] }],
    }),
    /more than one "web" adapter/,
  );

  assert.throws(
    () => new ThemeRegistry().register({
      id: 'duplicate-template',
      themes: [{ id: 'theme', version: 1, adapters: [adapter('a', 'web', ['shared']), adapter('b', 'pptx', ['shared'])] }],
    }),
    /assigns template "shared" to both/,
  );
});

test('prepared Web Theme runtime state stays in process while extra provider planState is omitted', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-'));
  const originalPrivateRoot = process.env[PRIVATE_THEME_ROOT_ENV];
  const configPath = renderConfigFixture('brief-ink');
  try {
    writeProviderEntry(privateRoot, `
      export default {
        id: 'private-web-provider',
        themes: [{
          id: 'private-web-theme',
          version: 1,
          adapters: [{
            id: 'private-web-html-v1',
            target: 'web',
            templateIds: new Set(['cover']),
            prepare: () => ({
              issues: [],
              runtimeState: { secret: 'runtime-web-sentinel' },
              planState: { secret: 'plan-web-sentinel' },
            }),
            render: (_context, runtimeState) => runtimeState.secret,
          }],
        }],
      };
    `);
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRoot;

    const resolved = await resolveRenderConfig(configPath);
    assert.ok(resolved.config, JSON.stringify(resolved.issues));
    const deckPath = join(root, 'examples', 'v1-valid-consulting-deck.md');
    const deck = parseDeck(readFileSync(deckPath, 'utf8'), deckPath).deck;
    const privateConfig = {
      ...resolved.config,
      theme: { ...resolved.config.theme, name: 'private-web-theme', renderer: 'private-web-html-v1' },
    };
    const prepared = await prepareHtmlTheme(deck, privateConfig);
    const plan = buildRenderPlan(deck, privateConfig, 'web', prepared).plan;
    const serialized = JSON.stringify(plan);

    assert.equal(renderHtml(deck, plan, privateConfig, prepared), 'runtime-web-sentinel');
    assert.equal(serialized.includes('runtime-web-sentinel'), false);
    assert.equal(serialized.includes('plan-web-sentinel'), false);
    assert.equal('providerState' in plan.theme, false);
  } finally {
    if (originalPrivateRoot === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV];
    else process.env[PRIVATE_THEME_ROOT_ENV] = originalPrivateRoot;
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(resolve(configPath, '..'), { recursive: true, force: true });
  }
});

test('prepareHtmlTheme registers a configured private provider Web adapter alongside maintained adapters', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-'));
  const originalPrivateRoot = process.env[PRIVATE_THEME_ROOT_ENV];
  const configPath = renderConfigFixture('brief-ink');
  try {
    writeProviderEntry(privateRoot, `
      export default {
        id: 'private-web-provider',
        themes: [{
          id: 'private-web-theme',
          version: 1,
          adapters: [{
            id: 'private-web-html-v1',
            target: 'web',
            templateIds: new Set(['cover']),
            preflight: () => ({ issues: [] }),
            prepare: () => ({ issues: [], runtimeState: { source: 'private-provider' } }),
            render: () => '<html>private</html>',
          }],
        }],
      };
    `);
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRoot;

    const resolved = await resolveRenderConfig(configPath);
    assert.ok(resolved.config, JSON.stringify(resolved.issues));
    const deckPath = join(root, 'examples', 'v1-valid-consulting-deck.md');
    const deck = parseDeck(readFileSync(deckPath, 'utf8'), deckPath).deck;
    const privateConfig = {
      ...resolved.config,
      theme: { ...resolved.config.theme, name: 'private-web-theme', renderer: 'private-web-html-v1' },
    };
    const prepared = await prepareHtmlTheme(deck, privateConfig);

    assert.deepEqual(prepared.issues, []);
    assert.equal(prepared.adapter?.id, 'private-web-html-v1');
    assert.deepEqual(prepared.runtimeState, { source: 'private-provider' });
  } finally {
    if (originalPrivateRoot === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV];
    else process.env[PRIVATE_THEME_ROOT_ENV] = originalPrivateRoot;
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(resolve(configPath, '..'), { recursive: true, force: true });
  }
});

test('prepareHtmlTheme reports a private provider loading failure for a selected non-public Theme', async () => {
  const configPath = renderConfigFixture('brief-ink');
  const originalPrivateRoot = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    delete process.env[PRIVATE_THEME_ROOT_ENV];
    const resolved = await resolveRenderConfig(configPath);
    assert.ok(resolved.config, JSON.stringify(resolved.issues));
    const deckPath = join(root, 'examples', 'v1-valid-consulting-deck.md');
    const deck = parseDeck(readFileSync(deckPath, 'utf8'), deckPath).deck;
    const privateConfig = {
      ...resolved.config,
      theme: { ...resolved.config.theme, name: 'private-web-theme', renderer: 'private-web-html-v1' },
    };

    const prepared = await prepareHtmlTheme(deck, privateConfig);
    assert.equal(prepared.adapter, undefined);
    assert.deepEqual(prepared.issues.map((issue) => issue.code), ['private-theme-root-unavailable']);
  } finally {
    if (originalPrivateRoot === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV];
    else process.env[PRIVATE_THEME_ROOT_ENV] = originalPrivateRoot;
    rmSync(resolve(configPath, '..'), { recursive: true, force: true });
  }
});

test('prepareHtmlTheme fails closed when a private Web adapter duplicates a maintained adapter ID', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-'));
  const originalPrivateRoot = process.env[PRIVATE_THEME_ROOT_ENV];
  const configPath = renderConfigFixture('brief-ink');
  try {
    writeProviderEntry(privateRoot, `
      export default {
        id: 'duplicate-web-provider',
        themes: [{
          id: 'private-web-theme',
          version: 1,
          adapters: [{
            id: 'brief-ink-html-v1',
            target: 'web',
            templateIds: new Set(['cover']),
            render: () => '<html>duplicate</html>',
          }],
        }],
      };
    `);
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRoot;

    const resolved = await resolveRenderConfig(configPath);
    assert.ok(resolved.config, JSON.stringify(resolved.issues));
    const deckPath = join(root, 'examples', 'v1-valid-consulting-deck.md');
    const deck = parseDeck(readFileSync(deckPath, 'utf8'), deckPath).deck;
    const privateConfig = {
      ...resolved.config,
      theme: { ...resolved.config.theme, name: 'private-web-theme', renderer: 'brief-ink-html-v1' },
    };
    const prepared = await prepareHtmlTheme(deck, privateConfig);

    assert.equal(prepared.adapter, undefined);
    assert.deepEqual(prepared.issues.map((issue) => issue.code), ['private-theme-provider-invalid']);
    assert.match(prepared.issues[0]!.message, /Web Theme adapter "brief-ink-html-v1" is registered by both/);
  } finally {
    if (originalPrivateRoot === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV];
    else process.env[PRIVATE_THEME_ROOT_ENV] = originalPrivateRoot;
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(resolve(configPath, '..'), { recursive: true, force: true });
  }
});

test('resolvePrivateThemeRoot leaves private Themes unavailable unless explicitly configured', async () => {
  assert.equal(resolvePrivateThemeRoot({}), undefined);
  assert.equal(resolvePrivateThemeRoot({ [PRIVATE_THEME_ROOT_ENV]: '   ' }), undefined);
});

test('loadPrivateThemeProvider loads the fixed canonical provider.mjs default export', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-'));
  const privateRootLink = `${privateRoot}-link`;
  try {
    writeProviderEntry(privateRoot, `
      export default {
        id: 'private-default',
        themes: [{ id: 'private-theme', version: 1, adapters: [] }],
      };
    `);
    symlinkSync(privateRoot, privateRootLink);

    const result = await loadPrivateThemeProvider({ [PRIVATE_THEME_ROOT_ENV]: privateRootLink });
    assert.equal(result.error, undefined);
    assert.equal(result.provider?.id, 'private-default');
    assert.equal(result.provider?.themes[0]?.id, 'private-theme');
  } finally {
    rmSync(privateRootLink, { force: true });
    rmSync(privateRoot, { recursive: true, force: true });
  }
});

test('loadPrivateThemeProvider accepts a named ThemeProvider export', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-'));
  try {
    writeProviderEntry(privateRoot, `
      export const companyThemes = {
        id: 'private-named',
        themes: [{ id: 'named-theme', version: 1, adapters: [] }],
      };
    `);

    const result = await loadPrivateThemeProvider({ [PRIVATE_THEME_ROOT_ENV]: privateRoot });
    assert.equal(result.error, undefined);
    assert.equal(result.provider?.id, 'private-named');
  } finally {
    rmSync(privateRoot, { recursive: true, force: true });
  }
});

test('loadPrivateThemeProvider returns structured errors without configuration or an entry', async () => {
  assert.deepEqual(await loadPrivateThemeProvider({}), {
    error: {
      code: 'private-theme-root-unavailable',
      message: `${PRIVATE_THEME_ROOT_ENV} is not configured.`,
    },
  });

  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-'));
  try {
    const result = await loadPrivateThemeProvider({ [PRIVATE_THEME_ROOT_ENV]: privateRoot });
    assert.equal(result.provider, undefined);
    assert.equal(result.error?.code, 'private-theme-provider-entry-unavailable');
  } finally {
    rmSync(privateRoot, { recursive: true, force: true });
  }
});

test('loadPrivateThemeProvider rejects a provider.mjs symlink outside its configured root', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-'));
  const outsideRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-outside-'));
  try {
    const outsideEntry = writeProviderEntry(outsideRoot, `
      export default { id: 'outside', themes: [{ id: 'outside-theme', version: 1, adapters: [] }] };
    `);
    symlinkSync(outsideEntry, join(privateRoot, PRIVATE_THEME_PROVIDER_ENTRY));

    const result = await loadPrivateThemeProvider({ [PRIVATE_THEME_ROOT_ENV]: privateRoot });
    assert.equal(result.provider, undefined);
    assert.equal(result.error?.code, 'private-theme-provider-entry-unsafe');
  } finally {
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('loadPrivateThemeProvider reports import, export shape, and registry validation errors', async () => {
  const importFailureRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-'));
  const exportFailureRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-'));
  const validationFailureRoot = mkdtempSync(join(tmpdir(), 'slide-private-provider-'));
  try {
    writeProviderEntry(importFailureRoot, 'throw new Error("provider exploded");');
    let result = await loadPrivateThemeProvider({ [PRIVATE_THEME_ROOT_ENV]: importFailureRoot });
    assert.equal(result.error?.code, 'private-theme-provider-import-failed');

    writeProviderEntry(exportFailureRoot, 'export const notAProvider = { id: "missing-themes" };');
    result = await loadPrivateThemeProvider({ [PRIVATE_THEME_ROOT_ENV]: exportFailureRoot });
    assert.equal(result.error?.code, 'private-theme-provider-export-invalid');

    writeProviderEntry(validationFailureRoot, `
      export default {
        id: 'invalid-provider',
        themes: [
          { id: 'duplicate-theme', version: 1, adapters: [] },
          { id: 'duplicate-theme', version: 2, adapters: [] },
        ],
      };
    `);
    result = await loadPrivateThemeProvider({ [PRIVATE_THEME_ROOT_ENV]: validationFailureRoot });
    assert.equal(result.error?.code, 'private-theme-provider-invalid');
  } finally {
    rmSync(importFailureRoot, { recursive: true, force: true });
    rmSync(exportFailureRoot, { recursive: true, force: true });
    rmSync(validationFailureRoot, { recursive: true, force: true });
  }
});

test('resolveRenderConfig uses public themes unchanged before consulting private themes', async () => {
  const sourcePath = renderConfigFixture('brief-ink');
  try {
    const result = await resolveRenderConfig(sourcePath);
    assert.equal(result.issues.length, 0);
    assert.equal(result.config?.theme.sourcePath, editorialManifest);
  } finally {
    rmSync(resolve(sourcePath, '..'), { recursive: true, force: true });
  }
});

test('resolveRenderConfig resolves a configured private theme from its canonical root', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-themes-'));
  const privateRootLink = `${privateRoot}-link`;
  const sourcePath = renderConfigFixture('private-editorial');
  const originalPrivateRoot = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    writePrivateTheme(privateRoot, 'private-editorial');
    symlinkSync(privateRoot, privateRootLink);
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRootLink;

    const result = await resolveRenderConfig(sourcePath);
    assert.equal(result.issues.length, 0);
    assert.equal(result.config?.theme.sourcePath, join(realpathSync(privateRoot), 'private-editorial', 'manifest.yaml'));
    assert.equal(result.config?.profile.sourcePath, join(realpathSync(privateRoot), 'private-editorial', 'profiles', 'default.yaml'));
  } finally {
    if (originalPrivateRoot === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV];
    else process.env[PRIVATE_THEME_ROOT_ENV] = originalPrivateRoot;
    rmSync(privateRootLink, { force: true });
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(resolve(sourcePath, '..'), { recursive: true, force: true });
  }
});

test('resolveRenderConfig rejects duplicate public and private theme IDs', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-themes-'));
  const sourcePath = renderConfigFixture('brief-ink');
  const originalPrivateRoot = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    writePrivateTheme(privateRoot, 'brief-ink');
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRoot;

    const result = await resolveRenderConfig(sourcePath);
    assert.equal(result.config, undefined);
    assert.ok(result.issues.some((item) => item.code === 'duplicate-theme'));
  } finally {
    if (originalPrivateRoot === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV];
    else process.env[PRIVATE_THEME_ROOT_ENV] = originalPrivateRoot;
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(resolve(sourcePath, '..'), { recursive: true, force: true });
  }
});

test('unregistered private theme identifiers require an explicitly configured provider', async () => {
  const originalPrivateRoot = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    delete process.env[PRIVATE_THEME_ROOT_ENV];
    for (const theme of ['private-theme-a', 'private-theme-b']) {
      const sourcePath = renderConfigFixture(theme);
      try {
        const result = await resolveRenderConfig(sourcePath);
        assert.equal(result.config, undefined);
        assert.deepEqual(result.issues.map((item) => item.code), ['unknown-theme']);
      } finally {
        rmSync(resolve(sourcePath, '..'), { recursive: true, force: true });
      }
    }
  } finally {
    if (originalPrivateRoot === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV];
    else process.env[PRIVATE_THEME_ROOT_ENV] = originalPrivateRoot;
  }
});

test('resolveRenderConfig leaves private manifest/resource containment to the private provider contract', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-themes-'));
  const outsideRoot = mkdtempSync(join(tmpdir(), 'slide-private-theme-outside-'));
  const sourcePath = renderConfigFixture('private-editorial');
  const originalPrivateRoot = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    writePrivateTheme(outsideRoot, 'private-editorial');
    symlinkSync(join(outsideRoot, 'private-editorial'), join(privateRoot, 'private-editorial'));
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRoot;

    const result = await resolveRenderConfig(sourcePath);
    assert.equal(result.config, undefined);
    assert.ok(result.issues.some((item) => item.code === 'unknown-theme'));
  } finally {
    if (originalPrivateRoot === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV];
    else process.env[PRIVATE_THEME_ROOT_ENV] = originalPrivateRoot;
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
    rmSync(resolve(sourcePath, '..'), { recursive: true, force: true });
  }
});

test('resolveRenderConfig rejects traversal and preserves structured unknown-theme failures', async () => {
  const privateRoot = mkdtempSync(join(tmpdir(), 'slide-private-themes-'));
  const traversalSourcePath = renderConfigFixture('../brief-ink');
  const unknownSourcePath = renderConfigFixture('not-a-theme');
  const originalPrivateRoot = process.env[PRIVATE_THEME_ROOT_ENV];
  try {
    process.env[PRIVATE_THEME_ROOT_ENV] = privateRoot;

    const traversal = await resolveRenderConfig(traversalSourcePath);
    assert.equal(traversal.config, undefined);
    assert.ok(traversal.issues.some((item) => item.code === 'unknown-theme'));

    const unknown = await resolveRenderConfig(unknownSourcePath);
    assert.equal(unknown.config, undefined);
    assert.ok(unknown.issues.some((item) => item.code === 'unknown-theme'));
  } finally {
    if (originalPrivateRoot === undefined) delete process.env[PRIVATE_THEME_ROOT_ENV];
    else process.env[PRIVATE_THEME_ROOT_ENV] = originalPrivateRoot;
    rmSync(privateRoot, { recursive: true, force: true });
    rmSync(resolve(traversalSourcePath, '..'), { recursive: true, force: true });
    rmSync(resolve(unknownSourcePath, '..'), { recursive: true, force: true });
  }
});

test('nonblank legacy environment is terminal and overrides an XDG binding', async () => {
  const configHome = mkdtempSync(join(tmpdir(), 'slide-xdg-config-'));
  const registryDirectory = join(configHome, 'slides');
  const boundRoot = mkdtempSync(join(tmpdir(), 'slide-bound-provider-'));
  const legacyRoot = mkdtempSync(join(tmpdir(), 'slide-legacy-provider-'));
  try {
    mkdirSync(registryDirectory, { recursive: true });
    writeProviderEntry(boundRoot, `export default { id: 'module-bound', themes: [{ id: 'bound-theme', version: 1, adapters: [] }] };`);
    writeProviderEntry(legacyRoot, `export default { id: 'module-legacy', themes: [{ id: 'bound-theme', version: 1, adapters: [] }] };`);
    writeFileSync(join(registryDirectory, 'theme-providers.yaml'), `schema: slide-provider-registry/v1\nproviders:\n  opaque-bound:\n    root: ${boundRoot}\nbindings:\n  bound-theme:\n    provider_ref: opaque-bound\n`, 'utf8');
    const selected = await selectThemeProvider('bound-theme', {
      XDG_CONFIG_HOME: configHome,
      [PRIVATE_THEME_ROOT_ENV]: legacyRoot,
    });
    assert.equal(selected.selection?.provider.id, 'module-legacy');
    assert.equal(selected.selection?.source, 'legacy-environment');

    const terminalUnowned = await selectThemeProvider('not-owned', {
      XDG_CONFIG_HOME: configHome,
      [PRIVATE_THEME_ROOT_ENV]: legacyRoot,
    });
    assert.equal(terminalUnowned.selection, undefined);
    assert.equal(terminalUnowned.error?.code, 'theme-provider-registry-theme-unowned');

    const xdgOnly = await selectThemeProvider('bound-theme', { XDG_CONFIG_HOME: configHome });
    assert.equal(xdgOnly.selection?.provider.id, 'module-bound');
    assert.equal(xdgOnly.selection?.source, 'xdg-registry');
  } finally {
    rmSync(configHome, { recursive: true, force: true });
    rmSync(boundRoot, { recursive: true, force: true });
    rmSync(legacyRoot, { recursive: true, force: true });
  }
});

test('registry lifecycle persists sanitized bindings atomically and refuses bound provider removal', async () => {
  const configHome = mkdtempSync(join(tmpdir(), 'slide-xdg-lifecycle-'));
  const providerRoot = mkdtempSync(join(tmpdir(), 'slide-lifecycle-provider-'));
  const environment = { XDG_CONFIG_HOME: configHome };
  try {
    writeProviderEntry(providerRoot, `export default { id: 'module-lifecycle-provider', themes: [{ id: 'lifecycle-theme', version: 1, adapters: [] }, { id: 'internal-unbound-theme', version: 1, adapters: [] }] };`);
    const added = await addThemeProviderRoot('opaque-lifecycle-ref', providerRoot, environment);
    assert.deepEqual(added.value, { providerRef: 'opaque-lifecycle-ref', id: 'opaque-lifecycle-ref', themes: [] });
    assert.equal(JSON.stringify(added.value).includes(providerRoot), false);
    assert.equal(JSON.stringify(added.value).includes('module-lifecycle-provider'), false);

    const bound = await bindThemeProvider({ themeId: 'lifecycle-theme', providerRef: 'opaque-lifecycle-ref' }, environment);
    assert.deepEqual(bound.value, { themeId: 'lifecycle-theme', providerRef: 'opaque-lifecycle-ref', providerId: 'opaque-lifecycle-ref' });
    assert.equal((await bindThemeProvider({ themeId: 'lifecycle-theme', providerRef: 'opaque-lifecycle-ref' }, environment)).error?.code, 'theme-provider-registry-binding-exists');
    assert.equal((await bindThemeProvider({ themeId: 'lifecycle-theme', providerRef: 'opaque-lifecycle-ref', replace: true }, environment)).value?.themeId, 'lifecycle-theme');
    assert.equal((await bindThemeProvider({ themeId: 'brief-ink', providerRef: 'opaque-lifecycle-ref' }, environment)).error?.code, 'theme-provider-registry-binding-invalid');

    const listed = await listThemeProviderRegistry(environment);
    assert.deepEqual(listed.value, { providers: [{ providerRef: 'opaque-lifecycle-ref', id: 'opaque-lifecycle-ref', themes: ['lifecycle-theme'] }], bindings: [{ themeId: 'lifecycle-theme', providerRef: 'opaque-lifecycle-ref', providerId: 'opaque-lifecycle-ref' }] });
    assert.equal(JSON.stringify(listed.value).includes(providerRoot), false);
    assert.equal(JSON.stringify(listed.value).includes('module-lifecycle-provider'), false);
    assert.equal(JSON.stringify(listed.value).includes('internal-unbound-theme'), false);
    assert.equal(removeThemeProvider('opaque-lifecycle-ref', environment).error?.code, 'theme-provider-registry-provider-has-bindings');
    assert.equal(unbindThemeProvider('lifecycle-theme', environment).value, undefined);
    assert.equal(removeThemeProvider('opaque-lifecycle-ref', environment).value, undefined);
    const registryPath = join(configHome, 'slides', 'theme-providers.yaml');
    assert.equal(statSync(registryPath).mode & 0o777, 0o600);
    assert.match(readFileSync(registryPath, 'utf8'), /schema: slide-provider-registry\/v1/);
  } finally {
    rmSync(configHome, { recursive: true, force: true });
    rmSync(providerRoot, { recursive: true, force: true });
  }
});

test('registry imports a legacy bridge without exposing its configured root', async () => {
  const configHome = mkdtempSync(join(tmpdir(), 'slide-xdg-legacy-'));
  const providerRoot = mkdtempSync(join(tmpdir(), 'slide-legacy-import-'));
  try {
    writeProviderEntry(providerRoot, `export default { id: 'legacy-import-provider', themes: [{ id: 'legacy-import-theme', version: 1, adapters: [] }] };`);
    const added = await addThemeProviderFromLegacyEnvironment('opaque-legacy-ref', { XDG_CONFIG_HOME: configHome, [PRIVATE_THEME_ROOT_ENV]: providerRoot });
    assert.equal(added.value?.providerRef, 'opaque-legacy-ref');
    assert.equal(JSON.stringify(added).includes(providerRoot), false);
    assert.equal(JSON.stringify(added).includes('legacy-import-provider'), false);
  } finally {
    rmSync(configHome, { recursive: true, force: true });
    rmSync(providerRoot, { recursive: true, force: true });
  }
});

test('resolvePrivateThemeRoot canonicalizes an explicit directory and fails closed for invalid paths', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'slide-private-theme-root-'));
  const link = `${directory}-link`;
  const file = join(directory, 'not-a-directory');
  try {
    symlinkSync(directory, link);
    writeFileSync(file, 'fixture', 'utf8');

    assert.equal(
      resolvePrivateThemeRoot({ [PRIVATE_THEME_ROOT_ENV]: link }),
      realpathSync(directory),
    );
    assert.throws(
      () => resolvePrivateThemeRoot({ [PRIVATE_THEME_ROOT_ENV]: 'relative/private-theme' }),
      PrivateThemeRootError,
    );
    assert.throws(
      () => resolvePrivateThemeRoot({ [PRIVATE_THEME_ROOT_ENV]: join(directory, 'missing') }),
      PrivateThemeRootError,
    );
    assert.throws(
      () => resolvePrivateThemeRoot({ [PRIVATE_THEME_ROOT_ENV]: file }),
      PrivateThemeRootError,
    );
  } finally {
    rmSync(link, { force: true });
    rmSync(directory, { recursive: true, force: true });
  }
});
