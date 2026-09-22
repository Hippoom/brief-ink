import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { PptxRenderContext } from '../pptx-theme-registry.js';
import type { Deck, RenderPlan, ResolvedRenderConfig, Slide } from '../types.js';
import type { PptxPresentation, PptxSlide } from '../targets/pptx/runtime.js';

interface MasterRectangle {
  x: number;
  y: number;
  w: number;
  h: number;
  align: 'center' | 'left' | 'justify';
}

export interface BriefInkPptxTokens {
  canvas: { width: number; height: number; safe_margin: number };
  color: Record<string, string>;
  type: Record<string, string | number>;
  layout: Record<string, number>;
  master_layouts?: Record<string, Record<string, MasterRectangle>>;
}

const pptxShapeType = { line: 'line', rect: 'rect' };

interface TextBlock {
  kind: 'paragraph' | 'bullets' | 'ordered';
  text: string[];
}

interface ComparisonGroup {
  heading: string;
  blocks: TextBlock[];
}

function tokens(config: ResolvedRenderConfig): BriefInkPptxTokens {
  const tokensPath = config.theme.pptx?.tokensPath;
  if (!tokensPath) throw new Error(`${config.theme.name} has no PPTX token file.`);
  const value = parseYaml(readFileSync(tokensPath, 'utf8')) as BriefInkPptxTokens;
  if (!value?.canvas || !value.color || !value.type || !value.layout) throw new Error(`Invalid PPTX token file: ${tokensPath}.`);
  return value;
}

function stringToken(t: BriefInkPptxTokens, key: string): string {
  const value = t.type[key];
  if (typeof value !== 'string') throw new Error(`PPTX token type.${key} must be a string.`);
  return value;
}

function numberToken(t: BriefInkPptxTokens, section: 'type' | 'layout', key: string): number {
  const value = t[section][key];
  if (typeof value !== 'number') throw new Error(`PPTX token ${section}.${key} must be numeric.`);
  return value;
}

function lines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').split('\n');
}

function supportedBlocks(content = ''): TextBlock[] {
  const source = lines(content);
  const blocks: TextBlock[] = [];
  let index = 0;
  while (index < source.length) {
    const line = source[index];
    if (!line.trim()) { index += 1; continue; }
    if (/^#{1,6}\s+/.test(line) || /^>\s?/.test(line) || /^\|/.test(line) || /^\s{2,}[-*+]\s+/.test(line) || /^\s{2,}\d+[.)]\s+/.test(line)) {
      throw new Error(`Unsupported PPTX body block: ${line}`);
    }
    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < source.length && /^[-*+]\s+/.test(source[index])) items.push(source[index++].replace(/^[-*+]\s+/, ''));
      blocks.push({ kind: 'bullets', text: items });
      continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < source.length && /^\d+[.)]\s+/.test(source[index])) items.push(source[index++].replace(/^\d+[.)]\s+/, ''));
      blocks.push({ kind: 'ordered', text: items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < source.length && source[index].trim() && !/^[-*+]\s+|^\d+[.)]\s+|^#{1,6}\s+|^>\s?|^\|/.test(source[index])) paragraph.push(source[index++]);
    blocks.push({ kind: 'paragraph', text: [paragraph.join(' ')] });
  }
  return blocks;
}

function comparisonGroups(content = ''): ComparisonGroup[] {
  const source = lines(content);
  const groups: ComparisonGroup[] = [];
  let index = 0;
  while (index < source.length) {
    if (!source[index].trim()) { index += 1; continue; }
    const heading = /^###\s+(.+)$/.exec(source[index]);
    if (!heading) throw new Error('PPTX comparison content must begin each group with a ### heading.');
    index += 1;
    const body: string[] = [];
    while (index < source.length && !/^###\s+/.test(source[index])) body.push(source[index++]);
    groups.push({ heading: heading[1].trim(), blocks: supportedBlocks(body.join('\n')) });
  }
  if (groups.length !== 2) throw new Error('PPTX comparison rendering requires exactly two ### groups.');
  return groups;
}

function stripMarkdown(value: string): string {
  return value.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
}

function addText(slide: PptxSlide, text: string, options: Record<string, unknown>): void {
  slide.addText(stripMarkdown(text), { margin: 0, breakLine: false, fit: 'none', ...options });
}

function addBody(slide: PptxSlide, blocks: TextBlock[], x: number, y: number, w: number, h: number, t: BriefInkPptxTokens): void {
  const body = blocks.flatMap((block) => block.text.map((text) => ({
    text: stripMarkdown(text),
    options: {
      breakLine: true,
      bullet: block.kind === 'bullets' ? { type: 'bullet', indent: 14 } : block.kind === 'ordered' ? { type: 'number', numberType: 'arabicPeriod', indent: 14 } : undefined,
      paraSpaceAfterPt: 7,
      hanging: block.kind === 'paragraph' ? undefined : 3,
    },
  })));
  if (body.length === 0) return;
  slide.addText(body, { x, y, w, h, margin: 0, fontFace: stringToken(t, 'font_face'), fontSize: numberToken(t, 'type', 'body_pt'), color: t.color.ink, valign: 'top', fit: 'none', paraSpaceAfterPt: 7 });
}

function addFooter(slide: PptxSlide, source: Slide, number: number, t: BriefInkPptxTokens): void {
  const y = numberToken(t, 'layout', 'footer_y');
  const margin = t.canvas.safe_margin;
  const fontFace = stringToken(t, 'font_face');
  if (source.footnotes?.trim()) addText(slide, source.footnotes, { x: margin, y, w: 9.8, h: 0.32, fontFace, fontSize: numberToken(t, 'type', 'footnote_pt'), color: t.color.muted, valign: 'mid' });
  addText(slide, String(number).padStart(2, '0'), { x: t.canvas.width - margin - 0.45, y, w: 0.45, h: 0.32, fontFace, fontSize: numberToken(t, 'type', 'label_pt'), color: t.color.muted, align: 'right', valign: 'mid' });
}

function addHeader(slide: PptxSlide, source: Slide, t: BriefInkPptxTokens): void {
  const margin = t.canvas.safe_margin;
  const y = numberToken(t, 'layout', 'header_y');
  const fontFace = stringToken(t, 'font_face');
  if (typeof source.meta?.section === 'string') addText(slide, source.meta.section.replace(/-/g, ' ').toUpperCase(), { x: margin, y, w: 4, h: 0.18, fontFace, fontSize: numberToken(t, 'type', 'section_pt'), color: t.color.accent, bold: true, charSpacing: 1.2 });
  addText(slide, source.title, { x: margin, y: y + 0.28, w: t.canvas.width - margin * 2, h: 0.62, fontFace, fontSize: numberToken(t, 'type', 'title_pt'), color: t.color.ink, bold: true, valign: 'mid' });
  if (source.keyMessage) addText(slide, source.keyMessage, { x: margin, y: y + 1.02, w: t.canvas.width - margin * 2, h: 0.42, fontFace, fontSize: numberToken(t, 'type', 'key_message_pt'), color: t.color.accent_deep, italic: true, valign: 'mid' });
  slide.addShape(pptxShapeType.line, { x: margin, y: y + 1.62, w: t.canvas.width - margin * 2, h: 0, line: { color: t.color.border, width: 0.7 } });
}

function renderCover(slide: PptxSlide, source: Slide, deck: Deck, t: BriefInkPptxTokens): void {
  slide.background = { color: t.color.ink };
  const margin = t.canvas.safe_margin;
  const fontFace = stringToken(t, 'font_face');
  slide.addShape(pptxShapeType.rect, { x: margin, y: 1.25, w: 0.12, h: 3.65, fill: { color: t.color.accent }, line: { color: t.color.accent } });
  addText(slide, deck.meta.audience ?? 'Presentation', { x: margin + 0.34, y: 1.28, w: 6.7, h: 0.24, fontFace, fontSize: numberToken(t, 'type', 'section_pt'), color: 'FFFFFF', bold: true, charSpacing: 1.2 });
  addText(slide, source.title, { x: margin + 0.34, y: 1.72, w: 8.8, h: 1.55, fontFace, fontSize: numberToken(t, 'type', 'cover_title_pt'), color: 'FFFFFF', bold: true, valign: 'mid' });
  if (source.subtitle) addText(slide, source.subtitle, { x: margin + 0.34, y: 3.45, w: 8.4, h: 0.72, fontFace, fontSize: numberToken(t, 'type', 'key_message_pt'), color: 'D8DEE3', valign: 'mid' });
  if (source.context) addText(slide, source.context, { x: margin + 0.34, y: 6.75, w: 7.4, h: 0.26, fontFace, fontSize: numberToken(t, 'type', 'label_pt'), color: 'D8DEE3' });
}

function renderSlide(slide: PptxSlide, source: Slide, deck: Deck, planned: RenderPlan['slides'][number], t: BriefInkPptxTokens): void {
  if (planned.template === 'brief-ink-pptx-cover-v1') renderCover(slide, source, deck, t);
  else if (planned.template === 'brief-ink-pptx-narrative-v1') {
    addHeader(slide, source, t);
    addBody(slide, supportedBlocks(source.content), t.canvas.safe_margin, numberToken(t, 'layout', 'content_y'), t.canvas.width - t.canvas.safe_margin * 2, 3.85, t);
    addFooter(slide, source, planned.number, t);
  } else if (planned.template === 'brief-ink-pptx-comparison-2col-v1') {
    addHeader(slide, source, t);
    const groups = comparisonGroups(source.content);
    const gap = numberToken(t, 'layout', 'column_gap');
    const width = (t.canvas.width - t.canvas.safe_margin * 2 - gap) / 2;
    groups.forEach((group, groupIndex) => {
      const x = t.canvas.safe_margin + groupIndex * (width + gap);
      slide.addShape(pptxShapeType.rect, { x, y: numberToken(t, 'layout', 'content_y'), w: width, h: 3.85, fill: { color: t.color.surface }, line: { color: t.color.border, width: 0.7 } });
      slide.addShape(pptxShapeType.rect, { x, y: numberToken(t, 'layout', 'content_y'), w: width, h: numberToken(t, 'layout', 'rule_height'), fill: { color: t.color.accent }, line: { color: t.color.accent } });
      addText(slide, group.heading, { x: x + 0.24, y: numberToken(t, 'layout', 'content_y') + 0.28, w: width - 0.48, h: 0.38, fontFace: stringToken(t, 'font_face'), fontSize: numberToken(t, 'type', 'body_pt'), color: t.color.ink, bold: true });
      addBody(slide, group.blocks, x + 0.24, numberToken(t, 'layout', 'content_y') + 0.86, width - 0.48, 2.76, t);
    });
    addFooter(slide, source, planned.number, t);
  } else throw new Error(`No Brief Ink PPTX renderer is implemented for template ${planned.template}.`);
}

export async function renderBriefInkPptxV1({ deck, plan, config, runtime }: PptxRenderContext): Promise<Uint8Array> {
  const t = tokens(config);
  const pptx: PptxPresentation = runtime.createPresentation();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Slide Skill';
  pptx.company = 'Slide Skill';
  pptx.subject = 'Native editable PPTX POC';
  pptx.title = deck.meta.title ?? 'Presentation';
  pptx.lang = 'en-US';
  plan.slides.forEach((planned, index) => {
    const source = deck.slides[index];
    if (!source || !planned.renderable || !planned.template) throw new Error(`PPTX Render Plan contains an unrenderable slide at position ${index + 1}.`);
    const slide = pptx.addSlide();
    slide.background = { color: t.color.paper };
    renderSlide(slide, source, deck, planned, t);
  });
  const result = await pptx.write({ outputType: 'uint8array', compression: true });
  if (!(result instanceof Uint8Array)) throw new Error('PptxGenJS did not return a Uint8Array package.');
  return result;
}
