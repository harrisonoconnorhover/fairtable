# Independent implementation

Fairtable is an independent implementation of familiar relational-spreadsheet workflows. It is not affiliated with or endorsed by Airtable. Fairtable's original code is MIT licensed.

## Method

Feature specifications were derived from public Airtable help articles and observable product concepts. Implementation workers started with the Fairtable specification and did not receive Airtable source, bundles, decompiled code, extracted artwork, or third-party clone code. No Airtable logos, fonts, icons, or other proprietary assets are included. The lead previously researched public alternatives for feasibility; those repositories were not used as implementation sources. This describes our process, not an independent legal audit or a claim that we implement every Airtable behavior.

Public references reviewed October 13, 2026:
- [Views](https://support.airtable.com/articles/5189551686-getting-started-with-airtable-views)
- [Grid view](https://support.airtable.com/articles/7905594155-airtable-grid-view)
- [Keyboard shortcuts](https://support.airtable.com/articles/7980233311-airtable-keyboard-shortcuts)
- [Supported field types](https://support.airtable.com/articles/4808831313-supported-field-types-in-airtable-overview)
- [Filtering](https://support.airtable.com/articles/9290731839-filtering-records-using-conditions)
- [Sorting](https://support.airtable.com/articles/8716174546-sorting-records-in-airtable-views)
- [Grouping](https://support.airtable.com/articles/7361540623-grouping-records-in-airtable)
- [Linked records](https://support.airtable.com/articles/3370222027-linking-records-in-airtable)
- [Lookup](https://support.airtable.com/articles/8927322518-lookup-field-overview)
- [Rollup](https://support.airtable.com/articles/7497685062-rollup-field-overview)
- [Formula reference](https://support.airtable.com/articles/7330071120-airtable-formula-field-functions-reference)
- [Kanban](https://support.airtable.com/articles/9686375912-getting-started-with-airtable-kanban-views)
- [Gallery](https://support.airtable.com/articles/6624642620-getting-started-with-airtable-gallery-views)
- [Calendar](https://support.airtable.com/articles/1834189958-getting-started-with-airtable-calendar-views)
- [Forms](https://support.airtable.com/articles/8588280258-getting-started-with-airtable-form-views)

## Dependencies and assets

Rust uses ordinary open-source infrastructure (Serde, wasm-bindgen, Axum, Tokio, rusqlite/SQLite and their dependencies). The interface uses React, TanStack Virtual, Papa Parse, and Lucide icons. Their licenses remain applicable; exact versions are in Cargo.lock and pnpm-lock.yaml. Fairtable's mark is original SVG geometry. Sample data is synthetic and ships as an editable starter base.

Implementation and tests were developed with AI assistance under Harrison O'Connor-Hoover's direction. Public release claims must match the verification recorded in the release notes; there is no claim of independently audited security or complete Airtable feature parity.
