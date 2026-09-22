export interface RendererCapability {
  id: string;
  templates: ReadonlySet<string>;
}

export const RENDERER_CAPABILITIES: ReadonlyMap<string, RendererCapability> = new Map([
  ['brief-ink-html-v1', {
    id: 'brief-ink-html-v1',
    templates: new Set([
      'cover',
      'divider',
      'narrative',
      'grouped-items',
      'comparison',
      'sequence',
      'layers',
      'table',
      'explore-converge-cycles',
      'primary-supporting-context',
    ]),
  }],
  ['brief-ink-pptx-v1', {
    id: 'brief-ink-pptx-v1',
    templates: new Set([
      'brief-ink-pptx-cover-v1',
      'brief-ink-pptx-narrative-v1',
      'brief-ink-pptx-comparison-2col-v1',
    ]),
  }],
]);

export function rendererCapability(id: string): RendererCapability | undefined {
  return RENDERER_CAPABILITIES.get(id);
}
