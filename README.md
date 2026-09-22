# Slide Skill

A source-only Node workspace for authoring semantic presentation decks in Markdown, validating their contracts, and rendering deterministic presentation artifacts.

## Status

This repository is preparing for a future public GitHub source release. It is **not** an npm package, does not promise a stable plugin SDK, and does not publish private Themes. The bundled public reference workflow uses the `brief-ink` Theme.

## What works today

- Markdown deck parsing, validation, migration, and content preflight.
- Deterministic HTML rendering through the public `brief-ink` reference Theme.
- PDF export through an installed local Chromium runtime.
- A constrained native PPTX path for maintained target/template combinations.
- Explicit, fail-closed private-provider selection for authorized private projects.

## Known limits

- PNG export is intentionally unsupported and fails explicitly.
- PPTX support is target/template-specific; it is not broad Web/PPTX parity.
- Package QA does not replace desktop PowerPoint open/edit/save/reopen acceptance.
- Private providers are optional, externally configured, and unavailable by default.

## Prerequisites

- Node.js 22
- npm 10 or later
- Chromium installed locally only when running browser/PDF checks

Use the lockfile for reproducible setup:

```bash
npm ci
npm run typecheck
npm test
npm run test:browser
npm run audit:public
```

Browser tests report unavailable local browser coverage rather than downloading a browser implicitly. CI installs the matching browser runtime explicitly.

## Quickstart

Run commands from this source checkout. Generated output must be outside the checkout.

```bash
npm run slide -- validate examples/v1-valid-consulting-deck.md
npm run slide -- preflight examples/v1-valid-consulting-deck.md \
  --config examples/v1-valid-consulting-deck.render.yaml \
  --target web \
  --out /tmp/slide-example/render-plan.json
npm run slide -- render examples/v1-valid-consulting-deck.md \
  --config examples/v1-valid-consulting-deck.render.yaml \
  --target web \
  --out /tmp/slide-example/index.html
```

The deck is the business-content source. Render configuration selects a canonical Theme ID and output/QA policy; it never contains provider locations or visual layout overrides.

## Public/private boundary

Public source contains only the `brief-ink` reference Theme. Private providers remain externally configured, explicitly selected, and fail closed when unavailable. Do not add private provider paths, credentials, fonts, project material, generated artifacts, or local operator configuration to this repository.

## Documentation

### Use and contribution

- [Deck authoring contract](docs/content-contract-v2.md)
- [Rendering and configuration](docs/render-configuration-v1.md)
- [Web rendering behavior](docs/web-render-contract-v1.md)
- [Compatibility baseline](docs/compatibility-baseline-v1.md)
- [Feedback workflow](docs/feedback-loop-v1.md)
- [Security reporting](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

### Maintainer and release controls

- [Brief Ink provenance](docs/brief-ink-provenance-v1.md)
- [Public payload audit policy](docs/public-audit-policy-v1.json)
- [Theme extension architecture reference](docs/theme-extension-contract-v1.md)
- [Slide terminology architecture reference](docs/slide-terminology-architecture-v1.md)

Theme/provider architecture references are experimental implementation guidance, not a frozen external SDK.

## License and release gate

This workspace is licensed under [MIT](LICENSE). Brief Ink redistribution is approved for this public source candidate; later fonts, imagery, templates, or third-party assets require their own rights review. The repository remains an unreleased source candidate until Git/release governance is separately completed.
