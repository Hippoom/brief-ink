import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RenderIssue, RenderPlan, ResolvedRenderConfig } from './types.js';

const CANVAS = { width: 1600, height: 900 };
const PRINT_PAGE = { width: `${CANVAS.width / 96}in`, height: `${CANVAS.height / 96}in` };

type BrowserPage = {
  on(event: 'requestfailed', callback: (request: { url(): string }) => void): void;
  setContent(html: string, options: { waitUntil: 'load' }): Promise<void>;
  evaluate<T>(callback: () => T | Promise<T>): Promise<Awaited<T>>;
  locator(selector: string): { evaluateAll<T>(callback: (elements: Element[]) => T): Promise<T> };
  emulateMedia(options: { media: 'print' }): Promise<void>;
  pdf(options: {
    path: string;
    width: string;
    height: string;
    margin: { top: string; right: string; bottom: string; left: string };
    printBackground: boolean;
    displayHeaderFooter: boolean;
    preferCSSPageSize: boolean;
  }): Promise<void>;
};

type BrowserInstance = {
  newPage(options: { viewport: typeof CANVAS; deviceScaleFactor: number }): Promise<BrowserPage>;
  close(): Promise<void>;
};

export interface BrowserQaReport {
  renderer: string;
  viewport: typeof CANVAS;
  expectedSlideCount: number;
  issues: RenderIssue[];
}

export interface BrowserPdfResult extends BrowserQaReport {
  pdfWritten: boolean;
}

interface DomSlide {
  id: string | null;
  index: string | null;
  number: string | null;
  template: string | null;
  overflow: boolean;
}

function issue(values: Omit<RenderIssue, 'stage'>): RenderIssue {
  return { ...values, stage: 'qa' };
}

function overflowSeverity(config: ResolvedRenderConfig): 'error' | 'warning' {
  return config.qa.failOnOverflow ? 'error' : 'warning';
}

function assetSeverity(config: ResolvedRenderConfig): 'error' | 'warning' {
  return config.qa.failOnMissingAsset ? 'error' : 'warning';
}

async function collectDomSlides(page: BrowserPage): Promise<DomSlide[]> {
  return page.locator('[data-qa-role="slide"]').evaluateAll((slides) => slides.map((slide) => {
    const root = slide as HTMLElement;
    const rootBounds = root.getBoundingClientRect();
    const descendants = Array.from(root.querySelectorAll<HTMLElement>('*'));
    const overflow = root.scrollWidth > root.clientWidth + 1
      || root.scrollHeight > root.clientHeight + 1
      || descendants.some((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') return false;
        const bounds = element.getBoundingClientRect();
        return bounds.left < rootBounds.left - 1
          || bounds.top < rootBounds.top - 1
          || bounds.right > rootBounds.right + 1
          || bounds.bottom > rootBounds.bottom + 1;
      });
    return {
      id: root.dataset.slideId ?? null,
      index: root.dataset.slideIndex ?? null,
      number: root.dataset.slideNumber ?? null,
      template: root.dataset.template ?? null,
      overflow,
    };
  }));
}

function integrityIssues(plan: RenderPlan, domSlides: DomSlide[]): RenderIssue[] {
  const issues: RenderIssue[] = [];
  if (domSlides.length !== plan.slides.length) {
    issues.push(issue({
      severity: 'error', owner: 'renderer', code: 'qa-slide-count-mismatch',
      message: `Browser DOM exposes ${domSlides.length} slide root(s), but the Render Plan requires ${plan.slides.length}.`,
      suggestion: 'Correct the maintained renderer slide-root instrumentation; do not remove or merge Deck slides.',
    }));
  }

  const seen = new Set<string>();
  for (const [index, domSlide] of domSlides.entries()) {
    const planned = plan.slides[index];
    if (!domSlide.id || domSlide.index === null || !domSlide.number || !domSlide.template) {
      issues.push(issue({
        severity: 'error', owner: 'renderer', code: 'qa-slide-hook-missing',
        message: `Rendered slide root ${index + 1} is missing one or more required QA identity attributes.`,
        suggestion: 'Maintain data-slide-id, data-slide-index, data-slide-number, and data-template on every renderer slide root.',
      }));
      continue;
    }
    if (seen.has(domSlide.id)) {
      issues.push(issue({
        severity: 'error', owner: 'renderer', code: 'qa-slide-id-duplicate', slideId: domSlide.id,
        message: `Rendered slide id ${domSlide.id} appears more than once in the browser DOM.`,
        suggestion: 'Maintain a one-to-one mapping between Render Plan slides and slide-root elements.',
      }));
    }
    seen.add(domSlide.id);
    if (!planned || domSlide.id !== planned.slideId || domSlide.index !== String(index) || domSlide.number !== String(planned.number) || domSlide.template !== planned.template) {
      issues.push(issue({
        severity: 'error', owner: 'renderer', code: 'qa-slide-plan-mismatch', slideId: domSlide.id,
        message: `Rendered slide root ${index + 1} does not match the authoritative Render Plan identity or template.`,
        suggestion: 'Correct the maintained renderer mapping; do not rewrite Deck content to match the DOM.',
      }));
    }
  }
  return issues;
}

function overflowIssues(plan: RenderPlan, config: ResolvedRenderConfig, domSlides: DomSlide[]): RenderIssue[] {
  return domSlides.flatMap((slide, index) => {
    if (!slide.overflow) return [];
    const planned = plan.slides[index];
    return [issue({
      severity: overflowSeverity(config), owner: 'content', code: 'qa-overflow-detected',
      slideId: slide.id ?? planned?.slideId,
      message: `Rendered content exceeds the fixed slide canvas on slide ${slide.number ?? index + 1}; Chromium would clip visible content in the exported PDF.`,
      suggestion: 'Restructure or split the Deck content; do not shrink, truncate, or hide it in the renderer.',
    })];
  });
}

function missingResourceIssues(config: ResolvedRenderConfig, failedResources: string[]): RenderIssue[] {
  return [...new Set(failedResources)].map((resource) => issue({
    severity: assetSeverity(config), owner: 'asset', code: 'qa-resource-load-failed',
    message: `Chromium could not load required render resource: ${resource}.`,
    suggestion: 'Correct the declared local/embedded asset or remove the invalid reference; do not rely on host-installed or remote runtime assets.',
  }));
}

function hasBlockingIssues(issues: RenderIssue[]): boolean {
  return issues.some((entry) => entry.severity === 'error');
}

export function pdfPageCount(pdfPath: string): number | undefined {
  const contents = readFileSync(pdfPath);
  const pages = [...contents.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
  return pages > 0 ? pages : undefined;
}

function pageCountIssues(plan: RenderPlan, pdfPath: string): RenderIssue[] {
  const actual = pdfPageCount(pdfPath);
  if (actual === plan.slides.length) return [];
  return [issue({
    severity: 'error', owner: 'renderer', code: 'qa-pdf-page-count-mismatch',
    message: actual === undefined
      ? 'The generated PDF has no detectable page objects.'
      : `The generated PDF has ${actual} page(s), but the Render Plan requires ${plan.slides.length}.`,
    suggestion: 'Maintain one fixed-canvas printed page per Render Plan slide; do not merge or split Deck slides during export.',
  })];
}

async function loadChromium(): Promise<{ launch(options: { headless: true }): Promise<BrowserInstance> }> {
  try {
    const module = await Function('return import("playwright")')() as {
      chromium: { launch(options: { headless: true }): Promise<BrowserInstance> };
    };
    return module.chromium;
  } catch (error) {
    throw new Error(`Playwright is not installed: ${(error as Error).message}\nInstall dependencies, then install Chromium with: npx playwright install chromium`);
  }
}

async function withPage<T>(html: string, callback: (page: BrowserPage, failedResources: string[]) => Promise<T>): Promise<T> {
  const chromium = await loadChromium();
  let browser: BrowserInstance;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    throw new Error(`Playwright Chromium could not launch: ${(error as Error).message}\nInstall the bundled browser with: npx playwright install chromium`);
  }
  try {
    const page = await browser.newPage({ viewport: CANVAS, deviceScaleFactor: 1 });
    const failedResources: string[] = [];
    page.on('requestfailed', (request) => {
      const url = request.url();
      if (!url.startsWith('data:') && !url.startsWith('about:')) failedResources.push(url);
    });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => { await document.fonts.ready; });
    return await callback(page, failedResources);
  } finally {
    await browser.close();
  }
}

export async function inspectBrowserRender(html: string, plan: RenderPlan, config: ResolvedRenderConfig): Promise<BrowserQaReport> {
  return withPage(html, async (page, failedResources) => {
    const domSlides = await collectDomSlides(page);
    return {
      renderer: plan.theme.renderer,
      viewport: CANVAS,
      expectedSlideCount: plan.slides.length,
      issues: [
        ...integrityIssues(plan, domSlides),
        ...overflowIssues(plan, config, domSlides),
        ...missingResourceIssues(config, failedResources),
      ],
    };
  });
}

export async function exportPdfAfterQa(html: string, plan: RenderPlan, config: ResolvedRenderConfig, pdfPath: string): Promise<BrowserPdfResult> {
  return withPage(html, async (page, failedResources) => {
    const domSlides = await collectDomSlides(page);
    const issues = [
      ...integrityIssues(plan, domSlides),
      ...overflowIssues(plan, config, domSlides),
      ...missingResourceIssues(config, failedResources),
    ];
    if (hasBlockingIssues(issues)) {
      return { renderer: plan.theme.renderer, viewport: CANVAS, expectedSlideCount: plan.slides.length, issues, pdfWritten: false };
    }

    mkdirSync(dirname(pdfPath), { recursive: true });
    await page.emulateMedia({ media: 'print' });
    await page.pdf({
      path: pdfPath,
      width: PRINT_PAGE.width,
      height: PRINT_PAGE.height,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: false,
    });
    if (!existsSync(pdfPath) || statSync(pdfPath).size === 0) {
      issues.push(issue({
        severity: 'error', owner: 'renderer', code: 'qa-pdf-output-empty',
        message: 'Chromium completed PDF export but no non-empty PDF artifact was produced.',
        suggestion: 'Inspect the local Chromium launch and PDF export environment before retrying.',
      }));
    } else {
      issues.push(...pageCountIssues(plan, pdfPath));
    }
    return { renderer: plan.theme.renderer, viewport: CANVAS, expectedSlideCount: plan.slides.length, issues, pdfWritten: !hasBlockingIssues(issues) };
  });
}
