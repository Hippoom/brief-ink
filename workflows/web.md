# Web workflow

Use this workflow for stable, code-controlled HTML presentations and optional export paths.

## Purpose

The web path separates responsibilities:

```text
content authoring -> canonical deck Markdown -> validation -> render plan -> deterministic HTML -> optional browser checks -> optional export
```

Deck Markdown owns business meaning. The renderer and selected Theme own templates, visual tokens, and layout behavior. The renderer must not silently rewrite, reorder, omit, or simplify business content to make a page fit.

## Inputs

```text
<name>.deck.md       canonical semantic and business content
<name>.render.yaml   canonical Theme ID, requested outputs, and quality policy
```

Render configuration must not contain provider selection, provider location, private implementation details, credentials, fonts, CSS, coordinates, colors, or slide-specific layout overrides.

## Theme and provider selection

A render YAML `theme` value is the canonical Theme ID. In a public project it must resolve to the allowlisted bundled public Theme; a public project cannot select or resolve a private Theme.

In a private project, resolve an explicitly authorized provider through this order:

1. XDG user registry — preferred daily selection mechanism.
2. Legacy environment bridge — higher precedence when present, but deprecated and not a normal selection path.
3. Project-local Claude settings bridge — a permitted, narrow explicit bridge; it is not the only selection mechanism.

Provider selection and authorization happen outside render YAML. Every selected provider must be explicit, opaque, and registered or otherwise authorized by the host. The host must not auto-discover, infer, disclose, or fall back to a provider. An absent, invalid, incompatible, unauthorized, or non-owning provider is a configuration error.

Provider configuration, credentials, identities, implementation details, and local values remain outside deck Markdown, render YAML, profiles, artifacts, render plans, reports, feedback, and public payloads. Git ignore is staging hygiene only and does not replace isolation, containment, explicit selection, fail-closed validation, redaction, or public-payload auditing.

## Maintained template mapping

The allowlisted public Theme maps supported semantics to maintained templates:

| Deck kind or structure | Template |
|---|---|
| `cover` | `cover` |
| `divider` | `divider` |
| `narrative` | `narrative` |
| `grouped-items` | `grouped-items` |
| `comparison` | `comparison` |
| `sequence` | `sequence` |
| `layers` | `layers` |
| `table` | `table` |
| `primary-supporting-context` | `primary-supporting-context` |

Never select a closest template. If no explicit mapping exists, report an actionable preflight error and ask for an upstream semantic revision or maintained Theme support. For supported semantics, the Web adapter must render every declared optional semantic field exactly once and preserve declared list order; it must not infer a substitute hierarchy or omit semantics to make a page fit.

## Required gates

Run these gates in order:

1. Parse and semantically validate deck Markdown.
2. Run advisory content checks for audience, story, evidence, and detail intent where the deck contract supports them.
3. Resolve the canonical Theme ID and external provider policy.
4. Build a render plan and verify template mappings, output settings, and asset policy.
5. Render deterministic HTML only when blocking issues are absent.
6. If PDF is requested, run the configured browser export-safety checks before generating it.

Each issue should include severity, stage, owner, code, message, suggestion, and relevant slide identity when applicable.

## Output policy

HTML is the normal web deliverable. PDF is optional and must be gated by the configured checks. Any unsupported output type must fail clearly without silently producing a substitute format.

Browser checks may verify deck identity, fixed-canvas overflow, runtime resource failures, non-empty output, and one exported page per planned slide. They are quality gates, not permission to alter source content.

## Operating boundaries

- Do not accept free-form model-authored HTML as the normal deterministic path.
- Do not use host-specific assets or implicit dependencies.
- Do not embed credentials, private configuration, or provider identifiers in generated artifacts.
- Put build output in the active project or a user-specified output directory.
- Treat a human review of the final rendered deck as the final acceptance check.
