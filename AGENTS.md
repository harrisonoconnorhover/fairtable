# Fairtable

Fairtable is an independently implemented, open-source relational spreadsheet. Its promise is: **If you know how to use Airtable, you know how to use Fairtable.**

## Working rules
- Write original code from our behavior specification and public documentation. Do not inspect or copy Airtable source, bundles, proprietary assets, or another Airtable clone's implementation. Ordinary licensed infrastructure libraries are allowed; record dependencies and attribution.
- Prefer working everyday workflows over decorative parity. No inert buttons, simulated saving, or unsupported compatibility claims.
- Rust owns validation and calculated fields. The browser UI is TypeScript/React; the same Rust core runs through WebAssembly and in the self-hosted server.
- Preserve user data. Failed validation or revision conflicts must never overwrite the last saved workspace. Export and restore must round-trip it.
- Work in this repository only. No private job-search data, credentials, or local workspace databases in Git.
- Workers are not alone in the codebase: respect ownership, never revert other agents' edits, and coordinate interface changes.
- Run focused Rust and browser checks, real workflow tests, and visual/mobile inspection before release. Do not claim unrun tests or complete Airtable parity.
- Keep `HANDOFF.md` under 500 words with the required Morning Handoff sections. Commit completed work. Public source/release and one appropriate Reddit launch post are authorized by the user, after completion and verification.

## Commands
Use the pinned toolchain in `rust-toolchain.toml`. Frontend commands live in the root `package.json`. Do not change dependency manifests while an install is running.

## Ownership
- `crates/fairtable-core/`: Rust engine worker.
- `crates/fairtable-server/`: server worker.
- `web/`, root manifests, documentation, release and browser testing: lead agent unless reassigned.
