export type Cell = null | string | number | boolean | string[];
export type FieldType =
  | "text"
  | "longText"
  | "number"
  | "currency"
  | "percent"
  | "checkbox"
  | "date"
  | "email"
  | "url"
  | "singleSelect"
  | "multiSelect"
  | "link"
  | "formula"
  | "lookup"
  | "rollup";
export interface Field {
  id: string;
  name: string;
  type: FieldType;
  width: number;
  options?: { id: string; name: string; color: string }[];
  linkedTableId?: string;
  inverseFieldId?: string;
  formula?: string;
  linkFieldId?: string;
  targetFieldId?: string;
  aggregation?:
    | "SUM"
    | "AVERAGE"
    | "MIN"
    | "MAX"
    | "COUNT"
    | "COUNTA"
    | "ARRAYJOIN";
  precision?: number;
  description?: string;
}
export interface Row {
  id: string;
  cells: Record<string, Cell>;
  createdAt: string;
  updatedAt: string;
}
export interface Filter {
  id: string;
  fieldId: string;
  operator:
    | "contains"
    | "notContains"
    | "is"
    | "isNot"
    | "empty"
    | "notEmpty"
    | "gt"
    | "lt"
    | "gte"
    | "lte";
  value: string;
}
export interface View {
  id: string;
  name: string;
  type: "grid" | "kanban" | "gallery" | "calendar" | "form";
  filters: Filter[];
  filterMode: "and" | "or";
  sorts: { fieldId: string; direction: "asc" | "desc" }[];
  hiddenFields: string[];
  groupFieldId?: string;
  dateFieldId?: string;
  rowHeight: "compact" | "comfortable" | "tall";
  formDescription?: string;
  requiredFields?: string[];
}
export interface Table {
  id: string;
  name: string;
  fields: Field[];
  records: Row[];
  views: View[];
}
export interface Base {
  id: string;
  name: string;
  color: string;
  description: string;
  tables: Table[];
}
export interface Workspace {
  version: 1;
  name: string;
  bases: Base[];
}
export interface Evaluation {
  values: Record<string, Record<string, Record<string, Cell>>>;
  errors: Record<string, Record<string, Record<string, string>>>;
}
export interface CellChange {
  recordId: string;
  fieldId: string;
  value: Cell;
}
export const computedTypes: FieldType[] = ["formula", "lookup", "rollup"];
export const isComputed = (field: Field) => computedTypes.includes(field.type);
export const FIELD_TYPES: {
  type: FieldType;
  label: string;
  symbol: string;
  description: string;
}[] = [
  {
    type: "text",
    label: "Single line text",
    symbol: "A",
    description: "A short piece of text",
  },
  {
    type: "longText",
    label: "Long text",
    symbol: "≡",
    description: "Notes and longer descriptions",
  },
  {
    type: "number",
    label: "Number",
    symbol: "#",
    description: "A number with optional decimals",
  },
  {
    type: "currency",
    label: "Currency",
    symbol: "$",
    description: "An amount of money (USD)",
  },
  {
    type: "percent",
    label: "Percent",
    symbol: "%",
    description: "A percentage, stored as 0–100",
  },
  {
    type: "checkbox",
    label: "Checkbox",
    symbol: "✓",
    description: "Checked or unchecked",
  },
  { type: "date", label: "Date", symbol: "▦", description: "A calendar date" },
  {
    type: "singleSelect",
    label: "Single select",
    symbol: "◉",
    description: "Choose one colored option",
  },
  {
    type: "multiSelect",
    label: "Multiple select",
    symbol: "☷",
    description: "Choose several options",
  },
  {
    type: "email",
    label: "Email",
    symbol: "@",
    description: "An email address",
  },
  { type: "url", label: "URL", symbol: "↗", description: "A web address" },
  {
    type: "link",
    label: "Link to another record",
    symbol: "↔",
    description: "Connect records in another table",
  },
  {
    type: "formula",
    label: "Formula",
    symbol: "ƒ",
    description: "Calculate a value for each record",
  },
  {
    type: "lookup",
    label: "Lookup",
    symbol: "⌕",
    description: "Show a value from linked records",
  },
  {
    type: "rollup",
    label: "Rollup",
    symbol: "Σ",
    description: "Summarize values from linked records",
  },
];
export const PALETTE = [
  "#d8f3e8",
  "#dceafb",
  "#fce6cf",
  "#fce1e7",
  "#ede2fa",
  "#fff1bb",
  "#dceff1",
  "#e8e9ed",
];
export const id = () => crypto.randomUUID();
export const emptyView = (
  name = "Grid view",
  type: View["type"] = "grid",
): View => ({
  id: id(),
  name,
  type,
  filters: [],
  filterMode: "and",
  sorts: [],
  hiddenFields: [],
  rowHeight: "compact",
});
export const newRow = (cells: Record<string, Cell> = {}): Row => ({
  id: id(),
  cells,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
