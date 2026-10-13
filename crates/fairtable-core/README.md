# Fairtable core

Original Rust implementation shared by the server and browser. No proprietary
application source, bundles, assets, or clone implementation was used.

`validate_workspace(&Value)` checks the persisted document contract and returns a
descriptive error. `evaluate_workspace(&Value)` returns `{values, errors}` keyed
by table, record, and field ID without changing the document. Formula failures
produce a null calculated cell plus its error. An invalid document produces empty
maps and a top-level `error`; callers should validate before saving.

Link fields may declare `inverseFieldId`. Declared pairs must point back to each
other and contain reciprocal record memberships. Links without an explicit
inverse remain independent, one-way relationships.

With `--features wasm`, wasm-bindgen 0.2.108 exports `validate(json)` and
`evaluate(json)`. Both reject invalid JSON/documents; `evaluate` returns a JSON
string. The feature is optional for native consumers.

## Formulas

Field references use `{Field name}` and resolve without case sensitivity. Field
names must be unique within a table, also without case sensitivity. Expressions
support numeric and quoted string literals, parentheses, unary signs, `+ - * /`,
string concatenation `&`, and `= != < > <= >=` comparisons. Escape quoted strings
with a backslash. Bare `TRUE`, `FALSE`, and `BLANK` are also recognized.

Functions: `IF`, `AND`, `OR`, `NOT`, `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`,
`COUNTA`, `CONCATENATE`, `ROUND`, `ABS`, `UPPER`, `LOWER`, `LEN`, `TRIM`, `LEFT`,
`RIGHT`, `YEAR`, `MONTH`, `DAY`, `TODAY`, `TRUE`, `FALSE`, `BLANK`.

- `IF`, `AND`, and `OR` evaluate only the branches they need.
- Arithmetic treats blank values as zero and accepts numeric strings. Comparisons
  compare numbers numerically when both operands are numbers, otherwise text
  lexically. Equality preserves value types except equivalent numeric values.
- Aggregations flatten arrays and accept numeric strings. They skip blank,
  boolean, and nonnumeric values for numeric operations. `SUM` of no numbers is
  zero; `AVERAGE`, `MIN`, and `MAX` of no numbers return null. `COUNT` counts numeric
  values; `COUNTA` counts nonempty values, including false and zero.
- `TODAY()` uses the UTC calendar date. Date functions expect `YYYY-MM-DD`.
- Text lengths and slicing count Unicode characters. `TRIM` removes surrounding
  whitespace. `ROUND` supports integer precision from -15 through 15.
- Lookups return arrays of strings, matching the document's cell types. Rollups
  aggregate underlying linked values, including calculated fields; `ARRAYJOIN`
  joins non-null values with a comma and space.
- Cycles and invalid references produce cell errors. Formulas are limited to
  8192 bytes, 2048 tokens, and 128 nesting/evaluation levels. Dependency chains
  also have a 128-level limit. Calculated text is limited to 1 MiB.

These are Fairtable's documented semantics, not a claim of complete formula
compatibility with another product.

## Checks

```sh
cargo test -p fairtable-core --features wasm
cargo clippy -p fairtable-core --all-targets --features wasm -- -D warnings
cargo check -p fairtable-core --target wasm32-unknown-unknown --features wasm
```
