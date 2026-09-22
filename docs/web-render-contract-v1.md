# Web render contract v1

## Purpose

The Web formatter turns a validated semantic deck into deterministic HTML. It does not reinterpret the business story, silently summarize content, remove source notes, or introduce one-off visual layouts.

The formatter uses a required internal **Render Plan**. HTML is the default user-facing output; the Render Plan is an in-memory system contract and may be exported as JSON only for debugging, test snapshots, and integrations.

```text
*.deck.md
  -> Deck IR + semantic validation
  -> Content Preflight for structurally valid v2 decks
*.deck.md + *.render.yaml
  -> Resolved Render Config
  -> Render Plan + preflight issues
  -> HTML
  -> browser QA when PDF is requested
  -> optional PDF / PNG
```

`slide-deck/v2` Story Brief and per-slide audience positioning are specified in [`content-contract-v2.md`](content-contract-v2.md). They are content-owned, Theme-independent advisory inputs and do not enter render configuration, the Render Plan, template selection, or generated HTML.

## Inputs and ownership

| Input / stage | Owns | Must not own |
|---|---|---|
| Deck IR | business meaning, Story Brief, storyline, titles, Key Messages, per-slide audience positioning, Content, notes, footnotes, semantic structure | template selection, CSS, visual geometry |
| Content Preflight (v2) | deterministic advisory review of declared audience purpose, decision coverage, evidence, and detail intent | template selection, Theme inspection, HTML generation, or content rewriting |
| Render configuration | selected Theme/profile, requested outputs, deck-wide QA policy | visual tokens, template mappings, per-slide overrides |
| Theme manifest | renderer capability, Theme-local tokens, maintained template mappings, approved assets, and visual system | business-content rewrites or profile policy |
| Theme profile | deck-wide density, footer, asset, and QA policy | tokens, template mappings, geometry, assets, or per-slide overrides |
| Render Plan | resolved renderer, per-slide rendering instructions, and renderability state | manually authored content or visual exceptions |
| HTML renderer | deterministic execution by the declared renderer capability | semantic reclassification, content deletion, or cross-Theme fallback |
| Browser QA | measurement and issue reporting | automatic business-content rewriting |

## Render Plan

A Render Plan is generated; it is never a second human-maintained source file. It records the resolved state required for reproducible rendering.

Minimum conceptual shape:

```json
{
  "deck": {
    "title": "Operating Model Transformation",
    "source": "deck source"
  },
  "theme": {
    "name": "brief-ink",
    "renderer": "brief-ink-html-v1",
    "profile": "default",
    "densityMode": "compact",
    "footerPolicy": "minimal"
  },
  "slides": [
    {
      "slideId": "current-state-comparison",
      "number": 4,
      "kind": "content",
      "structure": "comparison",
      "template": "comparison",
      "renderable": true,
      "requiredAssets": []
    }
  ],
  "output": {
    "directory": "build",
    "html": true,
    "pdf": true,
    "png": false
  },
  "qa": {
    "failOnOverflow": true,
    "failOnMissingAsset": true
  }
}
```

The Plan may reference original Deck IR blocks. It must not store a shortened or rewritten version of Title, Key Message, Content, Speaker Notes, or Footnotes.

## Deterministic template mapping

Each Theme names one registered renderer capability, a Theme-local token resource, and an explicit template mapping. A mapped template must be maintained by that renderer. Themes cannot render through another Theme's renderer, tokens, or template identifiers; unknown capabilities and renderer/template mismatches block configuration resolution.

For the neutral bundled reference Theme, `brief-ink`, the mapping is:

| Deck kind / structure | Template |
|---|---|
| `cover` | `cover` |
| `divider` | `divider` |
| `content` or `appendix` + `narrative` | `narrative` |
| `content` or `appendix` + `grouped-items` | `grouped-items` |
| `content` or `appendix` + `comparison` | `comparison` |
| `content` or `appendix` + `sequence` | `sequence` |
| `content` or `appendix` + `layers` | `layers` |
| `content` or `appendix` + `table` | `table` |
| `content` or `appendix` + `explore-converge-cycles` | `explore-converge-cycles` |
| `content` or `appendix` + `primary-supporting-context` | `primary-supporting-context` |

### `explore-converge-cycles` source contract

This bounded semantic structure is a typed `slide-meta.explore_converge_cycles` payload. It must declare exactly two cycles in source order. Every cycle requires non-empty `id`, `label`, `inputs`, `exploration_scope`, and `convergence_outputs`; cycle 0 must declare `emphasis: focal`, and cycle 1 must declare `emphasis: standard`. It also requires one named `handoff` with non-empty `id` and `label`, from cycle 0's ID to cycle 1's ID.

Deck authors provide semantic content only. CSS, templates, layouts, colors, licensed-resource policy, coordinates, dimensions, geometry, and every visual override are invalid. The maintained `brief-ink` template presents the unchanged two-cycle contract as a content-first two-by-three Stage-panel composition: each source-ordered cycle contains Inputs → Exploration scope → Convergence outputs, while focal hierarchy, standard-cycle treatment, decorative connectors, and the visible directional handoff remain Theme-owned and do not enter Deck IR, the Render Plan, or YAML.

The renderer must keep cycle labels, field labels, business lists, and the named handoff as native readable HTML. Decorative connectors must not duplicate, clip, shorten, reorder, or hide semantic text. PDF export runs browser-backed fixed-canvas overflow checks after Web review; it reports rather than repairs a fit issue. Conservative overlap/style advisories remain deferred.

`chart` and `relationship-map` are valid semantic structures but have no initial bundled Web Formatter template. They are blocking **preflight** errors for that renderer until typed data blocks and corresponding templates are added.

An operator-managed private provider may supply additional mappings only when explicitly configured and selected. Its internals remain opaque. When it is unavailable, incompatible, or lacks an explicit mapping, preflight fails closed; the formatter never selects Brief Ink or another Theme as a fallback.

A formatter must not substitute a closest template automatically. If there is no explicit Theme mapping, it reports an issue.

## Gates and outcomes

1. **Semantic validation**: parse and validate Deck Markdown. Any `error` blocks plan generation and rendering.
2. **Configuration resolution**: load the Theme manifest and resolve built-in/project profiles. Invalid inheritance, unknown names, or prohibited fields block rendering.
3. **Render preflight**: map every slide to a maintained Theme template and check required assets/policies. Unsupported structures and missing mappings block that renderer.
4. **HTML rendering**: generate deterministic HTML only after the preceding gates pass.
5. **Native PPTX rendering**: when the dedicated `pptx` output policy is selected, generate only the selected Theme's explicit native templates from Deck IR and the target-specific Render Plan. This is independent of HTML/browser output and does not silently alter business content.
6. **PDF export safety**: only when PDF is requested after Web review, local Chromium verifies slide/plan identity, fixed-canvas overflow, runtime resource loading, and PDF page count. Overflow and resource failures obey the configured failure policy; advisory overlap/style checks remain deferred. The step does not silently alter business content.

## Render issues

Render issues supplement semantic diagnostics; they do not replace them. Every issue should contain:

```text
severity: error | warning | note
stage: configuration | preflight | render | qa
owner: content | configuration | theme | renderer | asset
code: stable-machine-readable-code
message: actionable explanation
slide_id: required for slide-level issues
location: source location when the issue points to deck Markdown
suggestion: a non-destructive next action
```

Examples:

```yaml
severity: error
stage: preflight
owner: theme
code: unsupported-structure
slide_id: market-outlook
message: "The selected Web renderer does not support structure: chart."
suggestion: "Use a semantically valid interim structure only if it preserves meaning, or wait for chart support."
```

```yaml
severity: error
stage: qa
owner: content
code: overflow-unresolved
slide_id: operating-model
message: "Content exceeds the available capacity of the selected template."
suggestion: "Split the page or remove only decision-irrelevant detail; the formatter did not delete content."
```

An issue with `owner: theme` or `owner: renderer` must not be represented as a content-authoring defect. Conversely, a Theme must not hide a content-density problem through unapproved per-slide formatting.

## Output and safety rules

- HTML is the primary delivery output. PDF is an optional browser-rendered export; PNG remains deferred and a request fails explicitly.
- The separate `pptx` target is a bounded native editable route, not an HTML conversion or broad PowerPoint promise. Each Theme explicitly declares its maintained templates; all other mappings fail closed.
- Native package QA is written before the binary and blocks it on errors. It checks package structure, declared dimensions, expected editable text, slide count, and unsupported payloads. Manual application edit/save/reopen remains required acceptance evidence.
- A PDF request writes `qa.json` beside the configured artifact names. Default names are `index.html`, `index.pdf`, and `qa.json`; `--out strategy.html` derives `strategy.pdf` and `strategy.qa.json`.
- Chromium is an explicit local operator dependency (`npx playwright install chromium`), never an implicit browser download, host-browser discovery, or remote browser service.
- All generated plans, HTML, PDF, PNG, QA reports, and assets are written to the caller's project directory or explicitly requested output directory, never to the Skill source directory.
- Visible Deck footnotes remain visible regardless of `footer_policy`; that policy controls only the regular Theme footer.
- Theme/profile changes apply consistently to the full deck. Per-slide template, CSS, color, resource, grid, or geometry overrides are prohibited.
