# Fairtable 0.1.0 — personal edition

Fairtable is an independent, MIT-licensed relational spreadsheet. Its goal is a familiar workflow for people who already know Airtable, with a Rust calculation engine and data stored in a local browser or a self-hosted SQLite database.

This release includes bases and tables; keyboard grid editing and rectangular clipboard operations; linked records, formulas, lookups and rollups; grid, kanban, gallery, calendar and personal form views; CSV import and view export; full JSON backup/restore; undo/redo; and 30 persisted historical snapshots.

The personal edition does not include team accounts, permissions, live collaboration, public form collection, attachments, automation builders, integrations, or full Airtable formula/API compatibility. It has no telemetry or record-upload service. The browser edition stores records in the current browser profile. The native server has no login and requires an authenticated HTTPS proxy for remote use.

## Validation before publication

- 21 Rust unit tests, Rust formatting, and strict Clippy passed.
- 32 TypeScript unit tests, TypeScript compilation, and formatting passed.
- Eight real Chrome workflow cases passed: persistence and undo; reciprocal links; alternate views/forms; failed import atomicity and backup restoration; mobile; calculated field renaming; 10,000 rows × 30 fields; calculated primary record names.
- Focused grid checks covered keyboard movement, editing/cancel, TSV clipboard operations, virtualization, grouping, resizing/reordering and row operations.
- Focused persistence checks covered IndexedDB and SQLite revision races, history retention/restoration, failures, cross-tab conflicts and restart durability.
- Extracted macOS ARM native archive passed checksum, embedded UI/WASM, browser edit and process-restart persistence, JSON export and rejected invalid/stale-write checks.

- Docker Linux ARM built and ran as an unprivileged user; browser edits survived replacing the container with the same persistent volume. Shell and workflow syntax checks passed.

Screenshots use synthetic starter data. Mobile verification uses Chrome viewport emulation; physical iOS/Safari has not been tested. Cross-platform binaries are published by the release workflow only after their native tests and startup/persistence checks succeed. Consult the linked release run for its result. macOS builds are unsigned and not notarized.

## Provenance

Implementation and testing used AI assistance. No Airtable source, proprietary assets, or clone implementation was used to implement the product. See [the process and public references](PROVENANCE.md). This describes the development method; it is not a legal audit or a compatibility certification.
