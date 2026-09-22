const layoutMap: Record<string, string> = {
  insight: 'narrative',
  bullets: 'narrative',
  cards: 'grouped-items',
  comparison: 'comparison',
  process: 'sequence',
  architecture: 'layers',
  table: 'table',
  chart: 'chart',
  'ecosystem flow': 'relationship-map',
};

export interface MigrationResult {
  markdown: string;
  messages: string[];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'slide';
}

function extractLegacyBlock(source: string, label: string): string | undefined {
  const expression = new RegExp(`(?:^|\\n)(?:>\\s*)?${label}:\\s*([^\\n]+)`, 'i');
  return source.match(expression)?.[1]?.trim();
}

export function migrateLegacy(source: string): MigrationResult {
  const messages: string[] = [];
  const sections = source.split(/(?=^#\s+)/m).filter((part) => part.trim());
  const slides: string[] = [];
  const usedIds = new Set<string>();

  sections.forEach((section, index) => {
    const lines = section.trim().split('\n');
    const title = lines[0].replace(/^#\s+/, '').trim();
    const rawLayout = extractLegacyBlock(section, 'Layout');
    const rawSection = extractLegacyBlock(section, 'Section') ?? 'unclassified';
    const keyMessage = extractLegacyBlock(section, 'Key Message');
    const normalizedLayout = rawLayout?.toLowerCase();
    const structure = normalizedLayout ? layoutMap[normalizedLayout] ?? 'REVIEW_REQUIRED' : 'REVIEW_REQUIRED';
    let id = slug(title);
    let suffix = 2;
    while (usedIds.has(id)) id = `${slug(title)}-${suffix++}`;
    usedIds.add(id);

    if (structure === 'REVIEW_REQUIRED') messages.push(`REVIEW REQUIRED: Slide ${index + 1} legacy Layout '${rawLayout ?? 'missing'}' needs a supported v1 structure.`);
    else if (rawLayout) messages.push(`MAPPED: Slide ${index + 1} Layout '${rawLayout}' -> structure '${structure}'.`);

    const excluded = /^(#\s+|Section:|>\s*Key Message:|Key Message:|Layout:|Layout cue:|Footnotes:|Speaker Notes:)/i;
    const body = lines.slice(1).filter((line) => !excluded.test(line)).join('\n').replace(/^\s+|\s+$/g, '');
    slides.push(`## Slide ${index + 1} — ${title}\n\n\`\`\`slide-meta\nid: ${id}\nkind: content\nsection: ${slug(rawSection)}\nstructure: ${structure}\n\`\`\`\n\n**Key Message**\n\n${keyMessage ?? 'TODO: Add a one-sentence takeaway.'}\n\n**Content**\n\n${body || 'TODO: Add visible supporting content.'}\n`);
  });

  const markdown = `---\nschema: slide-deck/v1\ntitle: Migrated deck\nsource_status: draft\n---\n\n${slides.join('\n---\n\n')}`;
  return { markdown, messages };
}
