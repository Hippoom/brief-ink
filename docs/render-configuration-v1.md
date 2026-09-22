# Render configuration v1

A deck's semantic source and rendering choices are separate:

```text
<name>.deck.md       canonical business content
<name>.render.yaml   canonical Theme ID, profile, delivery outputs, and QA policy
```

## Render configuration

```yaml
theme: <canonical-theme-id>
profile: executive-compact

output:
  directory: build
  html: true
  pdf: true
  png: false
  pptx: false

qa:
  fail_on_overflow: true
  fail_on_missing_asset: true
```

`theme` is required. It is a canonical Theme ID, never a provider identifier, registry entry, package, bridge, or filesystem location. `profile` is optional and defaults to the Theme manifest's `default_profile`. A built-in profile uses its short name. A project profile uses a relative YAML reference.

`output.directory` defaults to `build`; `html` defaults to `true`; `pdf`, `png`, and `pptx` default to `false`. QA defaults are strict: both failure flags default to `true`. `pptx` is not a Web sidecar: the native route requires `output.pptx: true` with `html`, `pdf`, and `png` all set to `false`.

## Theme naming

A Theme is a complete, maintained visual system. Public projects may use only the allowlisted bundled public Theme ID. Private projects keep their selected canonical Theme ID in render YAML, while provider authorization stays outside YAML.

```yaml
theme: <canonical-theme-id>
profile: compact
```

Do not encode deck purpose, audience, delivery mode, organization, provider, or implementation details into Theme IDs. Those are separate dimensions:

```text
purpose / audience   semantic deck context
theme                canonical visual-system identity
profile              deck-wide delivery policy
provider             external availability and authorization
```

## Provider resolution and precedence

Provider resolution is external to render YAML and is fail-closed.

1. A public project resolves only the allowlisted bundled public Theme ID; private Themes are prohibited.
2. In a private project, the XDG user registry is the preferred daily mechanism for selecting an explicitly authorized provider.
3. A legacy environment bridge has higher precedence when present, but is deprecated and must not be used as the normal selection path.
4. A Git-ignored project-local Claude settings bridge is permitted only as a narrow, explicit bridge; it is not the only selection mechanism.
5. An unresolved, unauthorized, invalid, incompatible, or non-owning provider or target/profile fails preflight. There is no provider, Theme, adapter, or template fallback.

The XDG registry, legacy bridge, and Claude bridge may not serialize provider locations, identities, credentials, implementation details, or values into deck sources, render YAML, profiles, artifacts, plans, reports, feedback, or public payloads. Git ignore does not establish isolation.

## Profile inheritance

Configuration is resolved in this order:

```text
Theme defaults → Theme built-in profile → project profile → render.yaml output and QA settings
```

A project profile must inherit from a Theme profile. Profiles declare only values that differ from the inherited profile.

## Profile whitelist

Profiles may contain only these deck-wide policy fields:

```yaml
extends: <canonical-theme-id>/default

density_mode: standard # standard | compact
footer_policy: standard # standard | minimal | hidden
asset_policy: strict    # strict | allow-placeholder

qa:
  fail_on_overflow: true
  fail_on_missing_asset: true
```

`footer_policy: hidden` applies only to the regular Theme footer. It must never suppress visible source footnotes supplied by the deck.

## Theme-specific controlled options

A Theme may expose a small, documented deck-wide selector where it is part of that maintained Theme rather than free-form visual authoring. Such options must be declared and validated by the selected Theme, apply to the complete deck, and cannot introduce custom fields or slide-specific treatment.

## Prohibited configuration

Neither a profile nor a render configuration may set provider selection, provider configuration, CSS, templates, layouts, colors, licensed-resource policy, grids, margins, title placement, component styles, coordinates, dimensions, geometry, `structure`-to-template mappings, or slide-specific overrides. These are maintained Theme or external provider concerns, not project configuration.

If a project needs a different visual system or an additional semantic template, use a maintained Theme extension and explicit mapping rather than ad hoc overrides.

## Preflight

The Web integration first runs preflight, which resolves configuration and generates a Render Plan before deterministic HTML rendering:

```bash
slide preflight path/to/deck.md --config path/to/deck.render.yaml --out build/render-plan.json
```

Preflight blocks when semantic deck validation fails, the Theme/profile cannot be resolved, a configuration field violates the whitelist, a declared resource is invalid, or the selected Theme lacks a maintained mapping for a slide. The allowlisted public Theme supports deterministic standalone HTML through `slide render`.

## Native editable PPTX route

`slide render --target pptx` is a deliberately limited native presentation route, independent from the Web/HTML route. It consumes the same validated Deck IR and target-specific Render Plan, then generates native text boxes, shapes, rules, and fills. It does not convert HTML to images.

The maintained scope is explicitly declared by each Theme. Unsupported structures, missing descriptors, and undeclared resources fail clearly. A private provider may supply its own maintained native descriptor only when authorized through the external selection policy; the platform neither names nor assumes one.

Use an output policy dedicated to the native target:

```yaml
output:
  directory: build
  html: false
  pdf: false
  png: false
  pptx: true
```

```bash
slide preflight path/to/deck.md --config path/to/deck.render.yaml --target pptx
slide render path/to/deck.md --config path/to/deck.render.yaml --target pptx --out build/strategy.pptx
```

Default native artifact names are `index.pptx` and `pptx.qa.json`. An explicit output name creates a sibling QA report. The report checks package structure, expected editable text, slide count, declared geometry, and unsupported payloads. It is written before the binary artifact; a QA error blocks the `.pptx` write.

No closest-template fallback is permitted. Images, charts, tables, speaker notes, animations, native resource embedding, pixel parity with Web HTML, and broad template coverage remain deferred unless a maintained Theme descriptor explicitly supports them. Manual application edit/save/reopen remains required to complete interoperability acceptance.

## PDF export safety

Set `output.pdf: true` only after accepting the HTML review. The renderer then loads that same HTML in local browser automation, waits for declared resources, checks slide/Render Plan identity, detects fixed-canvas overflow and failed runtime resource loads, writes `qa.json`, and creates PDF only when no configured blocking finding remains. Overflow obeys `qa.fail_on_overflow`; resource failure obeys `qa.fail_on_missing_asset`. When either is `false`, the finding remains a warning and does not block PDF. PDF output is checked for a non-empty artifact and one page per planned slide.

Install the version-coupled browser explicitly; no postinstall download or host-browser discovery occurs:

```bash
npm install
npx playwright install chromium
```

With default output names, requested HTML/PDF use `index.html` and `index.pdf`, with `qa.json` beside them. PNG is deferred: `output.png: true` fails clearly instead of being silently ignored.
