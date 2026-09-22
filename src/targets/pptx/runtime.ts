import PptxGenJSImport from 'pptxgenjs';
import { inspectPptxPackage, type PptxPackageInspection } from '../../pptx-package.js';

export interface PptxSlide {
  background: { color: string };
  addShape(shape: string, options?: Record<string, unknown>): void;
  addText(text: string | Array<{ text: string; options?: Record<string, unknown> }>, options?: Record<string, unknown>): void;
}

export interface PptxPresentation {
  layout: string;
  author: string;
  company: string;
  subject: string;
  title: string;
  lang: string;
  defineLayout(options: { name: string; width: number; height: number }): void;
  addSlide(): PptxSlide;
  write(options: { outputType: 'uint8array'; compression: boolean }): Promise<unknown>;
}

/**
 * Public, Theme-neutral PPTX target services selected by the host.
 * Theme adapters receive this object through their render and verification
 * contexts rather than constructing or importing target-engine internals.
 */
export interface PptxTargetRuntime {
  createPresentation(): PptxPresentation;
  inspect(bytes: Uint8Array): Promise<PptxPackageInspection>;
}

const PptxGenJS = PptxGenJSImport as unknown as { new (): PptxPresentation };

export function createPptxPresentation(): PptxPresentation {
  return new PptxGenJS();
}

/** The host-owned runtime injected into every registered PPTX adapter. */
export const pptxTargetRuntime: PptxTargetRuntime = {
  createPresentation: createPptxPresentation,
  inspect: inspectPptxPackage,
};
