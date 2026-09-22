---
schema: slide-deck/v2
title: Coordinated activation decision
audience: Executive leadership team
language: en
purpose: Align leadership on a governed first phase for coordinated activation
source_status: draft
story_brief:
  audience_outcome: Leadership understands the recommendation and its two supporting contexts.
  decision_or_action: Sponsor a governed first phase for coordinated activation.
  narrative: A governed first phase establishes the standards needed to test coordinated activation before scale.
  constraints:
    - Preserve local proposition ownership.
    - Do not present unvalidated value estimates as facts.
---

## Slide 01 — A governed first phase can establish the standards required for coordinated activation

```slide-meta
id: coordinated-activation-context
kind: content
section: recommendation
structure: primary-supporting-context
content_positioning:
  audience_question: What should leadership sponsor before scaling coordinated activation?
  desired_outcome: Leadership endorses a governed first phase with clear supporting contexts.
  story_role: recommend
  relationship_model: primary-supporting-context
  proof_requirement: decision-evidence
  detail_level: executive
primary_supporting_context:
  primary:
    id: governed-first-phase
    label: Governed first phase
    statement: A governed first phase can establish shared identity, consent, and measurement standards before coordinated activation is scaled.
    self_sufficient: true
  primary_groups:
    - id: governance-foundations
      label: Governance foundations
      items:
        - Shared identity and consent standards
        - Measurement rules for scale decisions
    - id: operating-guardrails
      label: Operating guardrails
      items:
        - Accountable ownership and decision rights
        - Local proposition ownership remains intact
  supporting_contexts:
    - id: journey-pilot
      label: Journey pilot
      statement: A selected journey can test orchestration rules, accountable ownership, and frontline handoffs in controlled conditions.
      supports_primary_id: governed-first-phase
      support_relation: example
      material:
        status: placeholder
    - id: decision-evidence
      label: Decision evidence
      statement: Activation, customer, and operating evidence can determine whether the shared model is ready for broader adoption.
      supports_primary_id: governed-first-phase
      support_relation: evidence
      material:
        status: asset
        asset_id: decision-evidence-summary
  continuity:
    id: pilot-to-evidence
    label: Pilot learning informs the scale decision
    from_supporting_context_id: journey-pilot
    to_supporting_context_id: decision-evidence
  callout:
    id: sponsor-decision
    label: Leadership decision
    statement: Sponsor the governed first phase and use pilot evidence to decide whether coordinated activation is ready to scale.
assets:
  - id: decision-evidence-summary
    required: false
```

**Key Message**

The recommendation stands independently while a controlled pilot and decision evidence explain how leadership can proceed.

**Footnotes**

1. Pilot measures and scale criteria to be confirmed with executive sponsors.
