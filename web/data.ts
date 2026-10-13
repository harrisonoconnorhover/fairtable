import Papa from "papaparse";
import {
  id,
  emptyView,
  newRow,
  isComputed,
  type Workspace,
  type Table,
  type Field,
  type Cell,
  type CellChange,
  type Row,
  type View,
  type Evaluation,
  type Base,
} from "./types";

export const findTable = (workspace: Workspace, tableId: string) =>
  workspace.bases.flatMap((b) => b.tables).find((t) => t.id === tableId);
export const rawValue = (
  evaluation: Evaluation,
  table: Table,
  row: Row,
  field: Field,
): Cell =>
  evaluation.values[table.id]?.[row.id]?.[field.id] ??
  row.cells[field.id] ??
  null;
export function displayText(
  value: Cell,
  field?: Field,
  workspace?: Workspace,
): string {
  if (value === null || value === undefined) return "";
  if (field?.type === "link" && Array.isArray(value) && workspace) {
    const target = findTable(workspace, field.linkedTableId ?? "");
    return value
      .map((key) => {
        const row = target?.records.find((r) => r.id === key),
          primary = target?.fields[0];
        return row
          ? String(primary ? (row.cells[primary.id] ?? "Untitled") : "Untitled")
          : "";
      })
      .join(", ");
  }
  return Array.isArray(value)
    ? value.join(", ")
    : typeof value === "boolean"
      ? value
        ? "Yes"
        : "No"
      : String(value);
}
function orderedFilterValue(value: string, field?: Field): number | null {
  if (!value.trim()) return null;
  if (field?.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = Date.parse(value + "T00:00:00Z");
    return Number.isFinite(date) &&
      new Date(date).toISOString().slice(0, 10) === value
      ? date
      : null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function visibleRows(
  table: Table,
  view: View,
  evaluation: Evaluation,
  search: string,
  workspace: Workspace,
): Row[] {
  const text = (row: Row, fieldId: string) => {
    const f = table.fields.find((f) => f.id === fieldId);
    return f
      ? displayText(rawValue(evaluation, table, row, f), f, workspace)
      : "";
  };
  const matches = table.records.filter((row) => {
    if (
      search &&
      !table.fields.some((f) =>
        text(row, f.id)
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
      )
    )
      return false;
    const conditions = view.filters.map((filter) => {
      const value = text(row, filter.fieldId),
        a = value.toLocaleLowerCase(),
        b = filter.value.toLocaleLowerCase(),
        field = table.fields.find((f) => f.id === filter.fieldId);
      const compare = () => {
        const left = orderedFilterValue(a, field),
          right = orderedFilterValue(b, field);
        return left !== null && right !== null ? left - right : null;
      };
      switch (filter.operator) {
        case "contains":
          return a.includes(b);
        case "notContains":
          return !a.includes(b);
        case "is":
          return a === b;
        case "isNot":
          return a !== b;
        case "empty":
          return !a;
        case "notEmpty":
          return !!a;
        case "gt": {
          const delta = compare();
          return delta !== null && delta > 0;
        }
        case "lt": {
          const delta = compare();
          return delta !== null && delta < 0;
        }
        case "gte": {
          const delta = compare();
          return delta !== null && delta >= 0;
        }
        case "lte": {
          const delta = compare();
          return delta !== null && delta <= 0;
        }
      }
    });
    return (
      conditions.length === 0 ||
      (view.filterMode === "or"
        ? conditions.some(Boolean)
        : conditions.every(Boolean))
    );
  });
  const sorts = view.groupFieldId
    ? [{ fieldId: view.groupFieldId, direction: "asc" as const }, ...view.sorts]
    : view.sorts;
  if (sorts.length)
    matches.sort((a, b) => {
      for (const sort of sorts) {
        const f = table.fields.find((f) => f.id === sort.fieldId);
        if (!f) continue;
        const av = rawValue(evaluation, table, a, f),
          bv = rawValue(evaluation, table, b, f);
        let cmp = 0;
        if (av === null || av === "") cmp = bv === null || bv === "" ? 0 : 1;
        else if (bv === null || bv === "") cmp = -1;
        else if (f.type === "singleSelect")
          cmp =
            (f.options?.findIndex((o) => o.name === av) ?? -1) -
            (f.options?.findIndex((o) => o.name === bv) ?? -1);
        else if (typeof av === "number" && typeof bv === "number")
          cmp = av - bv;
        else
          cmp = text(a, f.id).localeCompare(text(b, f.id), undefined, {
            numeric: true,
            sensitivity: "base",
          });
        if (cmp) return sort.direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  return matches;
}
export function parseCell(text: string, field: Field): Cell {
  if (!text.trim())
    return field.type === "checkbox"
      ? false
      : field.type === "multiSelect" || field.type === "link"
        ? []
        : null;
  if (["number", "currency", "percent"].includes(field.type)) {
    const clean = text.replace(/[$,%]/g, "").trim(),
      value = Number(clean);
    if (!clean || !Number.isFinite(value))
      throw new Error(`“${text}” is not a number for ${field.name}.`);
    return value;
  }
  if (field.type === "checkbox") {
    if (/^(true|yes|1|checked)$/i.test(text)) return true;
    if (/^(false|no|0|unchecked)$/i.test(text)) return false;
    throw new Error(`Use Yes or No for ${field.name}.`);
  }
  if (field.type === "date") {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      Number.isNaN(Date.parse(text)) ||
      new Date(text + "T00:00:00Z").toISOString().slice(0, 10) !== text
    )
      throw new Error(`Use a valid YYYY-MM-DD date for ${field.name}.`);
    return text;
  }
  if (
    field.type === "singleSelect" &&
    !field.options?.some((o) => o.name === text)
  )
    throw new Error(`Choose an existing option for ${field.name}.`);
  if (field.type === "multiSelect") {
    const values = text
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.some((v) => !field.options?.some((o) => o.name === v)))
      throw new Error(`Choose existing options for ${field.name}.`);
    return values;
  }
  return text;
}
export function parseCsv(source: string): {
  headers: string[];
  rows: string[][];
} {
  const result = Papa.parse<string[]>(source, { skipEmptyLines: "greedy" });
  if (result.errors.length)
    throw new Error(`Could not read CSV: ${result.errors[0].message}`);
  if (!result.data.length) throw new Error("This file is empty.");
  if (result.data.length > 25001)
    throw new Error("Import up to 25,000 records at a time.");
  const width = Math.max(...result.data.map((row) => row.length));
  if (width > 200) throw new Error("Import up to 200 fields per table.");
  const used = new Set<string>();
  const headers = Array.from({ length: width }, (_, i) => {
    let h = result.data[0][i]?.trim() || `Field ${i + 1}`;
    const original = h;
    let suffix = 2;
    while (used.has(h.toLowerCase())) h = `${original} ${suffix++}`;
    used.add(h.toLowerCase());
    return h;
  });
  return {
    headers,
    rows: result.data
      .slice(1)
      .map((row) => Array.from({ length: width }, (_, i) => row[i] ?? "")),
  };
}
export function csvTable(
  name: string,
  headers: string[],
  rows: string[][],
  types: Field["type"][],
): Table {
  const fields: Field[] = headers.map((name, i) => ({
    id: id(),
    name,
    type: types[i] ?? "text",
    width: i === 0 ? 280 : 180,
  }));
  return {
    id: id(),
    name,
    fields,
    records: rows.map((values) =>
      newRow(
        Object.fromEntries(
          fields.map((f, i) => [f.id, parseCell(values[i] ?? "", f)]),
        ),
      ),
    ),
    views: [emptyView()],
  };
}
export function exportCsv(
  table: Table,
  view: View,
  rows: Row[],
  evaluation: Evaluation,
  workspace: Workspace,
): string {
  const fields = table.fields.filter(
    (f, i) => i === 0 || !view.hiddenFields.includes(f.id),
  );
  const safe = (s: string) =>
    /^[=+@\t\r]/.test(s) || /^-[^\d]/.test(s) ? "'" + s : s;
  return Papa.unparse(
    [
      fields.map((f) => safe(f.name)),
      ...rows.map((row) =>
        fields.map((f) =>
          safe(displayText(rawValue(evaluation, table, row, f), f, workspace)),
        ),
      ),
    ],
    { newline: "\r\n" },
  );
}
export function download(
  name: string,
  content: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function blankTable(name = "Table 1"): Table {
  return {
    id: id(),
    name,
    fields: [
      { id: id(), name: "Name", type: "text", width: 300 },
      { id: id(), name: "Notes", type: "longText", width: 260 },
      {
        id: id(),
        name: "Status",
        type: "singleSelect",
        width: 180,
        options: [
          { id: id(), name: "Todo", color: "#e8e9ed" },
          { id: id(), name: "In progress", color: "#dceafb" },
          { id: id(), name: "Done", color: "#d8f3e8" },
        ],
      },
    ],
    records: [],
    views: [emptyView()],
  };
}
export function blankBase(name: string, color = "#087f8c"): Base {
  return { id: id(), name, color, description: "", tables: [blankTable()] };
}
export function cloneBase(base: Base): Base {
  const clone = structuredClone(base);
  const map = new Map<string, string>();
  map.set(clone.id, id());
  for (const t of clone.tables) {
    map.set(t.id, id());
    for (const f of t.fields) {
      map.set(f.id, id());
      f.options?.forEach((o) => map.set(o.id, id()));
    }
    for (const r of t.records) map.set(r.id, id());
    for (const v of t.views) {
      map.set(v.id, id());
      v.filters.forEach((f) => map.set(f.id, id()));
    }
  }
  const remap = (value: string) => map.get(value) ?? value;
  clone.id = remap(clone.id);
  clone.name = base.name + " copy";
  for (const table of clone.tables) {
    const linkIds = new Set(
      table.fields
        .filter((field) => field.type === "link")
        .map((field) => field.id),
    );
    table.id = remap(table.id);
    for (const field of table.fields) {
      field.id = remap(field.id);
      field.options?.forEach((option) => {
        option.id = remap(option.id);
      });
      // External records stay linked, but their existing reciprocal field belongs
      // to the original base. The copy therefore retains a one-way link.
      if (field.linkedTableId && !map.has(field.linkedTableId))
        delete field.inverseFieldId;
      for (const key of [
        "linkedTableId",
        "inverseFieldId",
        "linkFieldId",
        "targetFieldId",
      ] as const)
        if (field[key]) field[key] = remap(field[key]);
    }
    for (const row of table.records) {
      row.id = remap(row.id);
      row.cells = Object.fromEntries(
        Object.entries(row.cells).map(([fieldId, value]) => [
          remap(fieldId),
          linkIds.has(fieldId) && Array.isArray(value)
            ? value.map(remap)
            : value,
        ]),
      );
    }
    for (const view of table.views) {
      view.id = remap(view.id);
      view.filters = view.filters.map((filter) => ({
        ...filter,
        id: remap(filter.id),
        fieldId: remap(filter.fieldId),
      }));
      view.sorts = view.sorts.map((sort) => ({
        ...sort,
        fieldId: remap(sort.fieldId),
      }));
      view.hiddenFields = view.hiddenFields.map(remap);
      if (view.requiredFields)
        view.requiredFields = view.requiredFields.map(remap);
      if (view.groupFieldId) view.groupFieldId = remap(view.groupFieldId);
      if (view.dateFieldId) view.dateFieldId = remap(view.dateFieldId);
    }
  }
  return clone;
}
export function removeRecords(
  workspace: Workspace,
  tableId: string,
  ids: string[],
) {
  const target = findTable(workspace, tableId);
  if (!target) return;
  target.records = target.records.filter((r) => !ids.includes(r.id));
  for (const t of workspace.bases.flatMap((b) => b.tables))
    for (const f of t.fields.filter(
      (f) => f.type === "link" && f.linkedTableId === tableId,
    ))
      for (const r of t.records) {
        const value = r.cells[f.id];
        if (Array.isArray(value))
          r.cells[f.id] = value.filter((key) => !ids.includes(key));
      }
}

const equalCell = (a: Cell | undefined, b: Cell) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((value, index) => value === b[index])
    : a === b;

/** Apply one atomic batch to a new snapshot. Only explicit inverse pairs synchronize. */
export function applyCellChanges(
  workspace: Workspace,
  tableId: string,
  changes: CellChange[],
  updatedAt = new Date().toISOString(),
): Workspace {
  const next = structuredClone(workspace),
    table = findTable(next, tableId);
  if (!table) throw new Error("This table no longer exists.");
  const records = new Map(table.records.map((row) => [row.id, row])),
    fields = new Map(table.fields.map((field) => [field.id, field]));
  for (const change of changes) {
    const row = records.get(change.recordId),
      field = fields.get(change.fieldId);
    if (!row || !field)
      throw new Error("This record or field no longer exists.");
    if (isComputed(field))
      throw new Error(`${field.name} is calculated and cannot be edited.`);
    let value = Array.isArray(change.value) ? [...change.value] : change.value;
    const before = row.cells[field.id];
    if (field.type === "link") {
      if (
        value !== null &&
        (!Array.isArray(value) || value.some((key) => typeof key !== "string"))
      )
        throw new Error(`Choose linked records for ${field.name}.`);
      if (Array.isArray(value)) value = [...new Set(value)];
      const linked = findTable(next, field.linkedTableId ?? "");
      if (!linked)
        throw new Error(`The linked table for ${field.name} no longer exists.`);
      const linkedRows = new Map(
          linked.records.map((record) => [record.id, record]),
        ),
        selected = new Set(Array.isArray(value) ? value : []);
      if ([...selected].some((key) => !linkedRows.has(key)))
        throw new Error(`A linked record for ${field.name} no longer exists.`);
      const inverse = field.inverseFieldId
        ? linked.fields.find(
            (candidate) => candidate.id === field.inverseFieldId,
          )
        : undefined;
      if (
        field.inverseFieldId &&
        (!inverse ||
          inverse.type !== "link" ||
          inverse.linkedTableId !== table.id ||
          inverse.inverseFieldId !== field.id)
      )
        throw new Error(
          `The reciprocal link for ${field.name} is not configured correctly.`,
        );
      if (!equalCell(before, value)) {
        row.cells[field.id] = value;
        row.updatedAt = updatedAt;
      }
      if (inverse) {
        const affected = new Set([
          ...(Array.isArray(before) ? before : []),
          ...selected,
        ]);
        for (const recordId of affected) {
          const other = linkedRows.get(recordId);
          if (!other) continue;
          const current = other.cells[inverse.id],
            keys = Array.isArray(current) ? current : [];
          const reciprocal = selected.has(recordId)
            ? [...new Set([...keys, row.id])]
            : keys.filter((key) => key !== row.id);
          if (!equalCell(current, reciprocal)) {
            other.cells[inverse.id] = reciprocal;
            other.updatedAt = updatedAt;
          }
        }
      }
    } else if (!equalCell(before, value)) {
      row.cells[field.id] = value;
      row.updatedAt = updatedAt;
    }
  }
  return next;
}

/** Remove derived dependents to a fixed point before cleaning all references. */
function cleanRemovedFields(workspace: Workspace, removed: Set<string>): void {
  const tables = workspace.bases.flatMap((base) => base.tables);
  let changed = true;
  while (changed) {
    changed = false;
    for (const table of tables)
      for (const field of table.fields) {
        if (
          !removed.has(field.id) &&
          ["lookup", "rollup"].includes(field.type) &&
          (removed.has(field.linkFieldId ?? "") ||
            removed.has(field.targetFieldId ?? ""))
        ) {
          removed.add(field.id);
          changed = true;
        }
      }
  }
  for (const table of tables) {
    const primary = table.fields[0];
    if (primary && removed.has(primary.id))
      throw new Error(
        `This change would remove the primary field “${primary.name}” in “${table.name}”. Change that primary field to a text field first.`,
      );
  }
  for (const table of tables) {
    table.fields = table.fields.filter((field) => !removed.has(field.id));
    for (const row of table.records)
      for (const fieldId of removed) delete row.cells[fieldId];
    for (const field of table.fields)
      if (removed.has(field.inverseFieldId ?? "")) delete field.inverseFieldId;
    for (const view of table.views) {
      view.filters = view.filters.filter(
        (filter) => !removed.has(filter.fieldId),
      );
      view.sorts = view.sorts.filter((sort) => !removed.has(sort.fieldId));
      view.hiddenFields = view.hiddenFields.filter(
        (fieldId) => !removed.has(fieldId),
      );
      if (view.requiredFields)
        view.requiredFields = view.requiredFields.filter(
          (fieldId) => !removed.has(fieldId),
        );
      if (removed.has(view.groupFieldId ?? "")) delete view.groupFieldId;
      if (removed.has(view.dateFieldId ?? "")) delete view.dateFieldId;
    }
  }
}

export function deleteField(
  workspace: Workspace,
  tableId: string,
  fieldId: string,
): Workspace {
  const next = structuredClone(workspace),
    table = findTable(next, tableId);
  if (!table || !table.fields.some((field) => field.id === fieldId))
    throw new Error("This field no longer exists.");
  if (table.fields[0]?.id === fieldId)
    throw new Error("The primary field cannot be deleted.");
  cleanRemovedFields(next, new Set([fieldId]));
  return next;
}

export function removeTable(workspace: Workspace, tableId: string): Workspace {
  const next = structuredClone(workspace),
    table = findTable(next, tableId);
  if (!table) throw new Error("This table no longer exists.");
  const removed = new Set(table.fields.map((field) => field.id));
  for (const base of next.bases) {
    base.tables = base.tables.filter((candidate) => candidate.id !== tableId);
    for (const other of base.tables)
      for (const field of other.fields) {
        if (field.type === "link" && field.linkedTableId === tableId)
          removed.add(field.id);
      }
  }
  cleanRemovedFields(next, removed);
  return next;
}

function renameFormulaReference(
  formula: string,
  before: string,
  after: string,
): string {
  let result = "",
    position = 0,
    quote = "";
  while (position < formula.length) {
    const char = formula[position];
    if (quote) {
      result += char;
      position++;
      if (char === "\\" && position < formula.length)
        result += formula[position++];
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      result += char;
      position++;
      continue;
    }
    if (char === "{") {
      const end = formula.indexOf("}", position + 1);
      if (end !== -1) {
        const name = formula.slice(position + 1, end);
        result +=
          "{" +
          (name.toLowerCase() === before.toLowerCase() ? after : name) +
          "}";
        position = end + 1;
        continue;
      }
    }
    result += char;
    position++;
  }
  return result;
}

/** Save a schema edit with atomic conversions and an explicit reciprocal pair. */
export function saveField(
  workspace: Workspace,
  tableId: string,
  nextField: Field,
  evaluation: Evaluation,
): Workspace {
  const next = structuredClone(workspace),
    table = findTable(next, tableId),
    saved = structuredClone(nextField),
    updatedAt = new Date().toISOString();
  if (!table) throw new Error("This table no longer exists.");
  const index = table.fields.findIndex((field) => field.id === saved.id),
    previous = table.fields[index];
  const sameLink =
    previous?.type === "link" &&
    saved.type === "link" &&
    previous.linkedTableId === saved.linkedTableId;
  const oldLinked =
    previous?.type === "link"
      ? findTable(next, previous.linkedTableId ?? "")
      : undefined;
  const oldInverse = oldLinked?.fields.find(
    (field) => field.id === previous?.inverseFieldId,
  );
  if (
    previous?.type === "link" &&
    saved.type === "link" &&
    !sameLink &&
    table.records.some(
      (row) =>
        Array.isArray(row.cells[previous.id]) &&
        (row.cells[previous.id] as string[]).length > 0,
    )
  )
    throw new Error("Clear existing links before changing the linked table.");
  if (oldInverse && !sameLink) delete oldInverse.inverseFieldId;
  if (saved.type !== "link") delete saved.inverseFieldId;
  else if (sameLink && oldInverse) saved.inverseFieldId = oldInverse.id;
  else delete saved.inverseFieldId;

  if (previous) {
    for (const row of table.records) {
      const before = isComputed(previous)
        ? (evaluation.values[table.id]?.[row.id]?.[previous.id] ?? null)
        : (row.cells[previous.id] ?? null);
      let value: Cell = before;
      if (previous.type !== saved.type) {
        if (isComputed(saved)) {
          delete row.cells[saved.id];
          row.updatedAt = updatedAt;
          continue;
        }
        if (saved.type === "link") {
          const linked = findTable(next, saved.linkedTableId ?? "");
          if (!linked) throw new Error("Choose an existing linked table.");
          const tokens =
            before === null || before === ""
              ? []
              : Array.isArray(before)
                ? before
                : [displayText(before, previous, next)];
          value = [
            ...new Set(
              tokens.map((token) => {
                const exact = linked.records.find(
                  (record) => record.id === token,
                );
                if (exact) return exact.id;
                const primary = linked.fields[0],
                  matches = primary
                    ? linked.records.filter(
                        (record) =>
                          displayText(
                            rawValue(evaluation, linked, record, primary),
                            primary,
                            next,
                          ) === token,
                      )
                    : [];
                if (matches.length !== 1)
                  throw new Error(
                    `“${token}” must match exactly one record in ${linked.name}.`,
                  );
                return matches[0].id;
              }),
            ),
          ];
        } else value = parseCell(displayText(before, previous, next), saved);
      } else if (
        (saved.type === "singleSelect" || saved.type === "multiSelect") &&
        previous.options
      ) {
        const names = new Map(
          previous.options.map((option) => [
            option.name,
            saved.options?.find((candidate) => candidate.id === option.id)
              ?.name,
          ]),
        );
        if (saved.type === "singleSelect")
          value =
            typeof before === "string" ? (names.get(before) ?? null) : null;
        else
          value = Array.isArray(before)
            ? before.flatMap((name) => {
                const replacement = names.get(name);
                return replacement === undefined ? [] : [replacement];
              })
            : [];
      }
      if (!isComputed(saved) && !equalCell(row.cells[saved.id], value)) {
        row.cells[saved.id] = value;
        row.updatedAt = updatedAt;
      }
    }
  }
  if (index >= 0) table.fields[index] = saved;
  else table.fields.push(saved);
  if (previous && previous.name !== saved.name)
    for (const field of table.fields)
      if (field.type === "formula" && field.formula)
        field.formula = renameFormulaReference(
          field.formula,
          previous.name,
          saved.name,
        );

  if (saved.type === "link") {
    const linked = findTable(next, saved.linkedTableId ?? "");
    if (!linked) throw new Error("Choose an existing linked table.");
    let inverse = linked.fields.find(
      (field) => field.id === saved.inverseFieldId,
    );
    if (
      inverse &&
      (inverse.type !== "link" ||
        inverse.linkedTableId !== table.id ||
        inverse.inverseFieldId !== saved.id)
    )
      throw new Error("The reciprocal link is not configured correctly.");
    if (!inverse) {
      let name = table.name,
        suffix = 2;
      while (
        linked.fields.some(
          (field) => field.name.toLowerCase() === name.toLowerCase(),
        )
      )
        name = table.name + " " + suffix++;
      inverse = {
        id: id(),
        name,
        type: "link",
        width: 220,
        linkedTableId: table.id,
        inverseFieldId: saved.id,
      };
      saved.inverseFieldId = inverse.id;
      linked.fields.push(inverse);
    }
    const incoming = new Map(
      linked.records.map((row) => [row.id, [] as string[]]),
    );
    for (const row of table.records) {
      const selected = row.cells[saved.id];
      if (Array.isArray(selected))
        for (const key of new Set(selected)) {
          const back = incoming.get(key);
          if (!back)
            throw new Error(
              `A linked record for ${saved.name} no longer exists.`,
            );
          back.push(row.id);
        }
    }
    for (const row of linked.records) {
      const value = incoming.get(row.id)!;
      if (!equalCell(row.cells[inverse.id], value)) {
        row.cells[inverse.id] = value;
        row.updatedAt = updatedAt;
      }
    }
  }
  if (previous?.type === "link" && !sameLink) {
    const dependents = new Set(
      table.fields
        .filter(
          (field) =>
            ["lookup", "rollup"].includes(field.type) &&
            field.linkFieldId === saved.id,
        )
        .map((field) => field.id),
    );
    if (dependents.size) cleanRemovedFields(next, dependents);
  }
  return next;
}

export function starterWorkspace(): Workspace {
  const people = ["Avery Chen", "Jordan Ellis", "Morgan Lee", "Sam Rivera"];
  const projectId = id(),
    projectName = id(),
    projectStatus = id();
  const projects: Table = {
    id: projectId,
    name: "Projects",
    fields: [
      { id: projectName, name: "Project", type: "text", width: 280 },
      {
        id: projectStatus,
        name: "Stage",
        type: "singleSelect",
        width: 180,
        options: [
          { id: id(), name: "Planning", color: "#fff1bb" },
          { id: id(), name: "In progress", color: "#dceafb" },
          { id: id(), name: "Launched", color: "#d8f3e8" },
        ],
      },
    ],
    records: [
      newRow({
        [projectName]: "Autumn launch",
        [projectStatus]: "In progress",
      }),
      newRow({
        [projectName]: "Customer stories",
        [projectStatus]: "Planning",
      }),
      newRow({
        [projectName]: "Website refresh",
        [projectStatus]: "In progress",
      }),
    ],
    views: [emptyView()],
  };
  const fields: Field[] = [
    { id: id(), name: "Task", type: "text", width: 310 },
    {
      id: id(),
      name: "Status",
      type: "singleSelect",
      width: 160,
      options: [
        { id: id(), name: "To do", color: "#e8e9ed" },
        { id: id(), name: "In progress", color: "#dceafb" },
        { id: id(), name: "In review", color: "#ede2fa" },
        { id: id(), name: "Done", color: "#d8f3e8" },
      ],
    },
    {
      id: id(),
      name: "Owner",
      type: "singleSelect",
      width: 170,
      options: people.map((name, i) => ({
        id: id(),
        name,
        color: ["#fce6cf", "#dceff1", "#fce1e7", "#ede2fa"][i],
      })),
    },
    { id: id(), name: "Due date", type: "date", width: 155 },
    {
      id: id(),
      name: "Priority",
      type: "singleSelect",
      width: 125,
      options: [
        { id: id(), name: "High", color: "#fce1e7" },
        { id: id(), name: "Medium", color: "#fff1bb" },
        { id: id(), name: "Low", color: "#dceff1" },
      ],
    },
    { id: id(), name: "Hours", type: "number", width: 110 },
    {
      id: id(),
      name: "Project",
      type: "link",
      width: 205,
      linkedTableId: projectId,
    },
    { id: id(), name: "Notes", type: "longText", width: 300 },
  ];
  const tasks = [
    "Finalize the launch brief",
    "Build the product story",
    "Review the homepage copy",
    "Collect customer feedback",
    "Design the announcement",
    "Prepare the release checklist",
    "Record the product walkthrough",
    "Polish the onboarding flow",
    "Review accessibility",
    "Plan the launch calendar",
    "Write the help guides",
    "Test the signup journey",
    "Approve the final assets",
    "Send the customer interviews",
    "Organize the research notes",
    "Publish the case study",
    "Refine the pricing page",
    "Check the mobile experience",
    "Share the team update",
    "Measure launch results",
  ];
  const today = new Date();
  const date = (offset: number) => {
    const d = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + offset,
    );
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const records = tasks.map((task, i) =>
    newRow({
      [fields[0].id]: task,
      [fields[1].id]: [
        "Done",
        "In progress",
        "In review",
        "To do",
        "In progress",
        "To do",
      ][i % 6],
      [fields[2].id]: people[i % 4],
      [fields[3].id]: date(i - 4),
      [fields[4].id]: ["High", "Medium", "Low"][i % 3],
      [fields[5].id]: [3, 6, 2, 4, 8][i % 5],
      [fields[6].id]: [projects.records[i % 3].id],
      [fields[7].id]: [
        "Keep it clear, practical, and easy to share.",
        "Bring a first draft to the team review.",
        "Ready for a fresh pair of eyes.",
        "Capture decisions and next steps.",
      ][i % 4],
    }),
  );
  const taskTable: Table = {
    id: id(),
    name: "Tasks",
    fields,
    records,
    views: [
      emptyView("All tasks"),
      { ...emptyView("By status", "kanban"), groupFieldId: fields[1].id },
      { ...emptyView("Calendar", "calendar"), dateFieldId: fields[3].id },
      emptyView("Gallery", "gallery"),
      {
        ...emptyView("New task", "form"),
        formDescription:
          "Add a task to the launch plan. Your response creates a record in this table.",
        requiredFields: [fields[0].id],
      },
    ],
  };
  const taskLinks = id();
  fields[6].inverseFieldId = taskLinks;
  projects.fields.push(
    {
      id: taskLinks,
      name: "Tasks",
      type: "link",
      width: 260,
      linkedTableId: taskTable.id,
      inverseFieldId: fields[6].id,
    },
    {
      id: id(),
      name: "Total hours",
      type: "rollup",
      width: 150,
      linkFieldId: taskLinks,
      targetFieldId: fields[5].id,
      aggregation: "SUM",
    },
  );
  for (const row of projects.records)
    row.cells[taskLinks] = taskTable.records
      .filter((r) => (r.cells[fields[6].id] as string[]).includes(row.id))
      .map((r) => r.id);
  return {
    version: 1,
    name: "My workspace",
    bases: [
      {
        id: id(),
        name: "Studio launch",
        color: "#087f8c",
        description:
          "An editable starter base. Make it yours, or create a blank base.",
        tables: [taskTable, projects],
      },
    ],
  };
}
