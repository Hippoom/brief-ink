---
schema: slide-deck/v1
title: Invalid explore-converge fixture
audience: Test
language: en
---

## Slide 01 — Invalid controlled cycle payload must fail explicitly

```slide-meta
id: invalid-cycles
kind: content
section: test
structure: explore-converge-cycles
explore_converge_cycles:
  cycles:
    - id: duplicated-cycle
      label: First cycle
      emphasis: standard
      inputs: []
      exploration_scope:
        - Explore evidence
      convergence_outputs:
        - First output
      layout: two columns
    - id: duplicated-cycle
      label: Second cycle
      emphasis: focal
      inputs:
        - Second input
      exploration_scope:
        - Second exploration
      convergence_outputs:
        - Second output
  handoff:
    id: invalid-handoff
    label: Reverse the intended flow
    from_cycle_id: duplicated-cycle
    to_cycle_id: missing-cycle
  extra_payload_field: prohibited
```

**Key Message**

This fixture intentionally violates the fixed cycle semantics.

**Content**

Set x: 120px and use CSS { color: red; }.
