# Content workflow

Use this workflow to turn source material into canonical `*.deck.md` content without encoding visual implementation decisions.

## Content-stage sequence

```text
source material
  -> Story Brief
  -> title + Key Message storyline
  -> per-slide audience positioning
  -> semantic structure
  -> visible content, notes, and sources
  -> semantic validation
  -> Content Preflight
```

A deck may address any subject—strategy, governance, process, operating model, or product journey—but it must help its intended audience understand what matters and what they need to decide or do. Subject matter is not an excuse for unclear story construction.

## 1. Start with the audience and Story Brief

For `slide-deck/v2`, record:

- the audience outcome: what the audience must understand, decide, or be able to do;
- the decision or action requested;
- the narrative argument that connects the deck;
- non-negotiable business-content constraints.

Do not start from a collection of topic labels, templates, or a request for a particular visual arrangement.

## 2. Build the title and Key Message scan path

Draft and sequence conclusion-led titles with non-duplicative Key Messages before polishing slide bodies. A time-poor reader should understand the argument by scanning those two fields alone.

- Each content slide has one central conclusion.
- Key Message explains, qualifies, or reinforces the title rather than repeating it.
- Preserve uncertainty: distinguish facts, client input, hypotheses, source-to-confirm items, and open questions.
- Do not invent evidence or value claims to make an argument appear complete.

## 3. Position each content slide for its audience

For every `content` or `appendix` slide, define the minimum positioning:

```yaml
content_positioning:
  audience_question: What does this audience need answered here?
  desired_outcome: What changes in understanding or action after this slide?
  story_role: explain
```

Then add only relevant bounded declarations:

- `relationship_model` for the business relationship being explained;
- `proof_requirement` for evidence needed before the claim can be relied on;
- `detail_level` for the appropriate live-slide versus appendix depth.

Use [`docs/content-contract-v2.md`](../docs/content-contract-v2.md) for allowed values. These declarations are not visible slide text and must not name a template, layout, visual variant, color, coordinate, or renderer behavior.

## 4. Select semantic structure from the information relationship

`structure` describes the relationship in the content, not visual preference:

| Relationship | Typical structure |
|---|---|
| One conclusion with supporting logic | `narrative` |
| Peer capabilities or categories | `grouped-items` |
| Meaningful contrast | `comparison` |
| Ordered stages or actions | `sequence` |
| Nested operating levels | `layers` |
| Reference criteria or detailed comparison | `table` |
| One self-sufficient argument with one or two subordinate contexts | `primary-supporting-context` |

Use a table or appendix for reference detail rather than compressing it into a generic card grid. Use `primary-supporting-context` only when the primary statement can stand alone and one or two non-peer contexts support it; its typed payload replaces free-form **Content** while **Key Message** remains required. Optional ordered `primary_groups` may clarify the primary argument, and one optional `callout` may state a decision-relevant emphasis; neither is a request for a visual treatment. Split a page when it contains multiple decisions or too much operational detail for the intended audience.

## 5. Preserve evidence and decision-relevant detail

- For `source-cited` and `decision-evidence` positioning, include a visible **Footnotes** block.
- Keep examples, bullets, labels, relationships, and sequences that carry business meaning.
- Use speaker notes for presentation guidance, not hidden essential evidence.
- `detail_level: reference` normally belongs in an appendix. If live discussion requires it, make the audience need explicit in the title, Key Message, and positioning.

## 6. Validate before rendering

Run semantic validation and then Content Preflight:

```bash
npm run slide -- validate path/to/deck.md
npm run slide -- content-preflight path/to/deck.md --out /path/to/project/build/content-preflight.json
```

Content Preflight warnings are advisory, content-owned review targets. Resolve the audience, narrative, decision, proof, and detail concerns in content; do not try to solve them by adding visual authoring directives or requesting a fallback template.

## Boundary with Web rendering

The content workflow owns business meaning. The Web workflow owns Theme selection, maintained template mapping, visual hierarchy, geometry, CSS, export, and browser QA. A valid semantic `structure` does not guarantee that the content is ready for its audience, and Content Preflight does not choose how a Theme renders it.
