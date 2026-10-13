# Morning Handoff

## Finished
- Original MIT-licensed personal relational spreadsheet with Rust/WASM calculations and SQLite server.
- Familiar editable grid, linked records, formulas, lookups/rollups, five view types, CSV import/export, complete backups and history.
- Browser-local storage and standalone native packaging, Docker instructions, dependency notices, CI and release workflows.
- Published [source](https://github.com/harrisonoconnorhover/fairtable), [browser app](https://fairtable.deleteddeleted.chatgpt.site), and [v0.1.0 downloads](https://github.com/harrisonoconnorhover/fairtable/releases/tag/v0.1.0).
- Posted a disclosed [Reddit introduction](https://www.reddit.com/r/nocode/comments/1vf52uw/comment/pgic7ua/) in the Airtable acquisition discussion; submission and permalink verified.

## Try It
Open the browser app above, or extract the native release for your platform, run `./fairtable`, and open http://127.0.0.1:7777. Source checkout: `./scripts/run-local.sh`. Sample data is synthetic and editable. Export a complete JSON backup before clearing browser data.

## Checks
Rust: 21 tests, formatting and strict Clippy passed. Frontend: TypeScript, 32 unit tests and formatting passed. Eight real Chrome workflow cases passed, including mobile, linked calculations, CSV/backup restoration, and a 10,000-row × 30-column import/edit/reload. Native macOS ARM archive checksum and extracted executable passed a browser edit/SQLite process-restart smoke. Docker Linux ARM built and passed browser edit/container-replacement persistence as UID10001. Grid and persistence fixtures passed focused keyboard, paste, concurrent-save and history checks.

[Release CI](https://github.com/harrisonoconnorhover/fairtable/actions/runs/38428816333) passed all checks and native Linux/macOS Intel/ARM packaging and persistence tests. All ten expected assets are published. Actual downloaded Mac ARM and web archives passed checksums; the downloaded native app passed UI/WASM/save checks. Public browser edit/save/reload passed. Evidence is in ignored `artifacts/`.

## Decisions
- Personal/self-hosted first, as selected by the user. No team accounts, live collaboration, attachments, automation builder or full Airtable compatibility claim.
- Original implementation from public behavior documentation; implementation provenance and AI assistance disclosed.
- Save conflicts stop writes and offer an unsaved backup. Remote server access needs the operator’s authenticated proxy.

## Remaining
- The first release is personal/self-hosted; team features remain outside its scope.
- macOS downloads are unsigned/unnotarized; Windows native binaries are not packaged.
- Physical iOS/Safari testing remains unperformed; mobile checks used Chrome emulation.

## Review First
Start with `README.md`, `docs/PROVENANCE.md`, and `docs/contract.md`. Release code is tagged `v0.1.0` at `94cc6da`; the linked release run records the completed cross-platform checks.
