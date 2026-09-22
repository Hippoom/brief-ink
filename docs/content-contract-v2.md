# Slide Deck content contract v2

`slide-deck/v2` adds a bounded, content-stage contract to the existing canonical `*.deck.md` source. It records what an intended audience must understand, decide, or do before any Theme or renderer is selected.

Terminology: the Slide platform calls its complete DSL the **Slide Semantic Model**. A content slide's current `structure`, relationship metadata, and typed payload together form its **Content Model**. In the future, `structure` will be a compatibility alias for **Content Pattern** and `relationship_model` for optional **Relationship Intent**. This v2 contract and its current field names remain authoritative during that migration; see [slide terminology architecture v1](slide-terminology-architecture-v1.md).

It does **not** add visual direction. Themes and renderers still own templates, colors, typography, composition, geometry, CSS, and browser rendering.

## Compatibility

- `slide-deck/v1` remains supported and receives no v2-required fields or Content Preflight warnings.
- `slide-deck/v2` is opt-in through explicit frontmatter.
- Existing `kind` and `structure` validation remains unchanged.
- v2 metadata does not enter `*.render.yaml`, a Theme manifest, the Render Plan, or generated HTML.

## Deck-level Story Brief

A v2 deck requires a non-empty top-level `audience` and `story_brief`:

```yaml
schema: slide-deck/v2
title: Loyalty activation decision
audience: Executive leadership team
story_brief:
  audience_outcome: Leadership understands the operating choice and evidence needed to proceed.
  decision_or_action: Endorse a phased activation model and sponsor the first implementation decision.
  narrative: Fragmented recognition limits cross-business value; a shared model creates a governed path forward.
  constraints:
    - Do not present unvalidated value estimates as facts.
    - Keep local proposition ownership with business units.
```

`constraints` contains one to eight non-empty business-content boundaries. It is not a visual instruction list.

## Per-slide content positioning

`content_positioning` is optional structurally but is reviewed by Content Preflight for every `content` or `appendix` slide. Its minimum useful set is `audience_question`, `desired_outcome`, and `story_role`:

```yaml
content_positioning:
  audience_question: What action should leadership endorse now?
  desired_outcome: Leadership sponsors a controlled first phase before scaling the shared model.
  story_role: recommend
  relationship_model: sequence
  proof_requirement: decision-evidence
  detail_level: executive
```

Allowed controlled values:

| Field | Values |
|---|---|
| `story_role` | `orient`, `frame`, `explain`, `compare`, `recommend`, `decide`, `commit`, `reference` |
| `relationship_model` | `single-idea`, `grouping`, `comparison`, `sequence`, `layers`, `tabular-reference`, `decision-gate`, `handoff`, `explore-converge-cycles`, `primary-supporting-context` |
| `proof_requirement` | `none`, `illustrative-example`, `source-cited`, `hypothesis-labelled`, `validate-before-decision`, `decision-evidence` |
| `detail_level` | `headline`, `executive`, `working`, `reference` |

`section` is optional narrative grouping metadata for content and appendix slides. When declared it must be non-empty; it does not require a renderer to show section chrome. `structure` remains the only existing renderer-facing semantic relationship field. For example, a slide can declare `relationship_model: sequence` and `structure: sequence`; no template name or layout instruction is supplied by the author.

## Primary supporting context

Use `structure: primary-supporting-context` when one independently understandable primary argument needs one or two subordinate contexts. The complete visible semantic body is declared in `slide-meta.primary_supporting_context`; content slides still require **Key Message**, but must not include a free-form **Content** block.

```yaml
structure: primary-supporting-context
content_positioning:
  relationship_model: primary-supporting-context
primary_supporting_context:
  primary:
    id: governed-first-phase
    label: Governed first phase
    statement: A bounded first phase can establish shared standards before scale.
    self_sufficient: true
  primary_groups:
    - id: governance-foundations
      label: Governance foundations
      items:
        - Shared identity and consent standards
        - Measurement rules for scale decisions
  supporting_contexts:
    - id: journey-pilot
      label: Journey pilot
      statement: A selected journey tests coordination in controlled conditions.
      supports_primary_id: governed-first-phase
      support_relation: example
      material:
        status: placeholder
```

`primary` requires `id`, `statement`, and `self_sufficient: true`. Its `label` is optional; when supplied it must be a non-empty supplementary semantic kicker that adds meaning beyond the title or statement. Omitting it does not request a particular visual hierarchy or layout. Each support requires a unique ID, label, statement, a reference to `primary.id`, and one relation from `illustration`, `example`, `evidence`, `action`, or `reference`. There must be one or two supports. With two supports, add one forward `continuity` mapping from support 0 to support 1; with one support, do not add continuity. `material.status: asset` requires an opaque declared top-level `assets[].id`; `placeholder` forbids `asset_id`. Neither status requests asset resolution or a particular visual treatment.

`primary_groups` is optional. When present, it is an ordered list of uniquely identified `{ id, label, items }` groupings that elaborate the primary argument; each group needs a non-empty label and one or more non-empty items. `primary_groups_relation` is optional and may be `sequence` or `parallel` only when groups are present. Omission preserves legacy unspecified relation; renderers must not infer a sequence merely from YAML order.

`callout` is optional and declares one distinct `{ id, label, statement }` decision-relevant emphasis. It may also carry an optional non-empty `quote`, which is a distinct authored quoted voice rendered before the ordinary explanatory `statement`; the statement remains required. These additions preserve content semantics only: they do not request a layout, typography, numbering, asset treatment, or renderer fallback.

## Content Preflight

Run:

```bash
npm run slide -- content-preflight path/to/deck.md --out /path/to/project/build/content-preflight.json
```

The command runs parse and semantic validation first. It then runs only on a structurally valid v2 deck and returns success for advisory warnings. The optional report contains deterministic provenance (absolute deck path, source SHA-256, schema/title, counts, and issues) but no copied slide body content.

All Content Preflight findings use:

```text
severity: warning
stage: content-preflight
owner: content
```

Initial advisory checks identify:

- missing or incomplete content positioning on content/appendix slides;
- a Story Brief decision/action without a `recommend`, `decide`, or `commit` slide;
- explicit relationship/structure tension;
- `source-cited` or `decision-evidence` without a Footnotes block;
- `detail_level: reference` on a non-appendix slide.

The check creates explicit review targets. It cannot prove prose quality or audience comprehension, and it does not use language-specific keyword heuristics as a correctness gate.

## Prohibited controls

Deck data must not include visual or renderer implementation controls, including `layout`, `template`, `variant`, `position`, `grid`, CSS, colors, fonts, dimensions, coordinates, or per-slide renderer overrides. The validator rejects these fields recursively, including inside `story_brief` and `content_positioning`.

Do not use v2 metadata to request a closest available template. If a maintained Theme lacks a mapping for a valid `structure`, Web preflight must report the unresolved Theme-owned issue rather than changing the slide’s meaning.

## Validation and rendering boundary

| Stage | Owns |
|---|---|
| Deck Markdown | audience, Story Brief, storyline, titles, Key Messages, visible Content, sources, notes, semantic structures, positioning |
| Content Preflight | deterministic advisory review of declared content intent |
| Render configuration | selected Theme/profile, requested outputs, QA policy |
| Theme | maintained template mappings and visual system |
| Renderer | deterministic HTML execution only |
| Browser QA | measurement and issue reporting |

HTML-only rendering does not currently run browser QA. PDF rendering runs the existing narrow export-safety QA path; that policy is separate from the v2 content contract.
