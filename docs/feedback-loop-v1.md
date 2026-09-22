# Feedback capture and improvement loop v1

## Purpose

Slide feedback must survive a change of working directory, Claude session, or maintainer. A feedback record is an observation and evidence trail; it is **not** permission for the Skill to modify its own defaults automatically.

```text
project review
  → local feedback record
  → triage and scope decision
  → explicit implementation
  → verification evidence
  → reusable, reviewable learning
```

## Storage boundary

Feedback is written in the active deck project, never below the global Slide Skill source:

```text
<deck-project>/
└── .slide/
    └── feedback/
        ├── inbox/       # observed
        ├── triaged/     # candidate
        ├── accepted/    # accepted for implementation
        ├── rejected/    # not promoted
        └── verified/    # implemented and evidenced
```

This directory should normally be committed with the deck project. It contains process evidence, not deck business content. Do not put API keys, tokens, passwords, secrets, or client credentials in feedback messages or evidence.

## Lifecycle

| Status | Meaning | Allowed next action |
|---|---|---|
| `observed` | Raw observation captured while working or reviewing. | Triage, or leave for later. |
| `candidate` | Has a tentative scope but needs more evidence or a decision. | Accept, reject, or revise triage. |
| `accepted` | A human has agreed it should be implemented at its assigned scope. | Implement, then verify. |
| `rejected` | Useful observation, but not a rule to promote. | Keep as history; create a new record if circumstances change. |
| `verified` | Implementation and verification evidence are recorded. | Immutable; create a new record for a new observation. |

The CLI does not modify `deck.md`, Themes, Profiles, renderer code, or Skill workflows as a side effect of feedback capture, triage, or verification.

## Scope decision

Classify every accepted candidate to one primary scope:

| Scope | Use when | Typical destination |
|---|---|---|
| `content` | Facts, storyline, wording, sources, or semantic relations of one deck change. | `*.deck.md` |
| `project` | The rule applies to a single client/project/delivery. | Project render config, approved project profile, assets, deployment config |
| `theme` | A cross-deck visual/template rule belongs to a named Theme. | Theme tokens, visual rules, maintained renderer templates |
| `skill` | The semantic model, workflow, output boundary, or quality contract changes. | `docs/`, `workflows/`, validator/IR/renderer contract, ADR |
| `fixture` | The main learning is a new regression/review sample. | Project or Skill acceptance fixture |
| `bug` | Existing specified behavior does not work as intended. | Implementation plus a regression test/fixture |

Use `unknown` at capture time if the correct scope is unclear. Do not force a decision while reviewing a live deck.

## CLI

Run these commands from any deck project. If running elsewhere, pass `--project` explicitly.

### Capture an observation

```bash
slide feedback add \
  "Page numbers should be lower right; visible Deck Footnotes stay lower left." \
  --deck strategy.deck.md \
  --config strategy.render.yaml \
  --slide operating-model \
  --source user
```

The command writes one YAML record under `.slide/feedback/inbox/`. It records relative paths only when the referenced deck/configuration is inside the project.

### Review the local inbox

```bash
slide feedback list
slide feedback list --status observed
```

### Triage without changing the Skill

```bash
slide feedback triage 2026-09-15-page-numbers-lower-right \
  --scope theme \
  --status candidate \
  --rationale "Observed in both English and bilingual review decks."
```

When the rule is approved for implementation:

```bash
slide feedback triage 2026-09-15-page-numbers-lower-right \
  --scope theme \
  --status accepted \
  --rationale "Stable cross-deck navigation rule."
```

### Close the loop after implementation

Only an `accepted` record can be verified:

```bash
slide feedback verify 2026-09-15-page-numbers-lower-right \
  --implementation "brief-ink footer template and visual rules" \
  --verification "Rendered English and bilingual decks; reviewed content-slide footers." \
  --fixture examples/bilingual-review.deck.md
```

`--implementation` and `--verification` are required so `verified` means more than “someone believes it is done.” Fixtures must remain inside the deck project; use a project-local review fixture when validating a project-specific feedback item.

## Minimum evidence before promotion

| Scope | Minimum evidence to verify |
|---|---|
| `content` | Updated deck validates and renders. |
| `project` | Relevant project deck renders with its selected configuration. |
| `theme` | At least an English and a bilingual/representative fixture render successfully; visual review is recorded. |
| `skill` | Contract/workflow documentation and appropriate implementation or validation evidence are updated. |
| `fixture` / `bug` | A fixture or automated regression check demonstrates the outcome. |

Browser/PDF export-safety QA is available under B13 and should be recorded when configured. It does not replace a visual-regression baseline, Theme-specific visual review, or desktop host-app interoperability evidence; records must distinguish the automated checks actually run from the manual review still required.

## Later central governance

v1 is intentionally local-first and offline. A future explicit export/sync command may copy approved records to a governed repository or issue tracker. It must never silently transmit project feedback, deck content, or client information.
