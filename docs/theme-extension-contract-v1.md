# Theme extension contract v1

## Purpose

This contract defines the boundary between platform orchestration and independently versioned Themes. It is an architecture contract for the first plugin-extraction slice; it does not prescribe package-discovery mechanics.

## Ownership

| Platform owns | Theme owns |
|---|---|
| Presentation semantic validation | Theme identity and version |
| Profile resolution and Presentation-level selection | tokens and typography |
| Render Plan construction | Archetype catalog |
| no-fallback enforcement | base-target adapter implementation |
| artifact output safety | Theme-specific options and runtime state |
| generic issue/report protocol | reference, asset, and provenance policy |
| generic Web browser QA and Web → PDF export | Theme-specific artifact, visual, and interoperability QA |

The platform must not contain organization-specific Theme logic, licensed-resource files, restricted assets, environment-specific locations, visual geometry, or named renderer branches.

## Theme contract

A Theme is independently versioned and provides:

```text
manifest
visual tokens
archetype definitions
base-target adapters
reference / asset provenance
fixtures
Theme-specific QA extensions
```

The manifest declares explicit mappings from semantic applicability to adapter template/archetype identifiers. Every identifier must belong to the adapter that declares it. A missing mapping or unsupported target is a structured issue; no closest-template fallback is allowed.

Brief Ink is the bundled public reference Theme. An operator-managed private provider, if explicitly configured and selected, must meet the same contract while its internal identity and implementation remain opaque.

## Archetype contract

A Theme is a versioned presentation design-system package: **Foundations**, executable **Design Tokens**, Visual Primitives, Visual Archetypes, Target Compositions, Target Adapters, assets/provenance, fixtures, and Theme-specific QA. Foundations define reading-oriented rules such as Typography, Color, Spacing, surfaces, and source/footer treatment; they may draw on brand guidance but are not synonymous with it. Design Tokens are the machine-readable expression of those Foundations. The platform's **Content Pattern** and **Relationship Intent** describe semantic content; a Theme's **Visual Archetype** describes a reusable visual contract for eligible semantic input. A **Target Composition** is that Archetype's concrete Web, PPTX, or future target realization. Existing manifest `template` IDs remain compatibility projections during the terminology migration; they are not the long-term architectural term. See [slide terminology architecture v1](slide-terminology-architecture-v1.md).

Each Theme Visual Archetype declares:

```text
id and version
semantic applicability
required blocks
capacity / fit contract
base-target support state
composition owned by the Theme
validation requirements
fixture coverage and maturity state
```

A Slide does not author an Archetype. Render Planning selects one from Slide semantics, Theme, Profile, and target.

## Private Master/Slide Layout Integration

A PowerPoint **Slide Master** and its **Slide Layouts** are optional project-specific implementation resources, not a Theme prerequisite. In the public platform contract, layout names, placeholder counts, and inherited geometry are inventory evidence rather than semantic mappings. An authorized private project may define its own policy for inferring or approving semantic applicability and capacity from those facts; the project owns the resulting mapping's correctness.

An explicitly selected private Theme Provider may own a versioned Master/Slide Layout Integration manifest (for example, `slide-pptx-master-layout-integration/v1`). A private project decides its own authorized Session/directory, storage, reporting, and delivery policy for Master/Layout bindings, resources, fonts, assets, provenance, and interoperability evidence. The public platform and public release payload must not require, discover, or carry those values.

For the current public-provider integration contract, a private Provider's PPTX adapter validates its manifest during `prepare`. At minimum it verifies the supported schema version, selected Theme and PPTX target applicability, required private inputs, and coherence between its compatible PPTX descriptor, explicit structure-to-template projection, and adapter-owned `templateIds`. A successful validation retains the manifest and derived bindings only in opaque adapter runtime state; provider configuration `options` are serialized into the public Render Plan and therefore may contain only values the selected project explicitly approves for that plan. A failure emits a generic provider-owned issue such as `private-master-layout-integration-invalid`, without exposing private identities, locations, or content. A separate private-project implementation may choose different validation, mapping, and reporting rules.

The current public-provider lifecycle remains fail closed:

```text
explicit private Theme selection
→ Provider returns the existing compatible descriptor
→ PPTX adapter validates private integration in prepare()
→ opaque runtime state remains in process
→ platform plans through the existing kind/structure → template projection
→ adapter template-ownership validation
```

The public platform cannot synthesize a mapping from a closest layout or select another Theme or adapter when a private integration is unavailable or incompatible. A private project may adopt its own explicit, authorized mapping and reporting policy—including whether to record private values in project-local configuration, QA, CLI, feedback, or artifacts—while remaining responsible for semantic preservation, editability, and acceptance. Direct Master reuse or mutation requires a separately maintained private target implementation and interoperability acceptance; this public contract does not imply that the bundled renderer imports a Master file.

## Adapter contract

A Theme adapter is registered for one base target (`web` or `pptx`). It must provide, conceptually:

```ts
interface ThemeAdapter {
  id: string;
  target: 'web' | 'pptx';
  templateIds: ReadonlySet<string>;

  preflight?(context: ThemePreflightContext): ThemePreflightResult;
  prepare?(context: ThemeRenderContext): ThemeRuntimeState;
  render(context: ThemeRenderContext): BaseArtifact;
  verify?(context: ThemeVerificationContext): RenderIssue[];
}
```

The exact TypeScript shapes are an implementation task. The contract requires these properties:

- Theme options are validated by the selected Theme adapter, not by named platform branches.
- Theme runtime state is opaque to the platform except where a serializable Render Plan fact is explicitly required.
- Adapters cannot use another adapter's template identifiers.
- Adapters preserve business text, ordering, source state, and semantic relationship; optional semantic fields are rendered exactly once when the adapter declares support, and fit problems become issues rather than content mutation.
- A Web adapter returns an artifact satisfying the generic browser QA hook contract.
- A PPTX adapter returns a native editable artifact and may add Theme-specific package/interoperability requirements. A Theme target that does not declare a template for a semantic structure remains explicitly unsupported; it must not fall back to a different template or artifact.

## Profile contract

A Profile definition is independently versioned and describes communication, consumption, delivery, and validation policy.

```text
Profile definition
├── density policy
├── footer / source visibility policy
├── asset and output policy
└── validation defaults
```

A Presentation selects a Profile reference. Themes may recommend or constrain compatible Profiles and may visually respond to profile policy, but Themes do not own Profile identity.

## Base target and export contract

```text
Base targets: Web, PPTX
Exports: derived artifacts such as PDF
```

For v1:

```text
Web adapter → HTML artifact → generic browser QA → PDF export
PPTX adapter → PPTX artifact → package QA + applicable interoperability QA
```

PDF is not a base semantic renderer. PPTX → PDF remains unsupported until a maintained export adapter is added.

## Capability and validation declarations

Capability belongs to the Theme Archetype / target declaration:

```text
unsupported
candidate
supported
supported-with-manual-interop-qa
```

Validation belongs to workflow policy:

```text
semantic
artifact
interop
visual
```

A Theme can add checks, but cannot weaken platform semantic preservation, output safety, or no-fallback behavior.

## Public/private distribution decision

After this contract is implemented, the intended distribution is:

```text
Public
├── @slide/core
├── @slide/plugin-sdk
├── @slide/cli
├── @slide/theme-brief-ink
└── @slide/skill

Operator-managed private distribution
└── opaque compatible Theme provider
```

A private provider may retain proprietary tokens, visual rules, references, licensed-resource policy, restricted fixtures, and target-specific QA. The public platform resolves a Theme by compatible ID and adapter contract; it does not contain organization-specific branches.

Before publishing, audit source and release artifacts for organization names, restricted reference materials, licensed-resource metadata, brand assets, environment-specific locations, and proprietary fixtures. Any existing reference style requires an independent rights decision before public distribution.
