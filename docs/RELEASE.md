# Fairtable 0.1.1 — everyday workflow polish

Fairtable is an independent, MIT-licensed relational spreadsheet. Its goal is a familiar workflow for people who already know Airtable, with a Rust calculation engine and data stored in a local browser or a self-hosted SQLite database.

## What changed

- **Paste creates the records you need.** In an unrestricted grid, a rectangular paste can extend past the final record. New records and cell edits save together and undo in one step. Invalid values or exceeding the 25,000-record limit leave the workspace unchanged. Calculated cells stay calculated. Clear search, filters, sorting and grouping before pasting additional records; existing visible records remain editable in those views.
- **Keyboard editing works more naturally.** Tab and Shift+Tab leave the grid at its boundaries. Picker options, Clear and Done can be reached with Tab, and Enter activates the focused button without accidentally changing another option.
- **Forms catch invalid drafts.** Invalid numeric input blocks submission instead of silently dropping the value. Errors identify the field, and correcting or canceling an invalid draft restores normal editing.
- **Kanban separates empty values from named options.** An option called “Unassigned” no longer duplicates its records in the empty stack, which is labeled “No Status” (or the chosen field's name).
- **Schedule undated records by dragging.** Calendar records without dates can be dragged onto a day and retain their date after reload.

Workspace and backup formats are unchanged. Existing personal-edition features include bases and tables; linked records, formulas, lookups and rollups; five view types; CSV import and view export; full JSON backup/restore; undo/redo; and 30 persisted historical snapshots.

## Validation before publication

- 21 Rust tests, Rust formatting and strict Clippy passed.
- TypeScript compilation, 32 unit tests and formatting passed.
- All 17 Chrome workflow tests passed, including nine new regressions for the changes above. Existing coverage includes browser persistence, reciprocal links, calculated fields, CSV/backup restoration, mobile viewport behavior and a 10,000-row × 30-field import/edit/reload.
- The production Rust/WASM and browser build passed; bundled dependency notices were regenerated.

The browser tool blocked opening the local preview during this pass, so no new manual visual inspection is claimed. Mobile checks use Chrome viewport emulation; physical iOS/Safari remains untested. Cross-platform binaries publish only after release CI completes its native tests and packaged-server startup/persistence checks; consult [the release runs](https://github.com/harrisonoconnorhover/fairtable/actions/workflows/release.yml) for their results.

## Install and scope

Extract the [native archive for your platform](https://github.com/harrisonoconnorhover/fairtable/releases/tag/v0.1.1), run `./fairtable`, and open http://127.0.0.1:7777. The interface and SQLite engine are included. Linux binaries require glibc 2.39 or later. macOS builds are unsigned and not notarized. The web ZIP is a browser-only build for a static HTTP(S) server; records stay in that browser profile. Export a complete JSON backup before clearing browser data.

This personal edition does not include team accounts, permissions, live collaboration, public form collection, attachments, automation builders, integrations, or full Airtable formula/API compatibility. The native server has no login and requires an authenticated HTTPS proxy for remote use. See the [README](../README.md) for hosting and backup instructions.

## Provenance

Implementation and testing used AI assistance. No Airtable source, proprietary assets, or clone implementation was used to implement the product. See [the process and public references](PROVENANCE.md). This describes the development method; it is not a legal audit or a compatibility certification.
