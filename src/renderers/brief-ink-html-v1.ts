import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { Deck, ExploreConvergeCyclesPayload, RenderPlan, ResolvedRenderConfig, Slide } from '../types.js';

type PrimarySupportingContextPayload = {
  primary: { id: string; label?: string; statement: string; self_sufficient: true };
  primary_groups?: Array<{ id: string; label: string; items: string[] }>;
  supporting_contexts: Array<{
    id: string;
    label: string;
    statement: string;
    supports_primary_id: string;
    support_relation: 'illustration' | 'example' | 'evidence' | 'action' | 'reference';
    material: { status: 'asset' | 'placeholder'; asset_id?: string };
  }>;
  continuity?: { id: string; label: string; from_supporting_context_id: string; to_supporting_context_id: string };
  primary_groups_relation?: 'parallel' | 'sequence';
  callout?: { id: string; label: string; quote?: string; statement: string };
};

interface ThemeTokens {
  canvas: { width: number; height: number; safe_margin: number };
  color: Record<string, string>;
  type: Record<string, string | number>;
  space: Record<string, number>;
  shape: Record<string, string | number>;
}

const defaultTokens: ThemeTokens = {
  canvas: { width: 1600, height: 900, safe_margin: 72 },
  color: { paper: 'F8F6F1', surface: 'FFFFFF', ink: '17212B', muted: '607080', subtle: '87929D', border: 'D8DEE3', accent: '247A82', accent_soft: 'E1F0EF', accent_deep: '1A5961', positive: '2E7D5B', warning: 'A96818', negative: 'A74646' },
  type: { sans: 'Inter, "PingFang SC", "Microsoft YaHei", Arial, sans-serif', title_px: 40, key_message_px: 19, section_px: 13, body_px: 18, label_px: 15, footnote_px: 12 },
  space: { xs: 8, sm: 16, md: 24, lg: 36, xl: 52 },
  shape: { radius: 8, border_px: 1, shadow: 'none' },
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function inline(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/¹/g, '<sup>1</sup>').replace(/²/g, '<sup>2</sup>').replace(/³/g, '<sup>3</sup>');
}

function renderTable(lines: string[]): string {
  const rows = lines.map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
  const header = rows[0] ?? [];
  const body = rows.slice(2);
  return `<table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function markdown(content = ''): string {
  const lines = content.split('\n');
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (/^\|.+\|\s*$/.test(line) && /^\|\s*:?-{3,}/.test(lines[index + 1] ?? '')) {
      const tableLines: string[] = [];
      while (index < lines.length && /^\|.+\|\s*$/.test(lines[index])) tableLines.push(lines[index++]);
      blocks.push(renderTable(tableLines));
      continue;
    }
    const heading = /^(#{3,})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(`<h3>${inline(heading[2])}</h3>`); index += 1; continue; }
    const ordered: string[] = [];
    if (/^\s*\d+[.)]\s+/.test(line)) {
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) ordered.push(lines[index++].replace(/^\s*\d+[.)]\s+/, ''));
      blocks.push(`<ol>${ordered.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`); continue;
    }
    const bullets: string[] = [];
    if (/^\s*[-*+]\s+/.test(line)) {
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) bullets.push(lines[index++].replace(/^\s*[-*+]\s+/, ''));
      blocks.push(`<ul>${bullets.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`); continue;
    }
    if (/^>\s?/.test(line)) { blocks.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`); index += 1; continue; }
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{3,}\s+|\||\s*[-*+]\s+|\s*\d+[.)]\s+|>\s?)/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  return blocks.join('\n');
}

function groups(content: string): Array<{ heading: string; body: string }> {
  const parts = content.split(/^###\s+(.+)$/m);
  const result: Array<{ heading: string; body: string }> = [];
  for (let i = 1; i < parts.length; i += 2) result.push({ heading: parts[i].trim(), body: parts[i + 1]?.trim() ?? '' });
  return result;
}

function header(slide: Slide): string {
  const section = typeof slide.meta?.section === 'string' ? `<div class="section-label">${inline(slide.meta.section.replace(/-/g, ' '))}</div>` : '';
  const key = slide.keyMessage ? `<p class="key-message">${inline(slide.keyMessage)}</p>` : '';
  return `<header class="slide-header">${section}<h1>${inline(slide.title)}</h1>${key}</header>`;
}

function footnotes(slide: Slide, number: number): string {
  const notes = slide.footnotes ? `<div class="footnotes">${markdown(slide.footnotes)}</div>` : '';
  return `<footer><span>${String(number).padStart(2, '0')}</span>${notes}</footer>`;
}

function slideAttributes(slide: Slide, planned: RenderPlan['slides'][number], index: number): string {
  return `data-qa-role="slide" data-slide-id="${escapeHtml(planned.slideId)}" data-slide-index="${index}" data-slide-number="${planned.number}" data-template="${escapeHtml(planned.template ?? '')}"`;
}

function cover(slide: Slide, deck: Deck, attributes: string): string {
  return `<article class="slide cover" ${attributes}><div class="cover-rule"></div><div class="cover-body"><div class="eyebrow">${inline(deck.meta.audience ?? 'Presentation')}</div><h1>${inline(slide.title)}</h1>${slide.subtitle ? `<p class="cover-subtitle">${inline(slide.subtitle)}</p>` : ''}</div><div class="cover-context">${slide.context ? inline(slide.context) : ''}</div></article>`;
}

function divider(slide: Slide, number: number, attributes: string): string {
  return `<article class="slide divider" ${attributes}><div class="divider-number">${String(number).padStart(2, '0')}</div><div class="divider-body"><div class="eyebrow">Section</div><h1>${inline(slide.title)}</h1>${slide.keyMessage ? `<p>${inline(slide.keyMessage)}</p>` : ''}</div></article>`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString);
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function exploreConvergeCyclesPayload(slide: Slide): ExploreConvergeCyclesPayload {
  const invalid = (): never => {
    throw new Error(`Renderer received invalid explore-converge-cycles payload for slide ${String(slide.meta?.id ?? slide.number)}.`);
  };
  const payload = slide.meta?.explore_converge_cycles ?? invalid();
  if (!hasOnlyKeys(payload, ['cycles', 'handoff']) || !Array.isArray(payload.cycles) || payload.cycles.length !== 2 || !isObject(payload.handoff)) invalid();

  const [focal, standard] = payload.cycles;
  const cycleKeys = ['id', 'label', 'emphasis', 'inputs', 'exploration_scope', 'convergence_outputs'];
  if (!isObject(focal) || !isObject(standard) || !hasOnlyKeys(focal, cycleKeys) || !hasOnlyKeys(standard, cycleKeys)) invalid();
  if (
    !nonEmptyString(focal.id) || !nonEmptyString(standard.id) || focal.id === standard.id ||
    !nonEmptyString(focal.label) || !nonEmptyString(standard.label) ||
    focal.emphasis !== 'focal' || standard.emphasis !== 'standard' ||
    !validStringList(focal.inputs) || !validStringList(focal.exploration_scope) || !validStringList(focal.convergence_outputs) ||
    !validStringList(standard.inputs) || !validStringList(standard.exploration_scope) || !validStringList(standard.convergence_outputs)
  ) invalid();

  const handoff = payload.handoff;
  if (
    !hasOnlyKeys(handoff, ['id', 'label', 'from_cycle_id', 'to_cycle_id']) ||
    !nonEmptyString(handoff.id) || !nonEmptyString(handoff.label) ||
    handoff.from_cycle_id !== focal.id || handoff.to_cycle_id !== standard.id
  ) invalid();

  return {
    cycles: [
      {
        id: focal.id,
        label: focal.label,
        emphasis: focal.emphasis,
        inputs: focal.inputs,
        exploration_scope: focal.exploration_scope,
        convergence_outputs: focal.convergence_outputs,
      },
      {
        id: standard.id,
        label: standard.label,
        emphasis: standard.emphasis,
        inputs: standard.inputs,
        exploration_scope: standard.exploration_scope,
        convergence_outputs: standard.convergence_outputs,
      },
    ],
    handoff: {
      id: handoff.id,
      label: handoff.label,
      from_cycle_id: handoff.from_cycle_id,
      to_cycle_id: handoff.to_cycle_id,
    },
  };
}

function primarySupportingContextPayload(slide: Slide): PrimarySupportingContextPayload {
  const invalid = (): never => {
    throw new Error(`Renderer received invalid primary-supporting-context payload for slide ${String(slide.meta?.id ?? slide.number)}.`);
  };
  const rawPayload: unknown = slide.meta?.primary_supporting_context ?? invalid();
  if (!isObject(rawPayload) || !hasOnlyKeys(rawPayload, ['primary', 'primary_groups', 'primary_groups_relation', 'supporting_contexts', 'continuity', 'callout']) || !isObject(rawPayload.primary) || !Array.isArray(rawPayload.supporting_contexts)) invalid();
  const payload = rawPayload as Record<string, unknown> & { primary: Record<string, unknown>; primary_groups?: unknown; primary_groups_relation?: unknown; supporting_contexts: unknown[]; continuity?: unknown; callout?: unknown };

  const primaryKeys = ['id', 'label', 'statement', 'self_sufficient'];
  const primary = payload.primary;
  if (!hasOnlyKeys(primary, primaryKeys) || !nonEmptyString(primary.id) || !nonEmptyString(primary.statement) || primary.self_sufficient !== true || (primary.label !== undefined && !nonEmptyString(primary.label))) invalid();

  let primaryGroups: NonNullable<PrimarySupportingContextPayload['primary_groups']> | undefined;
  const rawPrimaryGroups: unknown = payload.primary_groups;
  if (rawPrimaryGroups !== undefined) {
    if (!Array.isArray(rawPrimaryGroups)) invalid();
    const groups = rawPrimaryGroups as unknown[];
    const groupKeys = ['id', 'label', 'items'];
    primaryGroups = groups.map((rawGroup): NonNullable<PrimarySupportingContextPayload['primary_groups']>[number] => {
      if (!isObject(rawGroup) || !hasOnlyKeys(rawGroup, groupKeys) || !nonEmptyString(rawGroup.id) || !nonEmptyString(rawGroup.label) || !validStringList(rawGroup.items)) invalid();
      const group = rawGroup as Record<string, unknown>;
      return { id: group.id as string, label: group.label as string, items: group.items as string[] };
    });
    const groupsById = primaryGroups;
    if (new Set(groupsById.map((group) => group.id)).size !== groupsById.length || groupsById.some((group) => group.id === primary.id)) invalid();
  }

  let primaryGroupsRelation: PrimarySupportingContextPayload['primary_groups_relation'];
  if (payload.primary_groups_relation !== undefined) {
    if (!primaryGroups || !['parallel', 'sequence'].includes(String(payload.primary_groups_relation))) invalid();
    primaryGroupsRelation = payload.primary_groups_relation as PrimarySupportingContextPayload['primary_groups_relation'];
  }

  let callout: PrimarySupportingContextPayload['callout'];
  const rawCallout: unknown = payload.callout;
  if (rawCallout !== undefined) {
    const calloutKeys = ['id', 'label', 'quote', 'statement'];
    if (!isObject(rawCallout) || !hasOnlyKeys(rawCallout, calloutKeys) || !nonEmptyString(rawCallout.id) || !nonEmptyString(rawCallout.label) || !nonEmptyString(rawCallout.statement) || (rawCallout.quote !== undefined && !nonEmptyString(rawCallout.quote))) invalid();
    const decodedCallout = rawCallout as Record<string, unknown>;
    callout = { id: decodedCallout.id as string, label: decodedCallout.label as string, ...(decodedCallout.quote !== undefined ? { quote: decodedCallout.quote as string } : {}), statement: decodedCallout.statement as string };
  }

  const supportKeys = ['id', 'label', 'statement', 'supports_primary_id', 'support_relation', 'material'];
  const materialKeys = ['status', 'asset_id'];
  const relationValues = ['illustration', 'example', 'evidence', 'action', 'reference'];
  if (payload.supporting_contexts.length < 1 || payload.supporting_contexts.length > 2) invalid();
  const supports = payload.supporting_contexts.map((rawSupport): PrimarySupportingContextPayload['supporting_contexts'][number] => {
    if (!isObject(rawSupport) || !hasOnlyKeys(rawSupport, supportKeys) || !isObject(rawSupport.material) || !hasOnlyKeys(rawSupport.material, materialKeys)) invalid();
    const support = rawSupport as Record<string, unknown> & { material: Record<string, unknown> };
    if (!nonEmptyString(support.id) || !nonEmptyString(support.label) || !nonEmptyString(support.statement) || support.supports_primary_id !== primary.id || !relationValues.includes(String(support.support_relation))) invalid();
    const material = support.material;
    if (material.status === 'asset') {
      if (!nonEmptyString(material.asset_id)) invalid();
    } else if (material.status === 'placeholder') {
      if ('asset_id' in material) invalid();
    } else invalid();
    return {
      id: support.id as string,
      label: support.label as string,
      statement: support.statement as string,
      supports_primary_id: support.supports_primary_id as string,
      support_relation: support.support_relation as PrimarySupportingContextPayload['supporting_contexts'][number]['support_relation'],
      material: material.status === 'asset' ? { status: 'asset' as const, asset_id: material.asset_id as string } : { status: 'placeholder' as const },
    };
  });
  if (new Set(supports.map((support) => support.id)).size !== supports.length || supports.some((support) => support.id === primary.id)) invalid();
  const semanticIds = [primary.id as string, ...supports.map((support) => support.id), ...(primaryGroups?.map((group) => group.id) ?? []), ...(callout ? [callout.id] : [])];
  if (new Set(semanticIds).size !== semanticIds.length) invalid();

  const base: Omit<PrimarySupportingContextPayload, 'continuity'> = {
    primary: { id: primary.id as string, ...(primary.label !== undefined ? { label: primary.label as string } : {}), statement: primary.statement as string, self_sufficient: true as const },
    ...(primaryGroups ? { primary_groups: primaryGroups } : {}),
    ...(primaryGroupsRelation ? { primary_groups_relation: primaryGroupsRelation } : {}),
    supporting_contexts: supports,
    ...(callout ? { callout } : {}),
  };
  if (supports.length === 1) {
    if ('continuity' in payload) invalid();
    return base;
  }

  const rawContinuity: unknown = payload.continuity;
  if (!isObject(rawContinuity) || !hasOnlyKeys(rawContinuity, ['id', 'label', 'from_supporting_context_id', 'to_supporting_context_id']) || !nonEmptyString(rawContinuity.id) || !nonEmptyString(rawContinuity.label) || rawContinuity.from_supporting_context_id !== supports[0].id || rawContinuity.to_supporting_context_id !== supports[1].id || [primary.id as string, ...supports.map((support) => support.id)].includes(rawContinuity.id)) invalid();
  const continuity = rawContinuity as Record<string, string>;
  return {
    ...base,
    continuity: { id: continuity.id, label: continuity.label, from_supporting_context_id: continuity.from_supporting_context_id, to_supporting_context_id: continuity.to_supporting_context_id },
  };
}

function primarySupportingContextTemplate(slide: Slide): string {
  const payload = primarySupportingContextPayload(slide);
  const primaryTitleId = payload.primary.label ? `primary-${payload.primary.id}-title` : undefined;
  const primaryGroups = payload.primary_groups?.map((group, index) => {
    const titleId = `primary-group-${group.id}-title`;
    const ordinal = payload.primary_groups_relation === 'sequence' ? `<span class="primary-group-ordinal" aria-label="Step ${index + 1}">${index + 1}</span>` : '';
    return `<section class="primary-group" data-primary-group-id="${escapeHtml(group.id)}" aria-labelledby="${escapeHtml(titleId)}">${ordinal}<h3 id="${escapeHtml(titleId)}">${inline(group.label)}</h3><ul>${group.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul></section>`;
  }).join('') ?? '';
  const groupsRelation = payload.primary_groups_relation ? ` data-primary-groups-relation="${escapeHtml(payload.primary_groups_relation)}"` : '';
  const supports = payload.supporting_contexts.map((support) => {
    const titleId = `support-${support.id}-title`;
    const material = support.material.status === 'placeholder'
      ? '<div class="support-material-placeholder" role="note">Supporting material placeholder</div>'
      : '<div class="support-material-declared" role="note">Declared supporting material</div>';
    return `<section class="supporting-context" data-supporting-context-id="${escapeHtml(support.id)}" data-support-relation="${escapeHtml(support.support_relation)}" aria-labelledby="${escapeHtml(titleId)}"><div class="supporting-context-copy"><p class="context-relation">${inline(support.support_relation)}</p><h3 id="${escapeHtml(titleId)}">${inline(support.label)}</h3><p>${inline(support.statement)}</p></div>${material}</section>`;
  }).join('');
  const continuity = payload.continuity
    ? `<section class="supporting-continuity" data-continuity-id="${escapeHtml(payload.continuity.id)}"><span aria-hidden="true"></span><p>${inline(payload.continuity.label)}</p></section>`
    : '';
  const callout = payload.callout
    ? `<section class="primary-supporting-callout" data-callout-id="${escapeHtml(payload.callout.id)}"><p class="callout-label">${inline(payload.callout.label)}</p>${payload.callout.quote ? `<blockquote class="callout-quote">${inline(payload.callout.quote)}</blockquote>` : ''}<p class="callout-statement">${inline(payload.callout.statement)}</p></section>`
    : '';
  const primaryHeading = payload.primary.label && primaryTitleId ? `<h2 id="${escapeHtml(primaryTitleId)}">${inline(payload.primary.label)}</h2>` : '';
  const primaryAria = primaryTitleId ? ` aria-labelledby="${escapeHtml(primaryTitleId)}"` : ' aria-label="Primary argument"';
  return `<div class="primary-supporting-context"><section class="primary-context" data-primary-id="${escapeHtml(payload.primary.id)}"${primaryAria}><p class="primary-kicker">Primary argument</p>${primaryHeading}<p>${inline(payload.primary.statement)}</p>${primaryGroups ? `<div class="primary-groups"${groupsRelation}>${primaryGroups}</div>` : ''}</section><div class="supporting-contexts count-${payload.supporting_contexts.length}">${supports}</div>${continuity}${callout}</div>`;
}

function flowLabels(language: unknown): {
  focalCycle: string;
  standardCycle: string;
  inputs: string;
  exploration: string;
  convergence: string;
  handoff: string;
} {
  if (typeof language === 'string' && /^zh(?:-|$)/i.test(language)) {
    return {
      focalCycle: '主要探索—收敛周期',
      standardCycle: '后续探索—收敛周期',
      inputs: '输入',
      exploration: '探索范围',
      convergence: '收敛输出',
      handoff: '命名交接',
    };
  }
  return {
    focalCycle: 'Primary exploration–convergence cycle',
    standardCycle: 'Follow-on exploration–convergence cycle',
    inputs: 'Inputs',
    exploration: 'Exploration scope',
    convergence: 'Convergence outputs',
    handoff: 'Named handoff',
  };
}

function semanticList(label: string, items: string[], field: 'inputs' | 'exploration' | 'convergence'): string {
  return `<section class="cycle-stage-panel cycle-field cycle-${field}"><h3>${label}</h3><ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul></section>`;
}

function cycleModule(
  cycle: ExploreConvergeCyclesPayload['cycles'][number],
  position: 'focal' | 'standard',
  labels: ReturnType<typeof flowLabels>,
): string {
  const titleId = `cycle-${cycle.id}-title`;
  return `<section class="cycle cycle-${position}" data-cycle-id="${escapeHtml(cycle.id)}" aria-labelledby="${escapeHtml(titleId)}">
    <header class="cycle-heading">
      <div class="cycle-kicker">${position === 'focal' ? labels.focalCycle : labels.standardCycle}</div>
      <h2 id="${escapeHtml(titleId)}">${inline(cycle.label)}</h2>
    </header>
    <div class="cycle-stage-grid">
      ${semanticList(labels.inputs, cycle.inputs, 'inputs')}
      ${semanticList(labels.exploration, cycle.exploration_scope, 'exploration')}
      ${semanticList(labels.convergence, cycle.convergence_outputs, 'convergence')}
    </div>
  </section>`;
}

function exploreConvergeCyclesTemplate(slide: Slide, deck: Deck): string {
  const payload = exploreConvergeCyclesPayload(slide);
  const [focal, standard] = payload.cycles;
  const labels = flowLabels(deck.meta.language);
  const handoffId = `handoff-${payload.handoff.id}`;
  return `<div class="explore-converge-cycles">${cycleModule(focal, 'focal', labels)}<section class="cycle-handoff" data-handoff-id="${escapeHtml(payload.handoff.id)}" aria-labelledby="${escapeHtml(handoffId)}"><span class="handoff-arrow" aria-hidden="true"></span><div><p class="handoff-label">${labels.handoff}</p><p id="${escapeHtml(handoffId)}">${inline(payload.handoff.label)}</p></div></section>${cycleModule(standard, 'standard', labels)}</div>`;
}

function contentTemplate(slide: Slide, deck: Deck, number: number, template: string, attributes: string): string {
  const structure = slide.meta?.structure;
  const content = slide.content ?? '';
  let body = '';
  if (template === 'grouped-items') {
    const items = groups(content);
    body = `<div class="group-grid count-${items.length}">${items.map((item) => `<section class="group-card"><h3>${inline(item.heading)}</h3>${markdown(item.body)}</section>`).join('')}</div>`;
  } else if (template === 'comparison') {
    const items = groups(content);
    body = `<div class="comparison-grid">${items.map((item) => `<section class="comparison-column"><h3>${inline(item.heading)}</h3>${markdown(item.body)}</section>`).join('')}</div>`;
  } else if (template === 'sequence') {
    const phases = content.split(/^\s*\d+[.)]\s+/m).slice(1);
    body = `<div class="sequence">${phases.map((phase, i) => `<section class="phase"><div class="phase-number">${i + 1}</div><div>${markdown(phase.trim())}</div></section>`).join('')}</div>`;
  } else if (template === 'layers') {
    const items = groups(content);
    body = `<div class="layers">${items.map((item, i) => `<section class="layer layer-${i + 1}"><h3>${inline(item.heading)}</h3>${markdown(item.body)}</section>`).join('')}</div>`;
  } else if (template === 'table') {
    body = `<div class="table-wrap">${markdown(content)}</div>`;
  } else if (template === 'explore-converge-cycles') {
    if (structure !== 'explore-converge-cycles') throw new Error(`Template ${template} does not match structure ${String(structure)}.`);
    body = exploreConvergeCyclesTemplate(slide, deck);
  } else if (template === 'primary-supporting-context') {
    if (structure !== 'primary-supporting-context') throw new Error(`Template ${template} does not match structure ${String(structure)}.`);
    body = primarySupportingContextTemplate(slide);
  } else if (template === 'narrative') {
    body = `<div class="narrative">${markdown(content)}</div>`;
  } else {
    throw new Error(`No HTML renderer template is implemented for planned template ${template}.`);
  }
  return `<article class="slide content structure-${escapeHtml(structure ?? 'narrative')}" ${attributes}>${header(slide)}<main class="slide-content">${body}</main>${footnotes(slide, number)}</article>`;
}

function css(tokens: ThemeTokens): string {
  const variables = [
    ...Object.entries(tokens.color).map(([key, value]) => `--${key.replace(/_/g, '-')}: #${value};`),
    ...Object.entries(tokens.space).map(([key, value]) => `--space-${key}: ${value}px;`),
    ...Object.entries(tokens.type).map(([key, value]) => `--type-${key.replace(/_/g, '-')}: ${value}${typeof value === 'number' ? 'px' : ''};`),
    `--safe-margin: ${tokens.canvas.safe_margin}px;`, `--radius: ${tokens.shape.radius}px;`,
  ].join('\n');
  return `
:root { ${variables} }
* { box-sizing: border-box; }
body { margin: 0; background: #e7e8e6; color: var(--ink); font-family: var(--type-sans); }
.deck { display: grid; gap: 28px; padding: 28px; justify-content: center; }
.slide { position: relative; width: ${tokens.canvas.width}px; height: ${tokens.canvas.height}px; overflow: hidden; background: var(--paper); padding: var(--safe-margin); display: flex; flex-direction: column; }
.slide-header { max-width: 1280px; }
.section-label, .eyebrow { color: var(--accent-deep); text-transform: uppercase; letter-spacing: .12em; font-size: var(--type-section-px); font-weight: 700; margin-bottom: var(--space-sm); }
h1 { font-size: var(--type-title-px); line-height: 1.12; letter-spacing: -.028em; margin: 0; max-width: 1220px; font-weight: 750; }
.key-message { color: var(--muted); font-size: var(--type-key-message-px); line-height: 1.42; margin: var(--space-sm) 0 0; max-width: 1160px; }
.slide-content { flex: 1; min-height: 0; padding-top: var(--space-lg); display: flex; }
p, li { font-size: var(--type-body-px); line-height: 1.46; }
p { margin: 0 0 var(--space-sm); }
ul, ol { margin: 0; padding-left: 1.3em; display: grid; gap: 12px; }
li::marker { color: var(--accent); }
h3 { font-size: 20px; line-height: 1.2; margin: 0 0 var(--space-sm); font-weight: 750; }
footer { min-height: 24px; color: var(--subtle); display: flex; align-items: end; gap: 24px; font-size: var(--type-footnote-px); }
footer > span { order: 2; margin-left: auto; color: var(--subtle); font-size: 12px; letter-spacing: .08em; }
.footnotes { order: 1; max-width: 1180px; margin-right: auto; }.footnotes p, .footnotes li { font-size: var(--type-footnote-px); line-height: 1.3; margin: 0; }.footnotes ul,.footnotes ol { gap: 2px; }
.cover { background: var(--ink); color: var(--paper); padding: 94px var(--safe-margin) var(--safe-margin); justify-content: space-between; }.cover-rule { width: 94px; height: 8px; background: var(--accent); }.cover h1 { font-size: 64px; max-width: 1120px; }.cover-body { margin-top: auto; margin-bottom: auto; }.cover .eyebrow { color: #a8d3d0; }.cover-subtitle { font-size: 27px; line-height: 1.35; max-width: 890px; color: #d9e0df; margin-top: var(--space-md); }.cover-context { font-size: 15px; color: #aeb8b8; }
.divider { background: var(--accent-soft); flex-direction: row; align-items: stretch; gap: 72px; }.divider-number { font-size: 190px; line-height: .78; color: var(--accent); font-weight: 750; letter-spacing: -.08em; }.divider-body { align-self: center; max-width: 1040px; }.divider h1 { font-size: 54px; }.divider p { font-size: 23px; color: var(--muted); margin-top: var(--space-md); max-width: 900px; }
.narrative { width: min(1050px, 100%); }.narrative ul { gap: 18px; }.narrative li { padding-left: 8px; }
.group-grid { width: 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-md); align-content: start; }.group-grid.count-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }.group-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 26px 28px; }.group-card h3 { color: var(--accent-deep); }.group-card ul { gap: 8px; }.group-card li { font-size: 16px; }
.comparison-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); width: 100%; gap: 0; border-top: 3px solid var(--ink); }.comparison-column { padding: 26px 34px; border-bottom: 1px solid var(--border); }.comparison-column + .comparison-column { border-left: 1px solid var(--border); }.comparison-column h3 { color: var(--accent-deep); }.comparison-column li { font-size: 17px; }
.sequence { width: 100%; display: grid; grid-template-columns: repeat(4, 1fr); align-items: start; gap: 0; margin-top: 35px; }.phase { position: relative; padding: 0 24px 0 0; min-height: 210px; border-top: 3px solid var(--accent); }.phase:not(:last-child)::after { content: ''; position: absolute; top: -2px; right: 0; width: 24px; border-top: 1px solid var(--accent); }.phase + .phase { padding-left: 24px; }.phase-number { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; background: var(--accent); color: white; font-size: 16px; font-weight: 750; margin-top: -21px; margin-bottom: 27px; }.phase p { font-size: 17px; }
.layers { width: 100%; display: grid; gap: 10px; align-content: center; }.layer { border-left: 8px solid var(--accent); background: var(--surface); border-top: 1px solid var(--border); border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); padding: 20px 28px; }.layer h3 { margin-bottom: 6px; }.layer p, .layer li { font-size: 16px; }.layer-2 { margin-left: 58px; border-left-color: var(--accent-deep); }.layer-3 { margin-left: 116px; border-left-color: var(--ink); }
.table-wrap { width: 100%; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius); align-self: flex-start; }table { width: 100%; border-collapse: collapse; table-layout: fixed; }th { text-align: left; color: var(--paper); background: var(--ink); font-size: 15px; padding: 16px 18px; }td { font-size: 15px; line-height: 1.35; padding: 17px 18px; border-top: 1px solid var(--border); vertical-align: top; }tr:nth-child(even) td { background: #f0f1ef; }
.explore-converge-cycles { width: 100%; display: grid; gap: 14px; align-content: start; align-self: center; }.cycle { min-width: 0; display: grid; gap: 10px; }.cycle-heading { min-width: 0; padding-top: 10px; border-top: 1px solid var(--ink); }.cycle-kicker, .handoff-label { color: var(--accent-deep); text-transform: uppercase; letter-spacing: .1em; font-size: 11px; font-weight: 750; }.cycle h2 { margin: 8px 0 0; font-size: 21px; line-height: 1.18; font-weight: 750; }.cycle-stage-grid { min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }.cycle-stage-panel { position: relative; min-width: 0; padding: 16px 18px; background: var(--surface); border: 1px solid var(--border); border-radius: 0; }.cycle-stage-panel:not(:last-child)::after { content: ''; position: absolute; top: 50%; right: -9px; z-index: 1; width: 0; height: 0; border-top: 5px solid transparent; border-bottom: 5px solid transparent; border-left: 7px solid var(--accent); transform: translateY(-50%); }.cycle-field h3 { margin: 0 0 8px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .07em; }.cycle-field ul { gap: 6px; }.cycle-field li { min-width: 0; overflow-wrap: anywhere; word-break: normal; line-break: loose; hyphens: auto; font-size: 14px; line-height: 1.34; }.cycle-focal .cycle-heading { border-top: 3px solid var(--accent); padding-top: 12px; }.cycle-focal .cycle-stage-panel { border-color: var(--accent); }.cycle-focal .cycle-inputs { background: var(--accent-soft); }.cycle-standard .cycle-heading { border-top-color: var(--accent-deep); }.cycle-standard .cycle-stage-panel { background: var(--paper); }.cycle-standard .cycle-inputs { border-left: 4px solid var(--accent-deep); }.cycle-handoff { min-width: 0; display: grid; justify-items: center; gap: 6px; text-align: center; color: var(--ink); }.handoff-arrow { position: relative; display: block; width: 2px; height: 18px; background: var(--accent); }.handoff-arrow::after { content: ''; position: absolute; left: -4px; bottom: 0; width: 8px; height: 8px; border-right: 1px solid var(--accent); border-bottom: 1px solid var(--accent); transform: rotate(45deg); }.cycle-handoff p { min-width: 0; overflow-wrap: anywhere; word-break: normal; line-break: loose; hyphens: auto; margin: 6px 0 0; font-size: 13px; line-height: 1.32; }.cycle-handoff .handoff-label { margin-top: 0; }.density-compact .explore-converge-cycles { gap: 10px; }.density-compact .cycle { gap: 8px; }.density-compact .cycle-stage-grid { gap: 10px; }.density-compact .cycle-stage-panel { padding: 13px 15px; }.density-compact .cycle-field h3 { margin-bottom: 6px; }.density-compact .cycle-field li { font-size: 13px; }
.primary-supporting-context { width: 100%; display: grid; grid-template-columns: minmax(0, 1.18fr) minmax(360px, .82fr); gap: var(--space-lg); align-items: stretch; }.primary-context { display: flex; flex-direction: column; justify-content: center; min-width: 0; padding: 38px 42px; color: var(--paper); background: var(--ink); border-top: 8px solid var(--accent); }.primary-kicker, .context-relation, .callout-label { margin: 0 0 10px; color: #a8d3d0; font-size: 12px; font-weight: 750; line-height: 1.2; letter-spacing: .1em; text-transform: uppercase; }.primary-context h2 { margin: 0 0 18px; font-size: 31px; line-height: 1.12; letter-spacing: -.02em; }.primary-context > p:last-child { margin: 0; color: #d9e0df; font-size: 20px; line-height: 1.43; }.primary-groups { display: grid; gap: 10px; margin-top: 22px; }.primary-group { min-width: 0; padding-top: 10px; border-top: 1px solid #5b6873; }.primary-group h3 { margin: 0 0 6px; color: #a8d3d0; font-size: 13px; }.primary-group ul { gap: 4px; }.primary-group li { color: #d9e0df; font-size: 14px; line-height: 1.3; }.supporting-contexts { min-width: 0; display: grid; gap: var(--space-sm); align-content: stretch; }.supporting-context { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 132px; gap: var(--space-md); padding: 22px 22px 22px 24px; background: var(--surface); border: 1px solid var(--border); border-left: 5px solid var(--accent); }.supporting-context-copy { min-width: 0; }.supporting-context .context-relation { color: var(--accent-deep); font-size: 11px; }.supporting-context h3 { margin-bottom: 8px; color: var(--ink); }.supporting-context p:last-child { margin: 0; font-size: 16px; line-height: 1.4; }.support-material-placeholder, .support-material-declared { display: grid; place-items: center; align-self: stretch; min-height: 96px; padding: 12px; border: 1px dashed var(--border); color: var(--muted); font-size: 12px; line-height: 1.35; text-align: center; }.support-material-placeholder { background: #f0f1ef; }.support-material-declared { background: var(--accent-soft); border-style: solid; }.supporting-continuity { grid-column: 1 / -1; display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 10px; margin: -10px 0; color: var(--accent-deep); }.supporting-continuity span { position: relative; height: 1px; background: var(--accent); }.supporting-continuity span::after { content: ''; position: absolute; right: 0; top: -3px; width: 7px; height: 7px; border-top: 1px solid var(--accent); border-right: 1px solid var(--accent); transform: rotate(45deg); }.supporting-continuity p { margin: 0; font-size: 13px; line-height: 1.3; }.primary-supporting-callout { grid-column: 1 / -1; min-width: 0; padding: 16px 20px; color: var(--ink); background: var(--accent-soft); border-left: 5px solid var(--accent-deep); }.primary-supporting-callout .callout-label { color: var(--accent-deep); font-size: 11px; }.primary-supporting-callout p:last-child { margin: 0; font-size: 16px; line-height: 1.4; }.density-compact .primary-supporting-context { gap: var(--space-md); }.density-compact .primary-context { padding: 28px 32px; }.density-compact .primary-context h2 { font-size: 27px; }.density-compact .primary-context > p:last-child { font-size: 18px; }.density-compact .primary-group { padding-top: 8px; }.density-compact .primary-group li { font-size: 13px; }.density-compact .supporting-context { padding: 16px 17px 16px 19px; grid-template-columns: minmax(0, 1fr) 112px; }.density-compact .supporting-context p:last-child { font-size: 14px; }.density-compact .support-material-placeholder, .density-compact .support-material-declared { min-height: 76px; }.density-compact .primary-supporting-callout { padding: 13px 16px; }.density-compact .primary-supporting-callout p:last-child { font-size: 14px; }
	@media print { body { background: white; }.deck { gap: 0; padding: 0; }.slide { break-after: page; } }
`;
}

function loadTokens(config: ResolvedRenderConfig): ThemeTokens {
  try {
    const raw = parseYaml(readFileSync(config.theme.tokensPath, 'utf8')) as Partial<ThemeTokens>;
    return { ...defaultTokens, ...raw, canvas: { ...defaultTokens.canvas, ...raw.canvas }, color: { ...defaultTokens.color, ...raw.color }, type: { ...defaultTokens.type, ...raw.type }, space: { ...defaultTokens.space, ...raw.space }, shape: { ...defaultTokens.shape, ...raw.shape } };
  } catch { return defaultTokens; }
}

export function renderBriefInkHtmlV1(deck: Deck, plan: RenderPlan, config: ResolvedRenderConfig): string {
  const tokens = loadTokens(config);
  const pages = deck.slides.map((slide, index) => {
    const planned = plan.slides[index];
    if (!planned) throw new Error(`Renderer received no planned slide for slide ${index + 1}.`);
    const attributes = slideAttributes(slide, planned, index);
    if (planned.template === 'cover') return cover(slide, deck, attributes);
    if (planned.template === 'divider') return divider(slide, slide.number ?? index + 1, attributes);
    if (!planned.template) throw new Error(`Renderer received no planned template for slide ${planned.slideId || index + 1}.`);
    return contentTemplate(slide, deck, slide.number ?? index + 1, planned.template, attributes);
  }).join('\n');
  return `<!doctype html><html lang="${escapeHtml(String(deck.meta.language ?? 'en'))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(deck.meta.title ?? 'Slide deck')}</title><style>${css(tokens)}</style></head><body><div class="deck density-${escapeHtml(config.profile.densityMode)}">${pages}</div></body></html>`;
}
