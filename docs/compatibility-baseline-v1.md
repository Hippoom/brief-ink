# Compatibility baseline v1

## Purpose

This document records externally visible Slide Skill behavior that remains stable while later workspace and package work is planned. It is a controlled baseline, not a promise that every current limitation is permanent.

## Scope

The baseline covers the installed Skill entry point, CLI commands, semantic Deck behavior, render configuration, artifact safety, provider-selection policy, and neutral fixture flows. It does not initialize Git, create packages, move sources, inspect external projects, or alter Themes.

## Stable compatibility surfaces

```text
installed Skill entry point and relative workflow links
npm run slide -- <command>
node bin/slide.mjs <command>
validate | parse | migrate | content-preflight | preflight | render | feedback
*.deck.md
*.render.yaml
theme: <canonical-theme-id>
```

An absent or differently configured installed entry point is an environment coverage gap; the harness must not create, repair, remove, or repoint it.

## Provider-selection baseline

- Render YAML retains the canonical Theme ID in private projects and never carries a provider selection or provider location.
- A public project resolves only its allowlisted public Theme ID and cannot use a private Theme.
- The XDG user registry is the preferred daily mechanism for explicitly authorized private-provider selection.
- A legacy environment bridge has higher precedence when present, but is deprecated and not the normal selection path.
- Project-local Claude settings are permitted as a narrow explicit bridge, but are not the only private-provider mechanism.
- All unavailable, invalid, incompatible, unauthorized, or non-owning provider resolutions remain fail-closed, with no fallback.

## Command matrix

| Command / behavior | Baseline assertion |
|---|---|
| `validate` | Existing semantic diagnostics and exit behavior remain stable. |
| `parse` | Deck IR behavior remains stable; source locations are environment-specific. |
| `migrate` | Ambiguous legacy `Framework` stays review-required. |
| `content-preflight` | The v2 report remains `slide-content-preflight/v1`, provenance-oriented, and source-root output remains refused. |
| `preflight --target web` | Theme/profile/template mapping and external provider resolution remain explicit and fail-closed. |
| `render --target web` | HTML artifact naming and source-root output refusal remain stable. |
| Web → PDF | Remains a Web export with browser QA when requested. |
| `render --target pptx` | Maintained native behavior remains target-specific and separate from Web outputs. |
| PNG request | Remains explicitly deferred/failing; the baseline does not convert it into silent success. |
| `feedback` | Records remain under the caller project feedback location, never the Skill source location. |

## Fixture policy

Default baseline tests use only repository-owned, neutral fixtures. Snapshots and baseline records must not contain proprietary visual references, licensed resources, credentials, environment-specific locations, or binary artifact snapshots.

External smoke is opt-in only. It requires an operator-supplied disposable directory and must not discover, traverse, read, or write external projects automatically.

## Verification contract

A baseline run requires:

```bash
npm run typecheck
npm test
npm run test:browser
# Compatibility baseline checks are included in npm test.
```

Browser validation is conditional on an already-installed local browser runtime. The harness must not provision or download a browser. If unavailable, the missing browser coverage is reported rather than represented as a pass.

Compatibility harness assertions normalize temporary directories and platform line endings. They must not normalize command names, exit codes, diagnostic markers, semantic output, artifact naming, or output-safety behavior.

## Known limitations preserved deliberately

- The current root bin wrapper is cwd-sensitive; this baseline records that behavior but does not repair it.
- A configured Theme may resolve at preflight while lacking a renderer for a requested target; this baseline does not change that behavior.
- Native static/package QA does not replace application interoperability acceptance.
- The internal normalized Content Model is not emitted by `parse`, Render Plans, QA reports, or artifacts during the v1/v2 compatibility period; legacy `structure`, `relationship_model`, and template fields remain externally stable.
- An explicitly selected private Provider may validate a private Master/Slide Layout Integration in adapter preparation. This public baseline does not emit its manifest, Master/Layout bindings, source references, fonts, assets, or runtime state; provider configuration options serialized into a Render Plan must be explicitly public-safe. The validation does not change v1/v2 template planning or Brief Ink behavior. An authorized private project's Session/directory policy may decide whether its own local configuration, plans, CLI output, QA reports, feedback, or artifacts retain those values.
- Git initialization, package publication, workspace extraction, and distribution release remain deferred. Source-only repository readiness may add CI and public-payload controls without changing runtime behavior.

## Updating this baseline

A baseline update requires a review stating whether the changed result is:

```text
intentional compatible evolution
an expected test correction
a regression requiring a follow-up task
```

Incompatible CLI, Skill, Deck/config, artifact, Theme-ID, or output-safety changes require a separately approved migration task contract.
