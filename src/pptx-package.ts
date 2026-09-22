import { createHash } from 'node:crypto';
import { extname, join, posix, resolve } from 'node:path';
import { PptxPackage } from './targets/pptx/package-runtime.js';

/**
 * Runtime-neutral facts reported after inspecting a PPTX ZIP/OPC package.
 * This contract intentionally carries no theme, renderer, font, master, or
 * delivery-policy interpretation; consumers apply those policies separately.
 */
export interface PptxPackageInspection {
  schema: 'slide-pptx-package-inspection/v1';
  bytes: { byteLength: number; sha256: string };
  zip: { valid: boolean; entryCount: number; fileCount: number };
  opc: { valid: boolean; requiredParts: string[]; missingParts: string[] };
  parts: { files: string[]; directories: string[]; xml: string[]; relationships: string[]; media: PptxMediaPart[] };
  xml: { wellFormed: boolean; malformedParts: string[] };
  relationships: { entries: PptxRelationship[]; external: PptxRelationship[] };
  slideCount: number;
  geometry?: PptxGeometry;
  slides: PptxSlideInspection[];
  issues: PptxPackageIssue[];
}

export interface PptxPackageIssue {
  code: 'pptx-package-invalid' | 'pptx-package-missing-part' | 'pptx-part-read-failed' | 'pptx-xml-malformed' | 'pptx-layout-missing';
  message: string;
  part?: string;
}

export interface PptxGeometry {
  widthEmu: number;
  heightEmu: number;
}

export interface PptxMediaPart {
  name: string;
  byteSize: number;
}

export interface PptxRelationship {
  sourcePart: string;
  id?: string;
  type?: string;
  target: string;
  targetMode?: string;
  resolvedTarget?: string;
}

export interface PptxSlideInspection {
  index: number;
  part: string;
  drawingMlText: string[];
  drawingMlTypefaces: string[];
  hasRasterPicture: boolean;
  imageRelationship: boolean;
  mediaParts: string[];
  externalRelationships: PptxRelationship[];
}

export interface PptxArtifacts {
  pptxPath: string;
  qaPath: string;
}

const REQUIRED_OPC_PARTS = ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'];

function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function plain(value: string): string {
  return decodeXml(value).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/\s+/g, ' ').trim();
}

function xmlWellFormed(xml: string): boolean {
  const stack: string[] = [];
  const tags = xml.match(/<!--[\s\S]*?-->|<\?.*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>/g) ?? [];
  for (const tag of tags) {
    if (tag.startsWith('<!--') || tag.startsWith('<?') || tag.startsWith('<![') || tag.startsWith('<!DOCTYPE')) continue;
    const closing = /^<\/([\w:.-]+)>$/.exec(tag);
    if (closing) {
      if (stack.pop() !== closing[1]) return false;
      continue;
    }
    const opening = /^<([\w:.-]+)(?:\s[^>]*)?\/?\>$/.exec(tag);
    if (!opening) return false;
    if (!tag.endsWith('/>')) stack.push(opening[1]);
  }
  return stack.length === 0;
}

function presentationGeometry(xml: string): PptxGeometry | undefined {
  const element = /<p:sldSz\b([^>]*)\/?>(?:<\/p:sldSz>)?/.exec(xml)?.[1];
  if (!element) return undefined;
  const width = /\bcx="(\d+)"/.exec(element)?.[1];
  const height = /\bcy="(\d+)"/.exec(element)?.[1];
  if (!width || !height) return undefined;
  return { widthEmu: Number(width), heightEmu: Number(height) };
}

function relationshipSourcePart(relationshipPart: string): string {
  if (relationshipPart === '_rels/.rels') return '';
  const match = /^(.*)\/_rels\/([^/]+)\.rels$/.exec(relationshipPart);
  return match ? `${match[1]}/${match[2]}` : relationshipPart;
}

function resolveRelationshipTarget(sourcePart: string, target: string, targetMode?: string): string | undefined {
  if (targetMode?.toLowerCase() === 'external') return undefined;
  const base = sourcePart ? posix.dirname(sourcePart) : '';
  return posix.normalize(posix.join(base, target)).replace(/^\.\//, '').replace(/^\//, '');
}

function relationshipEntries(xml: string, sourcePart: string): PptxRelationship[] {
  return [...xml.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)].map((match) => {
    const attributes = match[1];
    const read = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];
    const target = read('Target') ?? '';
    const targetMode = read('TargetMode');
    return {
      sourcePart,
      id: read('Id'),
      type: read('Type'),
      target,
      targetMode,
      resolvedTarget: resolveRelationshipTarget(sourcePart, target, targetMode),
    };
  });
}

function drawingMlText(xml: string): string[] {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => plain(match[1])).filter(Boolean);
}

function drawingMlTypefaces(xml: string): string[] {
  return [...xml.matchAll(/<(?:a:latin|a:ea|a:cs)\b[^>]*\btypeface="([^"]*)"[^>]*\/?>(?:<\/(?:a:latin|a:ea|a:cs)>)?/g)]
    .map((match) => decodeXml(match[1]).trim())
    .filter(Boolean);
}

function genericIssue(issues: PptxPackageIssue[], code: PptxPackageIssue['code'], message: string, part?: string): void {
  issues.push({ code, message, ...(part ? { part } : {}) });
}

/** Inspect PPTX bytes using the approved target package runtime only. */
export async function inspectPptxPackage(bytes: Uint8Array): Promise<PptxPackageInspection> {
  const issues: PptxPackageIssue[] = [];
  const inspection: PptxPackageInspection = {
    schema: 'slide-pptx-package-inspection/v1',
    bytes: { byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') },
    zip: { valid: false, entryCount: 0, fileCount: 0 },
    opc: { valid: false, requiredParts: [...REQUIRED_OPC_PARTS], missingParts: [] },
    parts: { files: [], directories: [], xml: [], relationships: [], media: [] },
    xml: { wellFormed: true, malformedParts: [] },
    relationships: { entries: [], external: [] },
    slideCount: 0,
    slides: [],
    issues,
  };

  let zip: PptxPackage;
  try {
    zip = await PptxPackage.loadAsync(bytes);
  } catch (error) {
    genericIssue(issues, 'pptx-package-invalid', `PPTX bytes are not a valid ZIP package: ${(error as Error).message}`);
    return inspection;
  }

  inspection.zip.valid = true;
  const names = Object.keys(zip.files).sort();
  inspection.zip.entryCount = names.length;
  inspection.parts.directories = names.filter((name) => zip.files[name]?.dir);
  inspection.parts.files = names.filter((name) => !zip.files[name]?.dir);
  inspection.zip.fileCount = inspection.parts.files.length;
  inspection.parts.xml = inspection.parts.files.filter((name) => name.endsWith('.xml'));
  inspection.parts.relationships = inspection.parts.files.filter((name) => name.endsWith('.rels'));

  for (const required of REQUIRED_OPC_PARTS) {
    if (!zip.file(required)) {
      inspection.opc.missingParts.push(required);
      genericIssue(issues, 'pptx-package-missing-part', `PPTX package is missing required OPC part ${required}.`, required);
    }
  }
  inspection.opc.valid = inspection.opc.missingParts.length === 0;

  const xmlByPart = new Map<string, string>();
  for (const name of [...inspection.parts.xml, ...inspection.parts.relationships]) {
    try {
      const xml = await zip.file(name)!.async('string');
      xmlByPart.set(name, xml);
      if (!xmlWellFormed(xml)) {
        inspection.xml.wellFormed = false;
        inspection.xml.malformedParts.push(name);
        genericIssue(issues, 'pptx-xml-malformed', `PPTX package contains malformed XML in ${name}.`, name);
      }
    } catch (error) {
      genericIssue(issues, 'pptx-part-read-failed', `PPTX package could not read ${name}: ${(error as Error).message}`, name);
    }
  }

  for (const name of inspection.parts.relationships) {
    const xml = xmlByPart.get(name);
    if (!xml) continue;
    inspection.relationships.entries.push(...relationshipEntries(xml, relationshipSourcePart(name)));
  }
  inspection.relationships.external = inspection.relationships.entries.filter((relationship) => relationship.targetMode?.toLowerCase() === 'external');

  const presentation = xmlByPart.get('ppt/presentation.xml');
  if (presentation) {
    inspection.geometry = presentationGeometry(presentation);
    if (!inspection.geometry) genericIssue(issues, 'pptx-layout-missing', 'PPTX presentation has no readable slide-size declaration.', 'ppt/presentation.xml');
  }

  const mediaNames = inspection.parts.files.filter((name) => name.startsWith('ppt/media/'));
  inspection.parts.media = await Promise.all(mediaNames.map(async (name) => ({
    name,
    byteSize: (await zip.file(name)!.async('uint8array')).byteLength,
  })));

  const slideFiles = inspection.parts.files.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  inspection.slideCount = slideFiles.length;
  inspection.slides = slideFiles.map((part, index) => {
    const xml = xmlByPart.get(part) ?? '';
    const slideRelationships = inspection.relationships.entries.filter((relationship) => relationship.sourcePart === part);
    const imageRelationships = slideRelationships.filter((relationship) => /\/relationships\/image$/.test(relationship.type ?? ''));
    return {
      index,
      part,
      drawingMlText: drawingMlText(xml),
      drawingMlTypefaces: drawingMlTypefaces(xml),
      hasRasterPicture: /<p:pic\b/.test(xml),
      imageRelationship: imageRelationships.length > 0,
      mediaParts: imageRelationships.map((relationship) => relationship.resolvedTarget).filter((target): target is string => Boolean(target)),
      externalRelationships: slideRelationships.filter((relationship) => relationship.targetMode?.toLowerCase() === 'external'),
    };
  });

  return inspection;
}

/** Resolve artifact names without coupling the helper to a renderer configuration. */
export function resolvePptxArtifactPaths(defaultDirectory: string, requestedOutput?: string): PptxArtifacts {
  if (!requestedOutput) return { pptxPath: join(defaultDirectory, 'index.pptx'), qaPath: join(defaultDirectory, 'pptx.qa.json') };
  const pptxPath = resolve(requestedOutput);
  if (extname(pptxPath).toLowerCase() !== '.pptx') throw new Error('PPTX output path must use the .pptx extension.');
  return { pptxPath, qaPath: `${pptxPath.slice(0, -'.pptx'.length)}.pptx.qa.json` };
}
