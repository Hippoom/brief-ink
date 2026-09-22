import { preparePptxTheme, renderPreparedPptxTheme } from './pptx-theme-registry.js';
import type { Deck, RenderPlan, ResolvedRenderConfig } from './types.js';

/**
 * Compatibility facade. New lifecycle callers prepare once, then dispatch through
 * the selected adapter with renderPreparedPptxTheme.
 */
export async function renderPptx(deck: Deck, plan: RenderPlan, config: ResolvedRenderConfig): Promise<Uint8Array> {
  const prepared = await preparePptxTheme(deck, config);
  const errors = prepared.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) throw new Error(errors.map((issue) => `${issue.code}: ${issue.message}`).join('\n'));
  return renderPreparedPptxTheme(prepared, { deck, plan, config });
}
