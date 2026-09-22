import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { htmlThemeRegistry, type HtmlThemeAdapter, type PreparedHtmlTheme } from './html-theme-registry.js';
import type { Deck, RenderPlan, ResolvedRenderConfig } from './types.js';

export interface RenderArtifacts {
  htmlPath: string;
  pdfPath: string;
  qaPath: string;
}

export function renderHtml(deck: Deck, plan: RenderPlan, config: ResolvedRenderConfig, preparedTheme?: PreparedHtmlTheme): string {
  if (plan.theme.renderer !== config.theme.renderer) {
    throw new Error(`Render Plan renderer ${plan.theme.renderer} does not match resolved Theme renderer ${config.theme.renderer}.`);
  }

  const adapter = preparedTheme?.adapter ?? htmlThemeRegistry.resolveAdapter(config.theme.name, 'web') as HtmlThemeAdapter | undefined;
  if (!adapter || adapter.id !== config.theme.renderer) {
    throw new Error(`No HTML renderer is implemented for declared renderer ${config.theme.renderer}.`);
  }

  const rendered = adapter.render({ deck, plan, config }, preparedTheme?.runtimeState);
  if (rendered instanceof Promise) throw new Error(`HTML renderer ${adapter.id} returned an asynchronous artifact; this synchronous HTML API does not support it.`);
  return rendered;
}

export function outputDirectory(config: ResolvedRenderConfig): string {
  return resolve(dirname(config.sourcePath), config.output.directory);
}

export function resolveRenderArtifacts(
  config: ResolvedRenderConfig,
  requestedHtmlOutput?: string,
): RenderArtifacts {
  if (!requestedHtmlOutput) {
    const directory = outputDirectory(config);
    return {
      htmlPath: join(directory, 'index.html'),
      pdfPath: join(directory, 'index.pdf'),
      qaPath: join(directory, 'qa.json'),
    };
  }

  const htmlPath = resolve(requestedHtmlOutput);
  const extension = extname(htmlPath);
  const stem = extension ? htmlPath.slice(0, -extension.length) : htmlPath;
  return {
    htmlPath,
    pdfPath: `${stem}.pdf`,
    qaPath: `${stem}.qa.json`,
  };
}

export function assertSafeOutputDirectory(directory: string, skillRoot: string): void {
  const normalized = resolve(directory);
  const relativePath = relative(resolve(skillRoot), normalized);
  if (relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !relativePath.includes(`${sep}..${sep}`))) {
    throw new Error(`Refusing to write generated deliverables below the Skill source directory: ${normalized}`);
  }
}

export function assertSafeRenderArtifacts(artifacts: RenderArtifacts, skillRoot: string): void {
  for (const [label, artifactPath] of Object.entries(artifacts)) {
    try {
      assertSafeOutputDirectory(dirname(artifactPath), skillRoot);
    } catch (error) {
      throw new Error(`${label}: ${(error as Error).message}`);
    }
  }
}

export function writeTextOutput(outputPath: string, contents: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, contents, 'utf8');
}

export function writeHtml(outputPath: string, html: string): void {
  writeTextOutput(outputPath, html);
}
