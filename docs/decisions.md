# Decisions

- 2026-10-13: Create a separate repository at `Documents/ChatGPT/fairtable`; never publish the private job-search workspace.
- Rust engine plus React browser UI keeps the product portable and makes keyboard/browser accessibility practical. The same original Rust validation/calculation code runs in WebAssembly and the SQLite server. This is a Rust-backed product, not a claim that every line is Rust.
- Use MIT for original code. No copied Airtable branding, icons, assets, source, or clone implementation. Behavior references come from public help documents and observation; publish the actual provenance and do not imply a legal audit.
- User selected a complete personal/self-hosted first release. Keep hosting accounts, paid infrastructure, enterprise SSO, and integration marketplaces outside the first release. Do not show unfinished enterprise controls.
- 2026-10-13: Clipboard paste may append rows only in an unfiltered, unsorted, ungrouped grid without a search. Parse and validate the entire block, then append and edit in one workspace mutation/undo step. Existing filtered records remain pasteable; ambiguous row growth gets an actionable message.
