# Morning Handoff

## Finished
- Original MIT-licensed personal relational spreadsheet with Rust/WASM calculations and SQLite server.
- Familiar editable grid, linked records, formulas, lookups/rollups, five view types, CSV import/export, complete backups and history.
- Browser-local storage and standalone native packaging, Docker instructions, dependency notices, CI and release workflows.

## Try It
Run `./scripts/run-local.sh`, then open http://127.0.0.1:7777. Or `pnpm dev` for the browser edition after `pnpm run build:wasm`. Sample data is synthetic and editable. Export a complete JSON backup before clearing browser data.

## Checks
Rust: 21 tests, formatting and strict Clippy passed. Frontend: TypeScript, 32 unit tests and formatting passed. Eight real Chrome workflow cases passed, including mobile, linked calculations, CSV/backup restoration, and a 10,000-row × 30-column import/edit/reload. Native macOS ARM archive checksum and extracted executable passed a browser edit/SQLite process-restart smoke. Docker Linux ARM built and passed browser edit/container-replacement persistence as UID10001. Grid and persistence fixtures passed focused keyboard, paste, concurrent-save and history checks.

## Decisions
- Personal/self-hosted first, as selected by the user. No team accounts, live collaboration, attachments, automation builder or full Airtable compatibility claim.
- Original implementation from public behavior documentation; implementation provenance and AI assistance disclosed.
- Save conflicts stop writes and offer an unsaved backup. Remote server access needs the operator’s authenticated proxy.

## Remaining
- Publish the checked source and browser edition; verify public access and release downloads.
- Complete hosted cross-platform release checks.
- Post one disclosed, relevant Reddit comment after release verification.

## Review First
Start with `README.md`, `docs/PROVENANCE.md`, and `docs/contract.md`. Release workflows describe checks; their existence does not mean a remote run has passed.
