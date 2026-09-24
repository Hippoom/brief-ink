# Slide terminology architecture v1

## Status

This is the canonical vocabulary and migration decision for the Slide Semantic Model. It introduces internal normalized terminology while retaining existing v1/v2 authoring and rendering behavior.

## Layered model

```text
Slide Semantic Model (platform DSL)
├── Slide Kind
├── Narrative Role
├── Claim Layer
└── Content Model
    ├── Content Pattern
    ├── optional Relationship Intent
    └── Pattern Payload
        ├── Semantic Units
        └── Semantic Edges

Theme Design System
├── Foundations
│   ├── Typography
│   ├── Color
│   ├── Spacing
│   └── presentation reading rules
├── Design Tokens
├── Visual Primitives
├── Visual Archetypes
├── Target Compositions
└── Target Adapters

Optional project integration (private, Session/directory-scoped)
└── Master/Slide Layout Integration
```

## Canonical terms

| Term | Meaning | Current compatibility term |
|---|---|---|
| Slide Semantic Model | Platform DSL and type system for meaningful slide content. Not a Deck field. | Existing Deck/Slide semantic contracts. |
| Slide Kind | Document role: `cover`, `divider`, `content`, `appendix`. | `kind` |
| Narrative Role | Storyline contribution such as orient, explain, compare, recommend, decide, or reference. | `story_role` |
| Content Model | One content or appendix slide's structured semantic instance. | Future authoring container only. |
| Content Pattern | Bounded decomposition grammar: legal units, cardinality, order, and typed edges. Never a visual layout. | `structure` |
| Relationship Intent | Optional reader/business interpretation of declared units. It is not a second visual selector. | `relationship_model` |
| Semantic Unit | Identifiable business entity such as claim, group, comparison side, stage, gate, evidence item, or supporting context. | Typed payload fields and Markdown blocks. |
| Semantic Edge | Typed relationship between units, e.g. supports, compares-with, precedes, informs, evaluates, or permits. | ID references such as continuity/handoff fields. |
| Semantic Slot | Pattern-schema location that accepts a semantic unit or bounded collection. Schema terminology, not author-facing layout terminology. | Internal validation concept. |
| Pattern Payload | Author-provided pattern-specific data that fills semantic slots. | Typed payloads and bounded Markdown Content. |
| Theme | Versioned presentation design-system package: Foundations, Design Tokens, primitives, archetypes, target compositions, adapters, fixtures, assets/provenance, and Theme QA. | Theme |
| Foundations | Reading-oriented presentation rules such as Typography, Color, Spacing, surfaces, and source/footer treatment. They may incorporate brand guidance but do not require it. | Tokens and visual rules. |
| Design Tokens | Machine-readable values that implement Foundations and feed target-native primitives. | Tokens/CSS/shapes. |
| Visual Primitive | Theme-owned building block such as type role, surface, panel, rule, label, connector, or placeholder. | Tokens/CSS/shapes. |
| Visual Archetype | Theme-owned reusable visual contract for eligible Content Patterns and payload capacity. | Archetype |
| Target Composition | Visual Archetype realization for one base target. | Manifest template / adapter template ID. |
| Target Adapter | Explicit target prepare/render/verify implementation using injected runtime services. | `ThemeAdapter` |
| Master/Slide Layout Integration | Optional private-project PPTX evidence and bindings for approved Slide Master and Slide Layout resources. It is not an Archetype catalog or a public manifest field; project-local integration may use it under its authorized Session/directory policy. | Private Provider or project-local integration state. |
| Provider | Explicit distribution boundary exposing compatible Themes. | `ThemeProvider` |
| Profile | Deck-wide communication, consumption, delivery, and QA policy. Not a Theme variant, layout, or provider selector. | Profile |
| Capability | Declared support state for a Theme, Visual Archetype, Target Composition, Adapter, and applicable Profile constraints. | Existing support declarations. |
| QA | Checks that emit findings. | Validation/QA layers. |
| Fidelity | Measured conformance against a declared semantic, visual-system, editability, or cross-target baseline. | Theme-specific verification. |
| Acceptance | Human or policy decision that required evidence is sufficient for a delivery purpose. | Manual review/interoperability acceptance. |

## Authoring boundary

The future author-facing shape is illustrative only; it is not accepted by the current parser:

```yaml
content_model:
  pattern: primary-supporting
  relationship_intent: supports
  payload:
    primary_claim: ...
    supporting_contexts: ...
```

`payload` is author-facing. `Semantic Slot` is the Pattern registry's schema vocabulary and deliberately avoids the visual-placeholder meaning that “slot” has in presentation design tools.

Existing fields remain authoritative in v1/v2:

```yaml
structure: primary-supporting-context
content_positioning:
  relationship_model: primary-supporting-context
```

## Bounded semantic containment

Deck semantics support only Pattern-defined containment:

```text
primary-supporting
├── one primary claim
├── zero to three primary groups
│   └── ordered atomic detail items
├── zero to one callout assertion
├── one to two supporting contexts
└── forward continuity edge when supports = two
```

Patterns may define bounded nested units, but Decks must not author arbitrary recursive `children`, custom nodes, visual trees, coordinates, Archetype IDs, Target Composition IDs, or layout controls.

Theme Target Compositions may use recursive internal composition trees of containers, primitives, target-native shapes, and semantic slot bindings. That implementation is Theme-owned and cannot mutate, omit, reorder, or reinterpret authored content.

## Pattern and Intent

A Content Pattern is mandatory for content-bearing slides. Relationship Intent is optional:

- use a Pattern default only for an exact, unambiguous mapping;
- retain an explicit authored relationship model when present;
- leave intent absent when a legacy source did not state it and no exact default exists;
- never infer an intent from prose;
- never use Intent alone to select a Theme, Archetype, Target Composition, or fallback template.

## Design-system selection flow

```text
Validated Slide semantics
+ selected Theme
+ selected Profile
+ requested target
→ capability / fit evaluation
→ Visual Archetype
→ Target Composition
→ Target Adapter render + QA
→ Fidelity evidence + Acceptance
```

A valid artifact is not automatically a fidelity pass or delivery acceptance. Generic artifact QA, Theme visual QA, and editable-target interoperability acceptance answer different questions.

## Migration phases

1. **Phase 0/1**: glossary and pure normalized semantic IR; retain v1/v2 source fields, manifests, plans, templates, CLI, and output behavior.
2. **Phase 2**: formal Content Pattern registry and opt-in v3 `content_model` authoring; dual-read and report-only migration.
3. **Phase 3**: optional Theme Visual Archetype and Target Composition manifest metadata; compile legacy template mappings into compatibility projections. Provider-private Master/Slide Layout Integration remains separate from this platform metadata and retains no public projection.
4. **Phase 4**: Archetype-aware planning and target-adapter composition capability, while retaining legacy plan fields. Private integration validation may continue to run in adapter preparation without changing the compatibility projection.
5. **Phase 5**: formal QA, fidelity, and acceptance evidence model.
6. **Phase 6**: planned deprecation only after a stable dual-read cycle and separately approved major-version migration.

## Extension governance

A platform semantic extension requires a reusable business relationship, bounded units/edges/cardinality, migration strategy, validators and stable diagnostics, neutral fixtures, and evidence that it is not a one-off layout request.

A Theme visual extension may add primitives, Visual Archetypes, Target Compositions, capability declarations, fidelity baselines, and Theme QA. It may not add arbitrary Deck layout fields, coordinates, template IDs, or visual composition trees.

Profiles may constrain density, source/footer visibility, assets, outputs, QA, and acceptance policy. They cannot select providers, Visual Archetypes, Target Compositions, tokens, layouts, or per-slide overrides.
