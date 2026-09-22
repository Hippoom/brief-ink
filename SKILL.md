---
name: slide
description: Public-neutral workflow for semantic deck authoring, deterministic rendering, explicitly authorized provider selection, and validation.
---

# Slide

Use this workflow for semantic presentation decks and deterministic rendering.

## Boundaries

- Deck Markdown owns audience, storyline, claims, semantic structure, and visible content.
- Themes own visual implementation. Do not put CSS, geometry, fonts, colors, or slide-specific renderer instructions in Deck content.
- Write generated decks, assets, and reports to the active project or an explicitly selected output directory, never to this source workspace.

## Current workflows

| Intent | Workflow |
|---|---|
| Shape source material into slide-ready Markdown | [content](workflows/content.md) |
| Validate, preflight, render, or export a deterministic deck | [web](workflows/web.md) |

For image or prompt work, produce a specification unless the user explicitly selects and authorizes an external provider. This public workspace does not provide an image-generation workflow or image asset capability.

## Theme and provider policy

Render YAML names only a canonical Theme ID. Public projects use the bundled **Brief Ink** Theme (`brief-ink`). Private providers are externally configured, explicitly authorized, opaque, and fail closed when unavailable.

Never infer, discover, name, auto-select, or fall back to a private provider. Do not put provider locations, identities, credentials, implementation details, or bridge values into Decks, render YAML, profiles, artifacts, render plans, reports, feedback, or tracked public content.

## Authoring rules

- Use one conclusion-led idea per slide.
- Let titles and Key Messages form a standalone narrative.
- Choose `structure` from the real relationship: `narrative`, `grouped-items`, `comparison`, `sequence`, `layers`, `table`, `explore-converge-cycles`, or `primary-supporting-context`.
- Preserve evidence and content required for meaning; split dense slides rather than shrinking or silently removing content.
- `section` is optional narrative metadata. Themes may choose whether to render it.
- `primary-supporting-context` uses typed semantic payload rather than a free-form **Content** block. Its optional `primary.label`, `primary_groups_relation`, and callout `quote` describe meaning, never visual layout.

## Validation

Check:

- title and Key Message narrative;
- valid semantic metadata and supported structures;
- evidence, density, and footnote gaps;
- fail-closed Theme/provider/target mapping;
- rendered overflow, missing resources, and output-policy failures.

For source development, run:

```bash
npm run typecheck
npm test
npm run test:browser
npm run audit:public
```
