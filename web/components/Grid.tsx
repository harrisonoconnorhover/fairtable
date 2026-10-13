import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Papa from "papaparse";
import {
  ArrowDownRight,
  ChevronDown,
  ChevronRight,
  Expand,
  GripVertical,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { CellDisplay, CellInput, cellText, parseCellText } from "./CellInput";
import {
  FIELD_TYPES,
  isComputed,
  type Cell,
  type CellChange,
  type Evaluation,
  type Field,
  type Row,
  type Table,
  type View,
  type Workspace,
} from "../types";
import "../grid.css";

interface GridProps {
  table: Table;
  view: View;
  records: Row[];
  workspace: Workspace;
  evaluation: Evaluation;
  onChangeCells: (changes: CellChange[]) => void;
  onAddRecord: () => void;
  onOpenRecord: (id: string) => void;
  onEditField: (id: string) => void;
  onResizeField: (id: string, width: number) => void;
  onReorderField: (id: string, beforeId: string) => void;
  onDeleteRecords: (ids: string[]) => void;
  onUndo: () => void;
  onRedo: () => void;
}
type Point = { row: number; col: number };
type GridItem =
  | { kind: "record"; row: Row; index: number }
  | { kind: "group"; key: string; label: string; count: number };
const GUTTER = 68;
const clamp = (value: number, max: number) =>
  Math.max(0, Math.min(value, Math.max(0, max)));

export function Grid({
  table,
  view,
  records,
  workspace,
  evaluation,
  onChangeCells,
  onAddRecord,
  onOpenRecord,
  onEditField,
  onResizeField,
  onReorderField,
  onDeleteRecords,
  onUndo,
  onRedo,
}: GridProps) {
  const fields = useMemo(
    () =>
      table.fields.filter(
        (field, index) => index === 0 || !view.hiddenFields.includes(field.id),
      ),
    [table.fields, view.hiddenFields],
  );
  const [active, setActive] = useState<Point>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<Point>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<{
    recordId: string;
    fieldId: string;
    initialText?: string;
  } | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [draggedField, setDraggedField] = useState<string | null>(null);
  const [dropField, setDropField] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const selecting = useRef(false);
  const selectionRowAnchor = useRef(0);
  const rowHeight =
    view.rowHeight === "tall" ? 84 : view.rowHeight === "comfortable" ? 56 : 36;
  const groupField =
    fields.find((field) => field.id === view.groupFieldId) ??
    table.fields.find((field) => field.id === view.groupFieldId);
  const getValue = (row: Row, field: Field): Cell =>
    evaluation.values[table.id]?.[row.id]?.[field.id] ??
    row.cells[field.id] ??
    null;
  const getError = (row: Row, field: Field) =>
    evaluation.errors[table.id]?.[row.id]?.[field.id];
  const items: GridItem[] = [];
  const orderedRecords: Row[] = [];
  if (groupField) {
    const groups = new Map<string, { label: string; rows: Row[] }>();
    for (const row of records) {
      const value = getValue(row, groupField);
      const key = JSON.stringify(value);
      if (!groups.has(key))
        groups.set(key, {
          label: cellText(groupField, value, workspace) || "Empty",
          rows: [],
        });
      groups.get(key)!.rows.push(row);
    }
    for (const [key, group] of groups) {
      items.push({
        kind: "group",
        key,
        label: group.label,
        count: group.rows.length,
      });
      if (!collapsed.has(key))
        for (const row of group.rows) {
          items.push({ kind: "record", row, index: orderedRecords.length });
          orderedRecords.push(row);
        }
    }
  } else
    for (const row of records) {
      items.push({ kind: "record", row, index: orderedRecords.length });
      orderedRecords.push(row);
    }
  const fieldWidth = (field: Field) => widths[field.id] ?? field.width ?? 180;
  const totalWidth =
    GUTTER + fields.reduce((sum, field) => sum + fieldWidth(field), 0);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroll.current,
    estimateSize: (index) => (items[index]?.kind === "group" ? 38 : rowHeight),
    overscan: 12,
    scrollPaddingStart: 38,
    initialRect: { width: 1000, height: 600 },
  });
  const current = {
    row: clamp(active.row, orderedRecords.length - 1),
    col: clamp(active.col, fields.length - 1),
  };
  const range = {
    top: Math.min(current.row, anchor.row),
    bottom: Math.max(current.row, anchor.row),
    left: Math.min(current.col, anchor.col),
    right: Math.max(current.col, anchor.col),
  };
  const activeRow = orderedRecords[current.row];
  const activeField = fields[current.col];
  const rowIds = new Set(records.map((row) => row.id));
  const selectedIds = [...selectedRows].filter((id) => rowIds.has(id));

  useEffect(() => {
    setActive({ row: 0, col: 0 });
    setAnchor({ row: 0, col: 0 });
    setEditing(null);
    setSelectedRows(new Set());
    setCollapsed(new Set());
    setError("");
    setWidths({});
  }, [table.id, view.id]);
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, collapsed, view.groupFieldId, records]);
  useEffect(() => {
    const stop = () => {
      selecting.current = false;
    };
    document.addEventListener("pointerup", stop);
    return () => document.removeEventListener("pointerup", stop);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  function focusGrid() {
    scroll.current?.focus({ preventScroll: true });
  }
  function move(point: Point, extend = false) {
    const next = {
      row: clamp(point.row, orderedRecords.length - 1),
      col: clamp(point.col, fields.length - 1),
    };
    setActive(next);
    if (!extend) setAnchor(next);
    const itemIndex = items.findIndex(
      (item) => item.kind === "record" && item.index === next.row,
    );
    if (itemIndex >= 0) virtualizer.scrollToIndex(itemIndex, { align: "auto" });
    const element = scroll.current;
    if (element) {
      const left =
        GUTTER +
        fields
          .slice(0, next.col)
          .reduce((sum, field) => sum + fieldWidth(field), 0);
      const right =
        left + (fields[next.col] ? fieldWidth(fields[next.col]) : 0);
      const frozenWidth =
        GUTTER +
        (window.matchMedia("(min-width: 701px)").matches && fields[0]
          ? fieldWidth(fields[0])
          : 0);
      if (next.col === 0) element.scrollLeft = 0;
      else {
        if (right > element.scrollLeft + element.clientWidth)
          element.scrollLeft = right - element.clientWidth;
        if (left < element.scrollLeft + frozenWidth)
          element.scrollLeft = Math.max(0, left - frozenWidth);
      }
    }
  }
  function navigate(direction: "next" | "previous" | "down" | "up") {
    let { row, col } = current;
    if (direction === "down") row++;
    if (direction === "up") row--;
    if (direction === "next") {
      col++;
      if (col >= fields.length) {
        col = 0;
        row++;
      }
    }
    if (direction === "previous") {
      col--;
      if (col < 0) {
        col = fields.length - 1;
        row--;
      }
    }
    setEditing(null);
    move({ row, col });
    focusGrid();
  }
  function change(changes: CellChange[]) {
    try {
      if (changes.length) onChangeCells(changes);
      setError("");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }
  function beginEdit(point = current, initialText?: string) {
    const row = orderedRecords[point.row],
      field = fields[point.col];
    if (!row || !field) return;
    if (isComputed(field)) {
      setNotice(
        `${field.name} is calculated. Edit its field settings to change the calculation.`,
      );
      return;
    }
    if (field.type === "checkbox") {
      change([
        {
          recordId: row.id,
          fieldId: field.id,
          value: getValue(row, field) !== true,
        },
      ]);
      return;
    }
    setEditing({ recordId: row.id, fieldId: field.id, initialText });
  }
  function clearSelection() {
    const changes: CellChange[] = [];
    for (
      let row = range.top;
      row <= Math.min(range.bottom, orderedRecords.length - 1);
      row++
    )
      for (
        let col = range.left;
        col <= Math.min(range.right, fields.length - 1);
        col++
      ) {
        if (!isComputed(fields[col]))
          changes.push({
            recordId: orderedRecords[row].id,
            fieldId: fields[col].id,
            value: null,
          });
      }
    change(changes);
  }
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (
      editing ||
      (event.target !== event.currentTarget &&
        (event.target as HTMLElement).closest("button,input,textarea,select"))
    )
      return;
    const command = event.metaKey || event.ctrlKey;
    if (command && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? onRedo() : onUndo();
      return;
    }
    if (command && event.key.toLowerCase() === "y") {
      event.preventDefault();
      onRedo();
      return;
    }
    if (command && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setAnchor({ row: 0, col: 0 });
      setActive({ row: orderedRecords.length - 1, col: fields.length - 1 });
      return;
    }
    if (!orderedRecords.length || !fields.length) return;
    if (
      ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)
    ) {
      event.preventDefault();
      const next = { ...current };
      if (event.key === "ArrowDown")
        next.row = command ? orderedRecords.length - 1 : current.row + 1;
      if (event.key === "ArrowUp") next.row = command ? 0 : current.row - 1;
      if (event.key === "ArrowLeft") next.col = command ? 0 : current.col - 1;
      if (event.key === "ArrowRight")
        next.col = command ? fields.length - 1 : current.col + 1;
      move(next, event.shiftKey);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      move(
        {
          row: command
            ? event.key === "Home"
              ? 0
              : orderedRecords.length - 1
            : current.row,
          col: event.key === "Home" ? 0 : fields.length - 1,
        },
        event.shiftKey,
      );
      return;
    }
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      move(
        {
          row:
            current.row +
            (event.key === "PageDown" ? 1 : -1) *
              Math.max(
                1,
                Math.floor((scroll.current?.clientHeight ?? 400) / rowHeight) -
                  1,
              ),
          col: current.col,
        },
        event.shiftKey,
      );
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      navigate(event.shiftKey ? "previous" : "next");
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      beginEdit();
      return;
    }
    if (event.key === "Escape") {
      setAnchor(current);
      setSelectedRows(new Set());
      setError("");
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      clearSelection();
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      onOpenRecord(activeRow.id);
      return;
    }
    if (event.key.length === 1 && !command && !event.altKey) {
      event.preventDefault();
      beginEdit(current, event.key);
    }
  }
  function copy(event: ClipboardEvent<HTMLDivElement>, cut = false) {
    if (editing || (event.target as HTMLElement).closest("input,textarea"))
      return;
    const rows: string[][] = [];
    for (
      let row = range.top;
      row <= Math.min(range.bottom, orderedRecords.length - 1);
      row++
    ) {
      const cells: string[] = [];
      for (
        let col = range.left;
        col <= Math.min(range.right, fields.length - 1);
        col++
      ) {
        const value = getValue(orderedRecords[row], fields[col]);
        cells.push(
          Array.isArray(value)
            ? JSON.stringify(value)
            : cellText(fields[col], value, workspace),
        );
      }
      rows.push(cells);
    }
    event.preventDefault();
    event.clipboardData.setData(
      "text/plain",
      Papa.unparse(rows, { delimiter: "\t", newline: "\n" }),
    );
    if (cut) clearSelection();
  }
  function paste(event: ClipboardEvent<HTMLDivElement>) {
    if (editing || (event.target as HTMLElement).closest("input,textarea"))
      return;
    event.preventDefault();
    try {
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      const parsed = Papa.parse<string[]>(text.replace(/\r?\n$/, ""), {
        delimiter: "\t",
        skipEmptyLines: false,
      });
      if (parsed.errors.length)
        throw new Error(`Paste could not be read: ${parsed.errors[0].message}`);
      const data = parsed.data;
      const columnCount = Math.max(...data.map((row) => row.length));
      if (data.some((row) => row.length !== columnCount))
        throw new Error(
          "Paste must be a rectangular block with the same number of cells in each row.",
        );
      const oneCell = data.length === 1 && columnCount === 1;
      const rows = oneCell ? range.bottom - range.top + 1 : data.length;
      const cols = oneCell ? range.right - range.left + 1 : columnCount;
      const start = { row: range.top, col: range.left };
      if (start.row + rows > orderedRecords.length)
        throw new Error(
          `Paste needs ${start.row + rows - orderedRecords.length} more records. Add records first, then paste again.`,
        );
      if (start.col + cols > fields.length)
        throw new Error(
          "Paste extends past the last visible field. Add or show the required fields first.",
        );
      const changes: CellChange[] = [];
      let skipped = 0;
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < cols; col++) {
          const field = fields[start.col + col];
          if (isComputed(field)) {
            skipped++;
            continue;
          }
          changes.push({
            recordId: orderedRecords[start.row + row].id,
            fieldId: field.id,
            value: parseCellText(
              field,
              data[oneCell ? 0 : row][oneCell ? 0 : col],
              workspace,
            ),
          });
        }
      if (change(changes)) {
        setAnchor(start);
        setActive({ row: start.row + rows - 1, col: start.col + cols - 1 });
        setNotice(
          `Pasted ${changes.length} cell${changes.length === 1 ? "" : "s"}${skipped ? `; ${skipped} calculated cell${skipped === 1 ? "" : "s"} preserved` : ""}.`,
        );
      }
    } catch (cause) {
      setError(
        `Nothing was pasted. ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  function resize(event: React.PointerEvent, field: Field) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX,
      startWidth = fieldWidth(field);
    let nextWidth = startWidth;
    const update = (move: PointerEvent) => {
      nextWidth = Math.max(
        100,
        Math.min(800, startWidth + move.clientX - startX),
      );
      setWidths((current) => ({ ...current, [field.id]: nextWidth }));
    };
    const finish = () => {
      document.removeEventListener("pointermove", update);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      onResizeField(field.id, nextWidth);
    };
    document.addEventListener("pointermove", update);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  }
  function toggleRow(row: Row, index: number, extend: boolean) {
    setSelectedRows((previous) => {
      const next = new Set(previous);
      if (extend)
        for (
          let position = Math.min(index, selectionRowAnchor.current);
          position <= Math.max(index, selectionRowAnchor.current);
          position++
        ) {
          if (orderedRecords[position]) next.add(orderedRecords[position].id);
        }
      else if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
    if (!extend) selectionRowAnchor.current = index;
  }
  const summaries = fields.map((field) => {
    if (
      !["number", "currency", "percent", "formula", "rollup"].includes(
        field.type,
      )
    )
      return null;
    const values = records
      .map((row) => getValue(row, field))
      .filter((value): value is number => typeof value === "number");
    return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  });

  return (
    <section className="grid-shell" aria-label={`${table.name} grid`}>
      {selectedIds.length > 0 && (
        <div className="grid-selection-toolbar">
          <strong>
            {selectedIds.length} record{selectedIds.length === 1 ? "" : "s"}{" "}
            selected
          </strong>
          <button
            type="button"
            onClick={() => {
              try {
                onDeleteRecords(selectedIds);
                setSelectedRows(new Set());
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : String(cause),
                );
              }
            }}
          >
            <Trash2 size={14} /> Delete selected
          </button>
          <button
            type="button"
            className="grid-dismiss"
            aria-label="Clear row selection"
            onClick={() => setSelectedRows(new Set())}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {error && (
        <div className="grid-alert" role="alert">
          <span>{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <div
        className="grid-scroll"
        ref={scroll}
        role="grid"
        tabIndex={0}
        aria-label={view.name}
        aria-rowcount={orderedRecords.length + 1}
        aria-colcount={fields.length + 1}
        aria-multiselectable="true"
        aria-activedescendant={
          activeRow && activeField
            ? `grid-cell-${activeRow.id}-${activeField.id}`
            : undefined
        }
        onKeyDown={handleKey}
        onCopy={(event) => copy(event)}
        onCut={(event) => copy(event, true)}
        onPaste={paste}
      >
        <div
          className="grid-content"
          style={{ width: Math.max(totalWidth, 400), minWidth: "100%" }}
        >
          <div
            className="grid-header"
            role="row"
            aria-rowindex={1}
            style={{ minWidth: totalWidth }}
          >
            <div className="grid-gutter grid-header-gutter" role="columnheader">
              <input
                type="checkbox"
                aria-label="Select all visible records"
                checked={
                  records.length > 0 && selectedIds.length === records.length
                }
                ref={(element) => {
                  if (element)
                    element.indeterminate =
                      selectedIds.length > 0 &&
                      selectedIds.length < records.length;
                }}
                onChange={(event) =>
                  setSelectedRows(
                    event.target.checked
                      ? new Set(records.map((row) => row.id))
                      : new Set(),
                  )
                }
              />
            </div>
            {fields.map((field, col) => (
              <div
                key={field.id}
                className={`grid-field-header ${col === 0 ? "grid-primary" : ""} ${dropField === field.id ? "grid-field-drop" : ""}`}
                style={{
                  width: fieldWidth(field),
                  ...(col === 0 ? { left: GUTTER } : {}),
                }}
                role="columnheader"
                aria-colindex={col + 2}
                onDragOver={(event) => {
                  if (draggedField && draggedField !== field.id) {
                    event.preventDefault();
                    setDropField(field.id);
                  }
                }}
                onDragLeave={() => setDropField(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedField && draggedField !== field.id)
                    onReorderField(draggedField, field.id);
                  setDraggedField(null);
                  setDropField(null);
                }}
              >
                <span className="grid-field-symbol" aria-hidden="true">
                  {FIELD_TYPES.find((type) => type.type === field.type)
                    ?.symbol ?? "A"}
                </span>
                <button
                  type="button"
                  className="grid-field-name"
                  title={field.description || field.name}
                  onClick={() => onEditField(field.id)}
                >
                  {field.name}
                </button>
                <button
                  type="button"
                  draggable
                  className="grid-field-grip"
                  aria-label={`Drag to reorder ${field.name}`}
                  title="Drag to reorder field"
                  onDragStart={(event) => {
                    setDraggedField(field.id);
                    event.dataTransfer.setData("text/plain", field.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDraggedField(null);
                    setDropField(null);
                  }}
                >
                  <GripVertical size={12} />
                </button>
                <button
                  type="button"
                  className="grid-field-menu"
                  aria-label={`Edit ${field.name} field`}
                  onClick={() => onEditField(field.id)}
                >
                  <ChevronDown size={14} />
                </button>
                <div
                  role="separator"
                  tabIndex={0}
                  aria-label={`Resize ${field.name}`}
                  aria-orientation="vertical"
                  aria-valuemin={100}
                  aria-valuemax={800}
                  aria-valuenow={fieldWidth(field)}
                  className="grid-resize"
                  onPointerDown={(event) => resize(event, field)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      const width = Math.max(
                        100,
                        Math.min(
                          800,
                          fieldWidth(field) +
                            (event.key === "ArrowRight" ? 20 : -20),
                        ),
                      );
                      setWidths((current) => ({
                        ...current,
                        [field.id]: width,
                      }));
                      onResizeField(field.id, width);
                    }
                  }}
                />
              </div>
            ))}
            <div className="grid-header-fill" />
          </div>
          <div
            className="grid-rows"
            style={{ height: virtualizer.getTotalSize(), minWidth: totalWidth }}
          >
            {virtualizer.getVirtualItems().map((virtual) => {
              const item = items[virtual.index];
              if (!item) return null;
              if (item.kind === "group")
                return (
                  <div
                    key={`group-${item.key}`}
                    className="grid-group-row"
                    style={{
                      height: virtual.size,
                      transform: `translateY(${virtual.start}px)`,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          next.has(item.key)
                            ? next.delete(item.key)
                            : next.add(item.key);
                          return next;
                        });
                        setActive({ row: 0, col: 0 });
                        setAnchor({ row: 0, col: 0 });
                      }}
                    >
                      {collapsed.has(item.key) ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                      <span className="grid-group-field">
                        {groupField?.name}
                      </span>
                      <strong>{item.label}</strong>
                      <span className="grid-group-count">
                        {item.count} record{item.count === 1 ? "" : "s"}
                      </span>
                    </button>
                  </div>
                );
              const row = item.row,
                rowIndex = item.index;
              return (
                <div
                  key={row.id}
                  role="row"
                  aria-rowindex={rowIndex + 2}
                  aria-selected={selectedRows.has(row.id)}
                  className={`grid-row ${selectedRows.has(row.id) ? "grid-row-selected" : ""}`}
                  style={{
                    height: virtual.size,
                    transform: `translateY(${virtual.start}px)`,
                  }}
                >
                  <div className="grid-gutter" role="rowheader">
                    <span className="grid-row-number">{rowIndex + 1}</span>
                    <input
                      className="grid-row-check"
                      type="checkbox"
                      aria-label={`Select record ${rowIndex + 1}`}
                      checked={selectedRows.has(row.id)}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleRow(row, rowIndex, event.shiftKey);
                      }}
                      onChange={() => {}}
                    />
                    <button
                      type="button"
                      className="grid-expand"
                      aria-label={`Expand record ${rowIndex + 1}`}
                      onClick={() => onOpenRecord(row.id)}
                    >
                      <Expand size={12} />
                    </button>
                  </div>
                  {fields.map((field, col) => {
                    const selected =
                      rowIndex >= range.top &&
                      rowIndex <= range.bottom &&
                      col >= range.left &&
                      col <= range.right;
                    const focused =
                      current.row === rowIndex && current.col === col;
                    const edit =
                      editing?.recordId === row.id &&
                      editing.fieldId === field.id;
                    const value = getValue(row, field);
                    return (
                      <div
                        key={field.id}
                        id={`grid-cell-${row.id}-${field.id}`}
                        role="gridcell"
                        aria-colindex={col + 2}
                        aria-selected={selected}
                        aria-readonly={isComputed(field)}
                        className={`grid-cell ${col === 0 ? "grid-primary" : ""} ${selected ? "grid-cell-selected" : ""} ${focused ? "grid-cell-active" : ""} ${edit ? "grid-cell-editing" : ""} ${isComputed(field) ? "grid-cell-computed" : ""} ${["number", "currency", "percent"].includes(field.type) ? "grid-cell-numeric" : ""} ${field.type === "checkbox" ? "grid-cell-checkbox" : ""}`}
                        style={{
                          width: fieldWidth(field),
                          ...(col === 0 ? { left: GUTTER } : {}),
                        }}
                        onPointerDown={(event) => {
                          if (edit || event.button !== 0) return;
                          event.preventDefault();
                          selecting.current = true;
                          focusGrid();
                          setActive({ row: rowIndex, col });
                          if (!event.shiftKey)
                            setAnchor({ row: rowIndex, col });
                        }}
                        onPointerEnter={(event) => {
                          if (
                            selecting.current &&
                            event.buttons === 1 &&
                            !editing
                          )
                            setActive({ row: rowIndex, col });
                        }}
                        onDoubleClick={() => {
                          move({ row: rowIndex, col });
                          beginEdit({ row: rowIndex, col });
                        }}
                      >
                        {edit ? (
                          <CellInput
                            key={`${row.id}-${field.id}`}
                            field={field}
                            value={value}
                            workspace={workspace}
                            autoFocus
                            compact
                            initialText={editing.initialText}
                            onChange={(next) => {
                              onChangeCells([
                                {
                                  recordId: row.id,
                                  fieldId: field.id,
                                  value: next,
                                },
                              ]);
                              setError("");
                            }}
                            onClose={() => {
                              setEditing(null);
                              focusGrid();
                            }}
                            onNavigate={navigate}
                          />
                        ) : (
                          <CellDisplay
                            field={field}
                            value={value}
                            workspace={workspace}
                            error={getError(row, field)}
                          />
                        )}
                      </div>
                    );
                  })}
                  <div className="grid-row-fill" />
                </div>
              );
            })}
          </div>
          {!records.length && (
            <div className="grid-empty">
              <ArrowDownRight size={22} />
              <strong>
                {table.records.length
                  ? "No records match this view"
                  : "Your table is ready"}
              </strong>
              <span>
                {table.records.length
                  ? "Adjust your filters or add a record."
                  : "Add a record to start building something useful."}
              </span>
            </div>
          )}
          <button
            type="button"
            className="grid-add-row"
            style={{ width: totalWidth }}
            onClick={onAddRecord}
          >
            <span className="grid-add-icon">
              <Plus size={17} />
            </span>
            <span>Add record</span>
          </button>
          <div className="grid-summary-row" style={{ minWidth: totalWidth }}>
            <div className="grid-gutter" />
            {fields.map((field, col) => (
              <div
                className={`grid-summary-cell ${col === 0 ? "grid-primary" : ""}`}
                key={field.id}
                style={{
                  width: fieldWidth(field),
                  ...(col === 0 ? { left: GUTTER } : {}),
                }}
              >
                {summaries[col] != null && (
                  <>
                    <span>SUM</span>
                    <CellDisplay
                      field={field}
                      value={summaries[col]}
                      workspace={workspace}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer className="grid-footer">
        <span>
          <strong>{records.length.toLocaleString()}</strong> record
          {records.length === 1 ? "" : "s"}
          {records.length !== table.records.length
            ? ` of ${table.records.length.toLocaleString()}`
            : ""}
        </span>
        <span className="grid-status" role="status">
          {notice ||
            (range.bottom > range.top || range.right > range.left
              ? `${(Math.min(range.bottom, orderedRecords.length - 1) - range.top + 1) * (Math.min(range.right, fields.length - 1) - range.left + 1)} cells selected`
              : "")}
        </span>
        <span className="grid-keyboard-hint">
          Enter to edit <span>·</span> Space to expand
        </span>
      </footer>
    </section>
  );
}
