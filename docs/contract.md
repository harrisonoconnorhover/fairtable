# Fairtable document and engine contract

All keys use camelCase. IDs are opaque strings generated in the UI with crypto.randomUUID(). No credentials are stored in the document.

```ts
type Cell = null | string | number | boolean | string[];
type FieldType = 'text'|'longText'|'number'|'currency'|'percent'|'checkbox'|'date'|'email'|'url'|'singleSelect'|'multiSelect'|'link'|'formula'|'lookup'|'rollup';
interface Field {
  id: string; name: string; type: FieldType; width: number;
  options?: {id:string;name:string;color:string}[];
  linkedTableId?:string;
  formula?:string;
  linkFieldId?:string; targetFieldId?:string;
  aggregation?:'SUM'|'AVERAGE'|'MIN'|'MAX'|'COUNT'|'COUNTA'|'ARRAYJOIN';
  precision?:number; description?:string;
}
interface Record {id:string;cells:{[fieldId:string]:Cell};createdAt:string;updatedAt:string}
interface Filter {id:string;fieldId:string;operator:'contains'|'notContains'|'is'|'isNot'|'empty'|'notEmpty'|'gt'|'lt'|'gte'|'lte';value:string}
interface View {
  id:string;name:string;type:'grid'|'kanban'|'gallery'|'calendar'|'form';
  filters:Filter[];filterMode:'and'|'or';sorts:{fieldId:string;direction:'asc'|'desc'}[];
  hiddenFields:string[];groupFieldId?:string;dateFieldId?:string;
  rowHeight:'compact'|'comfortable'|'tall';
  formDescription?:string;requiredFields?:string[];
}
interface Table {id:string;name:string;fields:Field[];records:Record[];views:View[]}
interface Base {id:string;name:string;color:string;description:string;tables:Table[]}
interface Workspace {version:1;name:string;bases:Base[]}
```

Select cell values are option names. Link cell values are arrays of record IDs. Date cells use YYYY-MM-DD. The first field is the primary display field. Tables and fields are ordered by array order. No computed values are saved in cells.

Rust crate exports public `validate_workspace(&serde_json::Value) -> Result<(), String>` and `evaluate_workspace(&serde_json::Value) -> serde_json::Value`. Evaluation result: `{values:{[tableId]:{[recordId]:{[fieldId]:Cell}}},errors:{[tableId]:{[recordId]:{[fieldId]:string}}}}`. Computed link display strings belong in UI; engine returns raw cells for ordinary fields and calculated cells for formula/lookup/rollup fields. Invalid formulas are field-level errors, not document validation failures. Validation covers object shape, stable unique IDs, lengths, supported field types, cell types, finite numbers, and valid structural references; tolerate empty workspaces/tables. Deleted linked records should be removed by UI; engine rejects dangling links to protect imports. Limits: 50 bases, 100 tables total, 200 fields per table, 25,000 records total, 32 MiB document. Reject duplicates to prevent lookup ambiguity. Do not silently truncate.

WASM exports via wasm-bindgen 0.2.108: `validate(json: &str) -> Result<(), JsValue>` and `evaluate(json: &str) -> Result<String, JsValue>`. Expose under a `wasm` feature so server has no web dependency.

Rust server HTTP contract:
- `GET /api/health` -> `{name:"Fairtable",version:"0.1.0",storage:"sqlite"}`.
- `GET /api/workspace` -> `{revision:number,workspace:Workspace|null}` (null for fresh store).
- `PUT /api/workspace` JSON `{revision:number,workspace:Workspace}` -> `{revision:number}`; conflict is HTTP409 with `{error:string,revision:number}`. Validate through core before atomic persistence.
- `GET /api/history` -> `[{id:number,createdAt:string,label:string}]`, newest first, up to 30 snapshots.
- `POST /api/restore/:id` JSON `{revision:number}` -> `{revision:number,workspace:Workspace}`; same CAS checks.
- `GET /api/export` -> complete workspace JSON attachment.
- `PUT` accepts optional `label` string for history. Empty initial workspace is seeded by UI, never overwrite existing data.
- Serve built `dist/` with SPA fallback. Embed assets in release when possible; permit `FAIRTABLE_ASSETS` path in development.
- Bind 127.0.0.1:7777 by default. `FAIRTABLE_DATA` path controls SQLite, `FAIRTABLE_HOST`/`FAIRTABLE_PORT` optional. Local personal app; remote self-hosting requires own authenticated TLS reverse proxy. Enforce same-origin writes; do not enable wildcard CORS. If endpoint errors occur UI must not silently fall back to browser storage.

Browser edition uses IndexedDB transaction revision checks for persistence, same JSON document/core, export/restore, browser-local history, and cross-tab change notification. It is a usable personal edition, not simulated data. A sample base is clearly marked as a starter template and can be deleted.
