# Slide Skill maintainer guidance

## Scope and boundaries

- Treat `*.deck.md` as business/semantic source and Themes as visual implementation.
- Keep public source limited to public-neutral code, documentation, examples, and the Brief Ink reference Theme.
- Private providers, project artifacts, credentials, local paths, fonts, Master files, and generated deliverables must not enter this repository.
- Provider selection is explicit and fail closed. Render YAML names a Theme ID, never a provider location.

## Working rules

- Plan material behavior, architecture, contract, multi-file, or public-interface changes before implementation.
- Preserve legacy compatibility unless an approved migration explicitly changes it.
- Do not silently shrink, truncate, hide, reorder, or rewrite Deck content to solve fit.
- Run relevant validation after changes: `npm run typecheck`, `npm test`, `npm run test:browser`, and `npm run audit:public` for public-candidate changes.
- Escalate Git commits, remotes, pushes, GitHub actions, package publication, rights decisions, private-provider changes, and project-artifact changes for explicit approval.
