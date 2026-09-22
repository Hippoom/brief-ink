import { parse as parseYaml } from 'yaml';
import type { Deck, DeckMeta, Diagnostic, ParseResult, Slide, SlideMeta } from './types.js';

const slideHeading = /^##\s+Slide\s+(\d+)\s+—\s+(.+?)\s*$/;
const blockHeading = /^\*\*(Subtitle|Context|Key Message|Content|Speaker Notes|Footnotes)\*\*\s*$/;

function diagnostic(severity: Diagnostic['severity'], code: string, message: string, line: number, suggestion?: string): Diagnostic {
  return { severity, code, message, suggestion, location: { line } };
}

function parseFrontmatter(lines: string[], diagnostics: Diagnostic[]): { meta: DeckMeta; bodyStart: number } {
  if (lines[0]?.trim() !== '---') {
    diagnostics.push(diagnostic('error', 'missing-frontmatter', 'Deck must start with YAML frontmatter.', 1, 'Start the file with `---`, then include `schema: slide-deck/v1`.'));
    return { meta: {}, bodyStart: 0 };
  }
  const closing = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (closing === -1) {
    diagnostics.push(diagnostic('error', 'unclosed-frontmatter', 'Deck frontmatter is not closed.', 1, 'Add a closing `---` line after deck metadata.'));
    return { meta: {}, bodyStart: lines.length };
  }
  const closingIndex = closing + 1;
  try {
    const parsed = parseYaml(lines.slice(1, closingIndex).join('\n'));
    if (parsed !== null && typeof parsed !== 'object') {
      diagnostics.push(diagnostic('error', 'invalid-frontmatter', 'Deck frontmatter must be a YAML mapping.', 1));
      return { meta: {}, bodyStart: closingIndex + 1 };
    }
    return { meta: (parsed ?? {}) as DeckMeta, bodyStart: closingIndex + 1 };
  } catch (error) {
    diagnostics.push(diagnostic('error', 'invalid-frontmatter', `Could not parse deck frontmatter: ${(error as Error).message}`, 1));
    return { meta: {}, bodyStart: closingIndex + 1 };
  }
}

function parseSlideMeta(lines: string[], start: number, diagnostics: Diagnostic[]): { meta: SlideMeta | null; next: number } {
  let metaStart = start;
  while (metaStart < lines.length && lines[metaStart].trim() === '') metaStart += 1;
  if (lines[metaStart]?.trim() !== '```slide-meta') {
    diagnostics.push(diagnostic('error', 'missing-slide-meta', 'Every slide requires a `slide-meta` fenced block immediately after its title.', metaStart + 1, 'Insert a `slide-meta` block after the slide title.'));
    return { meta: null, next: metaStart };
  }
  const end = lines.slice(metaStart + 1).findIndex((line) => line.trim() === '```');
  if (end === -1) {
    diagnostics.push(diagnostic('error', 'unclosed-slide-meta', 'The `slide-meta` block is not closed.', metaStart + 1, 'Add a closing fence after slide metadata.'));
    return { meta: null, next: lines.length };
  }
  const endIndex = metaStart + 1 + end;
  try {
    const parsed = parseYaml(lines.slice(metaStart + 1, endIndex).join('\n'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      diagnostics.push(diagnostic('error', 'invalid-slide-meta', '`slide-meta` must be a YAML mapping.', metaStart + 1));
      return { meta: null, next: endIndex + 1 };
    }
    return { meta: parsed as SlideMeta, next: endIndex + 1 };
  } catch (error) {
    diagnostics.push(diagnostic('error', 'invalid-slide-meta', `Could not parse slide metadata: ${(error as Error).message}`, metaStart + 1));
    return { meta: null, next: endIndex + 1 };
  }
}

function parseSlide(lines: string[], headingIndex: number, end: number, diagnostics: Diagnostic[]): Slide {
  const match = lines[headingIndex].match(slideHeading);
  const number = match ? Number(match[1]) : null;
  const title = match?.[2]?.trim() ?? lines[headingIndex].replace(/^##\s*/, '').trim();
  const { meta, next } = parseSlideMeta(lines, headingIndex + 1, diagnostics);
  const blocks: Record<string, { text: string; line: number }> = {};
  let index = next;

  while (index < end) {
    const heading = lines[index].match(blockHeading);
    if (!heading) {
      index += 1;
      continue;
    }
    const label = heading[1];
    const blockStart = index + 1;
    index += 1;
    while (index < end && !blockHeading.test(lines[index])) index += 1;
    const text = lines.slice(blockStart, index).join('\n').replace(/\n?---\s*$/m, '').replace(/^\s+|\s+$/g, '');
    if (blocks[label]) diagnostics.push(diagnostic('error', 'duplicate-fixed-block', `Slide has more than one **${label}** block.`, blockStart, 'Keep exactly one block with this label.'));
    blocks[label] = { text, line: blockStart + 1 };
  }

  return {
    number,
    title,
    meta,
    subtitle: blocks.Subtitle?.text,
    context: blocks.Context?.text,
    keyMessage: blocks['Key Message']?.text,
    content: blocks.Content?.text,
    speakerNotes: blocks['Speaker Notes']?.text,
    footnotes: blocks.Footnotes?.text,
    sourceLine: headingIndex + 1,
    blockLines: {
      subtitle: blocks.Subtitle?.line,
      context: blocks.Context?.line,
      keyMessage: blocks['Key Message']?.line,
      content: blocks.Content?.line,
      speakerNotes: blocks['Speaker Notes']?.line,
      footnotes: blocks.Footnotes?.line,
    },
  };
}

export function parseDeck(source: string, sourcePath?: string): ParseResult {
  const diagnostics: Diagnostic[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const { meta, bodyStart } = parseFrontmatter(lines, diagnostics);
  const headings: number[] = [];
  for (let index = bodyStart; index < lines.length; index += 1) if (lines[index].startsWith('## ')) headings.push(index);
  const slides: Slide[] = [];
  for (let index = 0; index < headings.length; index += 1) slides.push(parseSlide(lines, headings[index], headings[index + 1] ?? lines.length, diagnostics));
  const deck: Deck = { meta, slides, sourcePath };
  return { deck, diagnostics };
}
