# brief-ink visual rules

`brief-ink` is an organization-neutral, evidence-oriented theme. It uses a warm paper background, deep ink typography, restrained blue-teal emphasis, and structural—not decorative—components.

## Principles

- Reading order is stable: section label (where applicable), Title, Key Message, evidence.
- The 1600px canvas uses 112px left/right safe rails; the rail provides breathing room without changing the semantic reading order.
- Color indicates hierarchy or explicit semantic state; it never serves as the sole carrier of meaning.
- Use the accent color sparingly for anchors, key lines, and controlled emphasis—not as decoration.
- Cards exist only to separate peer groups; default shadow is none.
- Gradients, image backgrounds, decorative icons, and per-slide visual overrides are prohibited.
- Keep visible Deck footnotes independent from the regular theme footer. Place visible footnotes at the lower left and the page number at the lower right.
- CSS uses system-available font fallbacks. The first MVP does not require external font downloads.

## `explore-converge-cycles`

- The controlled two-cycle structure uses a maintained, content-first two-by-three Stage-panel composition: each source-ordered cycle presents Inputs → Exploration scope → Convergence outputs as three readable panels.
- Cycle labels, field labels, business lists, and the named handoff remain native semantic HTML. Panel-to-panel and handoff connectors are decorative only and are `aria-hidden`.
- The fixed first `focal` cycle receives the primary heading, border, and accent treatment. The fixed second `standard` cycle remains complete and fully legible with quieter hierarchy; color is never the sole distinction.
- The named forward handoff is visible between the two cycle rows. Its directional connector is decorative; the handoff label is readable source content.
- Panels have natural content height. Bilingual text wraps naturally and is never clipped, clamped, ellipsized, hidden, reordered, or shortened to fit.
- This is a conceptual scanning aid, not a general workflow diagram: geometry stays Theme-owned and does not enter Deck Markdown, render configuration, or the Render Plan.
- Do not copy reference imagery or branding. Gradients, shadows, external reference imagery, and author-supplied visual controls remain prohibited.

## Token intent

- `paper` is the normal slide canvas.
- `surface` is a component surface, not a second brand color.
- `ink`, `muted`, and `subtle` establish the text hierarchy.
- `accent` and `accent_soft` support selected emphasis.
- `positive`, `warning`, and `negative` are reserved for explicit semantic states.

See `tokens.yaml` for the executable token values.
