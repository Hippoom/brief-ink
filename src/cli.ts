import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseDeck } from './parser.js';
import { validateDeck } from './validator.js';
import { preflightContent } from './content-preflight.js';
import { migrateLegacy } from './migrate.js';
import { resolveRenderConfig } from './render-config.js';
import { buildRenderPlan } from './render-plan.js';
import { prepareHtmlTheme } from './html-theme-registry.js';
import {
  assertSafeOutputDirectory,
  assertSafeRenderArtifacts,
  renderHtml,
  resolveRenderArtifacts,
  writeHtml,
  writeTextOutput,
} from './html-renderer.js';
import { exportPdfAfterQa } from './browser-renderer.js';
import { preparePptxTheme, renderPreparedPptxTheme, verifyPreparedPptxTheme } from './pptx-theme-registry.js';
import { inspectPptxPackage, resolvePptxArtifactPaths } from './pptx-package.js';
import {
  addThemeProviderFromLegacyEnvironment,
  addThemeProviderRoot,
  bindThemeProvider,
  listThemeProviderRegistry,
  removeThemeProvider,
  unbindThemeProvider,
  type ThemeProviderRegistryError,
} from './theme-provider-registry.js';
import {
  FEEDBACK_SCOPES,
  FEEDBACK_STATUSES,
  addFeedback,
  assertFeedbackProject,
  listFeedback,
  triageFeedback,
  verifyFeedback,
} from './feedback.js';
import type { ContentPreflightIssue, ContentPreflightReport, Diagnostic, RenderIssue } from './types.js';

function usage(): never {
  console.error('Usage:\n  slide validate <deck.md>\n  slide parse <deck.md> --out <deck.json>\n  slide migrate <legacy.md> --out <deck-v1.md>\n  slide content-preflight <deck.md> [--out <content-preflight.json>]\n  slide preflight <deck.md> --config <deck.render.yaml> [--target web|pptx] [--out <render-plan.json>]\n  slide render <deck.md> --config <deck.render.yaml> [--target web|pptx] [--out <deck.html|deck.pptx>]\n  slide providers list\n  slide providers add <ref> --root <directory>\n  slide providers add <ref> --from-legacy-env\n  slide providers bind <theme> --provider <ref> [--replace]\n  slide providers unbind <theme>\n  slide providers remove <ref>\n  slide feedback add <message> [--project <dir>] [--deck <deck.md>] [--config <render.yaml>] [--slide <id>] [--source user|self|review]\n  slide feedback list [--project <dir>] [--status observed|candidate|accepted|rejected|verified]\n  slide feedback triage <id> --scope unknown|content|project|theme|skill|fixture|bug --status candidate|accepted|rejected [--rationale <text>] [--project <dir>]\n  slide feedback verify <id> --implementation <reference> --verification <evidence> [--fixture <path> ...] [--project <dir>]');
  process.exit(2);
}

function format(diagnostic: Diagnostic | ContentPreflightIssue | RenderIssue): string {
  const location = diagnostic.location?.line ? ` line ${diagnostic.location.line}` : '';
  const slide = diagnostic.slideId ? ` slide=${diagnostic.slideId}` : '';
  const renderContext = 'stage' in diagnostic ? ` stage=${diagnostic.stage} owner=${diagnostic.owner}` : '';
  const suggestion = diagnostic.suggestion ? `\n  Suggested fix: ${diagnostic.suggestion}` : '';
  return `${diagnostic.severity.toUpperCase()} [${diagnostic.code}${slide}${location}${renderContext}]\n  ${diagnostic.message}${suggestion}`;
}

const [command, input, ...args] = process.argv.slice(2);

function optionValues(values: string[], name: string): string[] {
  const collected: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === name) {
      const value = values[index + 1];
      if (!value || value.startsWith('--')) usage();
      collected.push(value);
      index += 1;
    }
  }
  return collected;
}

function optionValue(values: string[], name: string): string | undefined {
  const found = optionValues(values, name);
  if (found.length > 1) {
    console.error(`ERROR [duplicate-option]\n  ${name} may be supplied only once.`);
    process.exit(2);
  }
  return found[0];
}

function renderTarget(values: string[]): 'web' | 'pptx' {
  const target = optionValue(values, '--target') ?? 'web';
  if (target !== 'web' && target !== 'pptx') {
    console.error(`ERROR [invalid-render-target]\n  --target must be web or pptx; received ${target}.`);
    process.exit(2);
  }
  return target;
}

function providerUsage(): never {
  usage();
}

function providerError(error: ThemeProviderRegistryError): never {
  console.error(`ERROR [${error.code}]\n  ${error.message}`);
  process.exit(1);
}

function assertProviderOptions(values: string[], valueOptions: readonly string[], flags: readonly string[]): void {
  for (let index = 0; index < values.length; index += 1) {
    const option = values[index];
    if (valueOptions.includes(option)) {
      const value = values[index + 1];
      if (!value || value.startsWith('--')) providerUsage();
      index += 1;
    } else if (!flags.includes(option)) {
      providerUsage();
    }
  }
}

async function runProviders(): Promise<never> {
  const action = input;
  if (!action || !['list', 'add', 'bind', 'unbind', 'remove'].includes(action)) providerUsage();

  if (action === 'list') {
    if (args.length !== 0) providerUsage();
    const listed = await listThemeProviderRegistry();
    if (listed.error) providerError(listed.error);
    if (listed.value.providers.length === 0) {
      console.log('No providers registered.');
    } else {
      console.log('PROVIDER_REF\tTHEMES');
      for (const provider of listed.value.providers) console.log(`${provider.providerRef}\t${provider.themes.join(',') || '-'}`);
    }
    if (listed.value.bindings.length === 0) {
      console.log('No theme bindings registered.');
    } else {
      console.log('THEME\tPROVIDER_REF');
      for (const binding of listed.value.bindings) console.log(`${binding.themeId}\t${binding.providerRef}`);
    }
    process.exit(0);
  }

  if (action === 'add') {
    const reference = args[0];
    if (!reference || reference.startsWith('--')) providerUsage();
    const options = args.slice(1);
    assertProviderOptions(options, ['--root'], ['--from-legacy-env']);
    const root = optionValue(options, '--root');
    const legacyOptionCount = options.filter((option) => option === '--from-legacy-env').length;
    if (legacyOptionCount > 1 || Boolean(root) === Boolean(legacyOptionCount)) providerUsage();

    const added = root
      ? await addThemeProviderRoot(reference, root)
      : await addThemeProviderFromLegacyEnvironment(reference);
    if (added.error) providerError(added.error);
    console.log(`Registered provider ${added.value.providerRef}.`);
    process.exit(0);
  }

  if (action === 'bind') {
    const themeId = args[0];
    if (!themeId || themeId.startsWith('--')) providerUsage();
    const options = args.slice(1);
    assertProviderOptions(options, ['--provider'], ['--replace']);
    const providerRef = optionValue(options, '--provider');
    const replaceCount = options.filter((option) => option === '--replace').length;
    if (!providerRef || replaceCount > 1) providerUsage();
    const bound = await bindThemeProvider({ themeId, providerRef, replace: replaceCount === 1 });
    if (bound.error) providerError(bound.error);
    console.log(`Bound theme ${bound.value.themeId} to provider ${bound.value.providerRef}.`);
    process.exit(0);
  }

  if (action === 'unbind') {
    const themeId = args[0];
    if (!themeId || themeId.startsWith('--') || args.length !== 1) providerUsage();
    const unbound = unbindThemeProvider(themeId);
    if (unbound.error) providerError(unbound.error);
    console.log(`Unbound theme ${themeId}.`);
    process.exit(0);
  }

  const providerRef = args[0];
  if (!providerRef || providerRef.startsWith('--') || args.length !== 1) providerUsage();
  const removed = removeThemeProvider(providerRef);
  if (removed.error) providerError(removed.error);
  console.log(`Removed provider ${providerRef}.`);
  process.exit(0);
}

function feedbackUsage(): never {
  usage();
}

function runFeedback(): never {
  const action = input;
  if (!action || !['add', 'list', 'triage', 'verify'].includes(action)) feedbackUsage();
  const projectInput = optionValue(args, '--project') ?? process.cwd();
  let projectRoot = '';
  try {
    projectRoot = assertFeedbackProject(projectInput, resolve(import.meta.dirname, '..'));
  } catch (error) {
    console.error(`ERROR [unsafe-feedback-project]\n  ${(error as Error).message}`);
    process.exit(1);
  }

  try {
    if (action === 'add') {
      const message = args[0];
      if (!message || message.startsWith('--')) feedbackUsage();
      const source = optionValue(args.slice(1), '--source') ?? 'self';
      if (!['user', 'self', 'review'].includes(source)) throw new Error('--source must be user, self, or review.');
      const deck = optionValue(args.slice(1), '--deck');
      const renderConfig = optionValue(args.slice(1), '--config');
      const slideId = optionValue(args.slice(1), '--slide');
      const record = addFeedback({
        projectRoot,
        message,
        source: source as 'user' | 'self' | 'review',
        ...(deck ? { deck: resolve(projectRoot, deck) } : {}),
        ...(renderConfig ? { renderConfig: resolve(projectRoot, renderConfig) } : {}),
        ...(slideId ? { slideId } : {}),
      });
      console.log(`Recorded feedback ${record.id} in .slide/feedback/inbox/.`);
      console.log('Next: triage it as content, project, theme, skill, fixture, or bug; only accepted feedback can be verified.');
      process.exit(0);
    }

    if (action === 'list') {
      const status = optionValue(args, '--status');
      if (status && !(FEEDBACK_STATUSES as readonly string[]).includes(status)) throw new Error(`--status must be one of: ${FEEDBACK_STATUSES.join(', ')}.`);
      const records = listFeedback(projectRoot, status as typeof FEEDBACK_STATUSES[number] | undefined);
      if (records.length === 0) {
        console.log('No feedback records found.');
      } else {
        console.log('ID\tSTATUS\tSCOPE\tMESSAGE');
        for (const record of records) console.log(`${record.id}\t${record.status}\t${record.classification.scope}\t${record.message}`);
      }
      process.exit(0);
    }

    const id = args[0];
    if (!id || id.startsWith('--')) feedbackUsage();
    if (action === 'triage') {
      const scope = optionValue(args.slice(1), '--scope');
      const status = optionValue(args.slice(1), '--status');
      if (!scope || !(FEEDBACK_SCOPES as readonly string[]).includes(scope)) throw new Error(`--scope must be one of: ${FEEDBACK_SCOPES.join(', ')}.`);
      if (!status || !['candidate', 'accepted', 'rejected'].includes(status)) throw new Error('--status must be candidate, accepted, or rejected.');
      const record = triageFeedback({
        projectRoot,
        id,
        scope: scope as typeof FEEDBACK_SCOPES[number],
        status: status as 'candidate' | 'accepted' | 'rejected',
        rationale: optionValue(args.slice(1), '--rationale'),
      });
      console.log(`Triaged feedback ${record.id}: ${record.status}, scope=${record.classification.scope}.`);
      process.exit(0);
    }

    const implementation = optionValue(args.slice(1), '--implementation');
    const verification = optionValue(args.slice(1), '--verification');
    if (!implementation || !verification) feedbackUsage();
    const record = verifyFeedback({
      projectRoot,
      id,
      implementation,
      verification,
      fixtures: optionValues(args.slice(1), '--fixture').map((fixture) => resolve(projectRoot, fixture)),
    });
    console.log(`Verified feedback ${record.id}; evidence stored in .slide/feedback/verified/.`);
    process.exit(0);
  } catch (error) {
    console.error(`ERROR [feedback]\n  ${(error as Error).message}`);
    process.exit(1);
  }
}

if (command === 'feedback') runFeedback();
if (command === 'providers') await runProviders();
if (!command || !input || !['validate', 'parse', 'migrate', 'content-preflight', 'preflight', 'render'].includes(command)) usage();

const inputPath = resolve(input);
let source = '';
try {
  source = readFileSync(inputPath, 'utf8');
} catch (error) {
  console.error(`ERROR [read-input]\n  Could not read ${inputPath}: ${(error as Error).message}`);
  process.exit(1);
}

if (command === 'migrate') {
  const outIndex = args.indexOf('--out');
  const output = outIndex >= 0 ? args[outIndex + 1] : undefined;
  if (!output) usage();
  const outPath = resolve(output);
  const result = migrateLegacy(source);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, result.markdown, 'utf8');
  for (const message of result.messages) console.error(message);
  console.log(`Wrote migrated v1 deck to ${outPath}`);
  process.exit(0);
}

const parsed = parseDeck(source, inputPath);
const diagnostics = [...parsed.diagnostics, ...validateDeck(parsed.deck)];
const contentIssues = diagnostics.some((item) => item.severity === 'error') ? [] : preflightContent(parsed.deck);
for (const item of [...diagnostics, ...contentIssues]) console.error(format(item));

function contentPreflightReport(): ContentPreflightReport {
  const issues = [...diagnostics, ...contentIssues];
  return {
    schema: 'slide-content-preflight/v1',
    deck: {
      sourcePath: inputPath,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      deckSchema: parsed.deck.meta.schema,
      title: parsed.deck.meta.title,
    },
    summary: {
      errors: issues.filter((item) => item.severity === 'error').length,
      warnings: issues.filter((item) => item.severity === 'warning').length,
      notes: issues.filter((item) => item.severity === 'note').length,
    },
    issues,
  };
}

if (command === 'content-preflight') {
  const output = optionValue(args, '--out');
  if (output) {
    const outPath = resolve(output);
    try {
      assertSafeOutputDirectory(dirname(outPath), resolve(import.meta.dirname, '..'));
    } catch (error) {
      console.error(`ERROR [unsafe-content-preflight-output stage=content-preflight owner=configuration]\n  ${(error as Error).message}`);
      process.exit(1);
    }
    writeTextOutput(outPath, `${JSON.stringify(contentPreflightReport(), null, 2)}\n`);
    console.log(`Wrote Content Preflight report to ${outPath}`);
  }
  const errors = diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = [...diagnostics, ...contentIssues].filter((item) => item.severity === 'warning').length;
  console.log(`Content Preflight summary: ${errors} error(s), ${warnings} warning(s).`);
  process.exit(errors > 0 ? 1 : 0);
}

if (command === 'render') {
  const configIndex = args.indexOf('--config');
  const configInput = configIndex >= 0 ? args[configIndex + 1] : undefined;
  if (!configInput) usage();
  if (diagnostics.some((item) => item.severity === 'error')) {
    console.error('ERROR [semantic-validation-blocks-render]\n  Fix semantic deck errors before rendering.');
    process.exit(1);
  }
  const target = renderTarget(args);
  const resolved = await resolveRenderConfig(resolve(configInput));
  for (const item of resolved.issues) console.error(format(item));
  if (!resolved.config || resolved.issues.some((item) => item.severity === 'error')) {
    const allIssues = [...diagnostics, ...contentIssues, ...resolved.issues];
    console.log(`Render summary: ${allIssues.filter((item) => item.severity === 'error').length} error(s), ${allIssues.filter((item) => item.severity === 'warning').length} warning(s).`);
    process.exit(1);
  }
  const preparedWebTheme = target === 'web' ? await prepareHtmlTheme(parsed.deck, resolved.config) : undefined;
  const preparedPptxTheme = target === 'pptx' ? await preparePptxTheme(parsed.deck, resolved.config) : undefined;
  const preparedTheme = preparedWebTheme ?? preparedPptxTheme;
  const result = buildRenderPlan(parsed.deck, resolved.config, target, preparedTheme);
  for (const item of result.issues) console.error(format(item));
  if (target === 'pptx' && result.issues.some((item) => item.severity === 'error')) {
    const requestedOutput = optionValue(args, '--out');
    try {
      const artifacts = resolvePptxArtifactPaths(resolve(resolved.config.sourcePath, '..', resolved.config.output.directory), requestedOutput);
      assertSafeOutputDirectory(dirname(artifacts.qaPath), resolve(import.meta.dirname, '..'));
      writeTextOutput(artifacts.qaPath, `${JSON.stringify({ schema: 'slide-pptx-qa/v2', target: 'pptx', issues: result.issues }, null, 2)}\n`);
    } catch (error) {
      console.error(`ERROR [unsafe-pptx-output stage=render owner=configuration]\n  ${(error as Error).message}`);
    }
    const allIssues = [...diagnostics, ...contentIssues, ...resolved.issues, ...result.issues];
    console.log(`Render summary: ${allIssues.filter((item) => item.severity === 'error').length} error(s), ${allIssues.filter((item) => item.severity === 'warning').length} warning(s).`);
    process.exit(1);
  }
  if (result.issues.some((item) => item.severity === 'error')) {
    const allIssues = [...diagnostics, ...contentIssues, ...resolved.issues, ...result.issues];
    console.log(`Render summary: ${allIssues.filter((item) => item.severity === 'error').length} error(s), ${allIssues.filter((item) => item.severity === 'warning').length} warning(s).`);
    process.exit(1);
  }
  if (target === 'pptx') {
    if (!resolved.config.output.pptx || resolved.config.output.html || resolved.config.output.pdf || resolved.config.output.png) {
      console.error('ERROR [pptx-output-policy-invalid stage=render owner=configuration]\n  PPTX rendering requires output.pptx: true and output.html/pdf/png: false.');
      process.exit(1);
    }
  } else if (resolved.config.output.png) {
    console.error('ERROR [png-export-not-implemented stage=render owner=renderer]\n  PNG export remains deferred. Set output.png: false and request HTML or PDF only.');
    process.exit(1);
  }

  const requestedOutput = optionValue(args, '--out');
  if (target === 'pptx') {
    let artifacts;
    try {
      artifacts = resolvePptxArtifactPaths(resolve(resolved.config.sourcePath, '..', resolved.config.output.directory), requestedOutput);
      assertSafeOutputDirectory(dirname(artifacts.pptxPath), resolve(import.meta.dirname, '..'));
      assertSafeOutputDirectory(dirname(artifacts.qaPath), resolve(import.meta.dirname, '..'));
    } catch (error) {
      console.error(`ERROR [unsafe-pptx-output stage=render owner=configuration]\n  ${(error as Error).message}`);
      process.exit(1);
    }
    let report;
    try {
      const bytes = await renderPreparedPptxTheme(preparedPptxTheme!, { deck: parsed.deck, plan: result.plan, config: resolved.config });
      const inspection = await inspectPptxPackage(bytes);
      const genericIssues: RenderIssue[] = inspection.issues.map((item) => ({
        severity: 'error', stage: 'qa', owner: 'renderer', code: item.code, message: item.message,
        suggestion: 'Fix the generated native PPTX package before writing an artifact.',
      }));
      const adapterIssues = await verifyPreparedPptxTheme(preparedPptxTheme!, { deck: parsed.deck, plan: result.plan, config: resolved.config, inspection }, bytes);
      report = {
        schema: 'slide-pptx-qa/v2', target: 'pptx', renderer: result.plan.theme.renderer,
        inspection, issues: [...genericIssues, ...adapterIssues],
      };
      writeTextOutput(artifacts.qaPath, `${JSON.stringify(report, null, 2)}\n`);
      for (const item of report.issues) console.error(format(item));
      if (report.issues.some((item) => item.severity === 'error')) {
        console.error('ERROR [pptx-export-blocked stage=qa owner=renderer]\n  Native package verification blocked the PPTX artifact; see the QA report.');
        process.exit(1);
      }
      mkdirSync(dirname(artifacts.pptxPath), { recursive: true });
      writeFileSync(artifacts.pptxPath, bytes);
      console.log(`Wrote native editable PPTX deck to ${artifacts.pptxPath}`);
      console.log(`Render summary: 0 error(s), ${[...diagnostics, ...contentIssues, ...resolved.issues, ...result.issues].filter((item) => item.severity === 'warning').length} warning(s).`);
      process.exit(0);
    } catch (error) {
      const renderIssue: RenderIssue = { severity: 'error', stage: 'render', owner: 'renderer', code: 'pptx-render-failed', message: (error as Error).message, suggestion: 'Use only maintained PPTX templates and supported body blocks.' };
      writeTextOutput(artifacts.qaPath, `${JSON.stringify({ schema: 'slide-pptx-qa/v1', renderer: result.plan.theme.renderer, issues: [renderIssue] }, null, 2)}\n`);
      console.error(format(renderIssue));
      process.exit(1);
    }
  }

  const artifacts = resolveRenderArtifacts(resolved.config, requestedOutput);
  try {
    assertSafeRenderArtifacts(artifacts, resolve(import.meta.dirname, '..'));
  } catch (error) {
    console.error(`ERROR [unsafe-render-output stage=render owner=configuration]\n  ${(error as Error).message}`);
    process.exit(1);
  }

  let html = '';
  try {
    html = renderHtml(parsed.deck, result.plan, resolved.config, preparedWebTheme);
  } catch (error) {
    console.error(`ERROR [html-render-failed stage=render owner=renderer]\n  ${(error as Error).message}`);
    process.exit(1);
  }

  const allIssues: Array<Diagnostic | ContentPreflightIssue | RenderIssue> = [...diagnostics, ...contentIssues, ...resolved.issues, ...result.issues];
  if (resolved.config.output.pdf) {
    try {
      const browser = await exportPdfAfterQa(html, result.plan, resolved.config, artifacts.pdfPath);
      allIssues.push(...browser.issues);
      for (const item of browser.issues) console.error(format(item));
      writeTextOutput(artifacts.qaPath, `${JSON.stringify(browser, null, 2)}\n`);
      if (browser.pdfWritten) console.log(`Wrote PDF deck to ${artifacts.pdfPath}`);
      else console.error('ERROR [pdf-export-blocked stage=qa owner=renderer]\n  Browser export-safety QA blocked PDF generation; see the QA report for structured findings.');
    } catch (error) {
      const browserIssue: RenderIssue = {
        severity: 'error',
        stage: 'render',
        owner: 'renderer',
        code: 'browser-renderer-unavailable',
        message: (error as Error).message,
        suggestion: 'Install the version-coupled browser with: npx playwright install chromium',
      };
      allIssues.push(browserIssue);
      console.error(format(browserIssue));
      writeTextOutput(artifacts.qaPath, `${JSON.stringify({ renderer: result.plan.theme.renderer, issues: [browserIssue] }, null, 2)}\n`);
    }
  }

  if (resolved.config.output.html) {
    writeHtml(artifacts.htmlPath, html);
    console.log(`Wrote HTML deck to ${artifacts.htmlPath}`);
  }
  const errors = allIssues.filter((item) => item.severity === 'error').length;
  const warnings = allIssues.filter((item) => item.severity === 'warning').length;
  console.log(`Render summary: ${errors} error(s), ${warnings} warning(s).`);
  process.exit(errors > 0 ? 1 : 0);
}

if (command === 'preflight') {
  const configIndex = args.indexOf('--config');
  const configInput = configIndex >= 0 ? args[configIndex + 1] : undefined;
  if (!configInput) usage();
  if (diagnostics.some((item) => item.severity === 'error')) {
    console.error('ERROR [semantic-validation-blocks-preflight]\n  Fix semantic deck errors before generating a Render Plan.');
    process.exit(1);
  }
  const target = renderTarget(args);
  const resolved = await resolveRenderConfig(resolve(configInput));
  for (const item of resolved.issues) console.error(format(item));
  if (!resolved.config || resolved.issues.some((item) => item.severity === 'error')) {
    const allIssues = [...diagnostics, ...contentIssues, ...resolved.issues];
    console.log(`Preflight summary: ${allIssues.filter((item) => item.severity === 'error').length} error(s), ${allIssues.filter((item) => item.severity === 'warning').length} warning(s).`);
    process.exit(1);
  }
  const preparedWebTheme = target === 'web' ? await prepareHtmlTheme(parsed.deck, resolved.config) : undefined;
  const preparedPptxTheme = target === 'pptx' ? await preparePptxTheme(parsed.deck, resolved.config) : undefined;
  const preparedTheme = preparedWebTheme ?? preparedPptxTheme;
  const result = buildRenderPlan(parsed.deck, resolved.config, target, preparedTheme);
  for (const item of result.issues) console.error(format(item));
  const outIndex = args.indexOf('--out');
  const output = outIndex >= 0 ? args[outIndex + 1] : undefined;
  if (output) {
    const outPath = resolve(output);
    try {
      assertSafeOutputDirectory(dirname(outPath), resolve(import.meta.dirname, '..'));
    } catch (error) {
      console.error(`ERROR [unsafe-render-plan-output stage=preflight owner=configuration]\n  ${(error as Error).message}`);
      process.exit(1);
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(result.plan, null, 2)}\n`, 'utf8');
    console.log(`Wrote Render Plan to ${outPath}`);
  }
  const allIssues = [...diagnostics, ...contentIssues, ...resolved.issues, ...result.issues];
  const errors = allIssues.filter((item) => item.severity === 'error').length;
  const warnings = allIssues.filter((item) => item.severity === 'warning').length;
  console.log(`Preflight summary: ${errors} error(s), ${warnings} warning(s).`);
  process.exit(errors > 0 ? 1 : 0);
}

if (command === 'parse') {
  const outIndex = args.indexOf('--out');
  const output = outIndex >= 0 ? args[outIndex + 1] : undefined;
  if (!output) usage();
  const outPath = resolve(output);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(parsed.deck, null, 2)}\n`, 'utf8');
  console.log(`Wrote Deck IR to ${outPath}`);
}

const errors = diagnostics.filter((item) => item.severity === 'error').length;
const warnings = [...diagnostics, ...contentIssues].filter((item) => item.severity === 'warning').length;
const notes = [...diagnostics, ...contentIssues].filter((item) => item.severity === 'note').length;
console.log(`Validation summary: ${errors} error(s), ${warnings} warning(s), ${notes} note(s).`);
process.exit(errors > 0 ? 1 : 0);
