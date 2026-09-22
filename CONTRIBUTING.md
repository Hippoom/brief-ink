# Contributing

## Before opening a change

- Use Node 22 and npm 10 or later.
- Install with `npm ci`.
- Keep deck business meaning separate from Theme-owned visual implementation.
- Keep generated output outside the source checkout.
- Do not add private provider identifiers, local paths, credentials, customer content, proprietary fonts, master templates, or generated delivery artifacts.

## Validation

Run the relevant checks before proposing a change:

```bash
npm run typecheck
npm test
npm run test:browser
npm run audit:public
```

Browser coverage needs a locally installed Chromium runtime. A skipped local browser test is a coverage gap, not evidence that browser QA passed.

## Change expectations

- Add or update tests for changed contract, CLI, or renderer behavior.
- Update public documentation when supported behavior changes.
- Preserve fail-closed behavior: do not add template, Theme, target, provider, or asset fallbacks.
- Keep public documentation provider-neutral. Private provider work needs its own authorized external workspace and tests.

## Scope boundaries

A contribution does not authorize private-provider extraction, npm publication, Plugin SDK stabilization, new asset/media support, or a project generator transition. Those require separately approved work.
