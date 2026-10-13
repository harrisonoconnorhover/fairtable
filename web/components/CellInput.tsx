import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { isComputed, type Cell, type Field, type Workspace } from "../types";

export function cellText(
  field: Field,
  value: Cell | undefined,
  workspace: Workspace,
): string {
  if (value == null) return "";
  if (field.type === "link" && Array.isArray(value)) {
    const table = workspace.bases
      .flatMap((base) => base.tables)
      .find((table) => table.id === field.linkedTableId);
    return value
      .map((id) => {
        const row = table?.records.find((record) => record.id === id);
        const primary = table?.fields[0];
        return row && primary
          ? String(row.cells[primary.id] ?? "Untitled record")
          : "Missing record";
      })
      .join(", ");
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function CellDisplay({
  field,
  value,
  workspace,
  error,
}: {
  field: Field;
  value: Cell | undefined;
  workspace: Workspace;
  error?: string;
}) {
  if (error)
    return (
      <span className="cell-error" title={error}>
        #ERROR!
      </span>
    );
  if (field.type === "checkbox")
    return (
      <span
        className={`cell-check ${value === true ? "cell-check-on" : ""}`}
        role="img"
        aria-label={value === true ? "Checked" : "Unchecked"}
      >
        {value === true && <Check size={13} strokeWidth={3} />}
      </span>
    );
  if (value == null || value === "") return null;
  if (field.type === "singleSelect" || field.type === "multiSelect") {
    const values = Array.isArray(value) ? value : [String(value)];
    return (
      <span className="cell-tags">
        {values.map((name, index) => (
          <span
            className="cell-tag"
            key={`${name}-${index}`}
            style={{
              background:
                field.options?.find((option) => option.name === name)?.color ??
                "#e8e9ed",
            }}
          >
            {name}
          </span>
        ))}
      </span>
    );
  }
  if (field.type === "link") {
    const table = workspace.bases
      .flatMap((base) => base.tables)
      .find((table) => table.id === field.linkedTableId);
    return (
      <span className="cell-tags">
        {(Array.isArray(value) ? value : []).map((id) => {
          const record = table?.records.find((row) => row.id === id);
          return (
            <span className="cell-tag cell-link-tag" key={id}>
              {record
                ? String(
                    record.cells[table!.fields[0]?.id] ?? "Untitled record",
                  )
                : "Missing record"}
            </span>
          );
        })}
      </span>
    );
  }
  if (typeof value === "number") {
    const decimals = Math.min(
      10,
      Math.max(0, field.precision ?? (field.type === "currency" ? 2 : 2)),
    );
    const formatted = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: decimals,
      ...(field.type === "currency"
        ? {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: decimals,
          }
        : {}),
    }).format(value);
    return (
      <span className="cell-number">
        {formatted}
        {field.type === "percent" ? "%" : ""}
      </span>
    );
  }
  return (
    <span
      className={`cell-text ${field.type === "email" || field.type === "url" ? "cell-text-link" : ""}`}
      title={cellText(field, value, workspace)}
    >
      {cellText(field, value, workspace)}
    </span>
  );
}

export function parseCellText(
  field: Field,
  text: string,
  workspace: Workspace,
): Cell {
  if (isComputed(field))
    throw new Error(`${field.name} is calculated and cannot be edited.`);
  if (text === "") return null;
  switch (field.type) {
    case "number":
    case "currency":
    case "percent": {
      const clean = text.trim().replace(/[$,%]/g, "").replace(/,/g, "");
      const value = Number(clean);
      if (!clean || !Number.isFinite(value))
        throw new Error(`${field.name}: “${text}” is not a number.`);
      return value;
    }
    case "checkbox": {
      const clean = text.trim().toLowerCase();
      if (["true", "yes", "1", "checked", "x", "✓"].includes(clean))
        return true;
      if (["false", "no", "0", "unchecked"].includes(clean)) return false;
      throw new Error(`${field.name}: use true or false for checkboxes.`);
    }
    case "date": {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        !Number.isFinite(Date.parse(`${text}T00:00:00Z`)) ||
        new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text
      )
        throw new Error(
          `${field.name}: use a valid date in YYYY-MM-DD format.`,
        );
      return text;
    }
    case "singleSelect": {
      if (!field.options?.some((option) => option.name === text))
        throw new Error(`${field.name}: “${text}” is not an existing option.`);
      return text;
    }
    case "multiSelect": {
      // JSON preserves commas in option names; comma-separated labels are convenient for ordinary TSV.
      let values: unknown;
      try {
        values = text.startsWith("[")
          ? JSON.parse(text)
          : text.split(",").map((part) => part.trim());
      } catch {
        throw new Error(
          `${field.name}: enter option names separated by commas.`,
        );
      }
      if (
        !Array.isArray(values) ||
        values.some(
          (value) =>
            typeof value !== "string" ||
            !field.options?.some((option) => option.name === value),
        )
      )
        throw new Error(`${field.name}: one or more options do not exist.`);
      return [...new Set(values)] as string[];
    }
    case "link": {
      const table = workspace.bases
        .flatMap((base) => base.tables)
        .find((table) => table.id === field.linkedTableId);
      if (!table)
        throw new Error(`${field.name}: the linked table is unavailable.`);
      let names: unknown;
      try {
        names = text.startsWith("[")
          ? JSON.parse(text)
          : text.split(",").map((part) => part.trim());
      } catch {
        throw new Error(
          `${field.name}: enter linked record names or IDs separated by commas.`,
        );
      }
      if (
        !Array.isArray(names) ||
        names.some((name) => typeof name !== "string")
      )
        throw new Error(`${field.name}: invalid linked records.`);
      return [
        ...new Set(
          (names as string[]).map((name) => {
            const byId = table.records.find((record) => record.id === name);
            if (byId) return byId.id;
            const matches = table.records.filter(
              (record) =>
                String(record.cells[table.fields[0]?.id] ?? "") === name,
            );
            if (matches.length !== 1)
              throw new Error(
                `${field.name}: “${name}” ${matches.length ? "matches several records; use its record ID" : "does not match an existing record"}.`,
              );
            return matches[0].id;
          }),
        ),
      ];
    }
    default:
      return text;
  }
}

type Navigate = "next" | "previous" | "down" | "up";
interface CellInputProps {
  field: Field;
  value: Cell;
  workspace: Workspace;
  onChange: (value: Cell) => void;
  onClose?: () => void;
  autoFocus?: boolean;
  compact?: boolean;
  onNavigate?: (direction: Navigate) => void;
  initialText?: string;
}

export function CellInput({
  field,
  value,
  workspace,
  onChange,
  onClose,
  autoFocus = false,
  compact = false,
  onNavigate,
  initialText,
}: CellInputProps) {
  const [draft, setDraft] = useState(
    initialText ?? (value == null ? "" : String(value)),
  );
  const [error, setError] = useState("");
  const [open, setOpen] = useState(autoFocus);
  const [query, setQuery] = useState(initialText ?? "");
  const [highlight, setHighlight] = useState(0);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 240,
    maxHeight: 300,
  });
  const wrapper = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const completed = useRef(false);
  const picker = ["singleSelect", "multiSelect", "link"].includes(field.type);
  const multiple = field.type !== "singleSelect";

  useEffect(() => {
    setDraft(initialText ?? (value == null ? "" : String(value)));
    completed.current = false;
  }, [value, field.id, initialText]);
  useEffect(() => {
    if (autoFocus && !picker && field.type !== "checkbox") {
      input.current?.focus();
      if (initialText === undefined) input.current?.select();
    }
  }, [autoFocus, picker, field.type, initialText]);
  useEffect(() => {
    popup.current
      ?.querySelector(".cell-picker-highlight")
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);
  useLayoutEffect(() => {
    if (!open || !picker) return;
    const place = () => {
      const box = wrapper.current?.getBoundingClientRect();
      if (!box) return;
      const width = Math.min(Math.max(box.width, 260), window.innerWidth - 16);
      const below = window.innerHeight - box.bottom - 12;
      const height = Math.min(340, Math.max(below, box.top - 12));
      setPosition({
        left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
        top:
          below >= Math.min(240, height)
            ? box.bottom + 4
            : Math.max(8, box.top - height - 4),
        width,
        maxHeight: height,
      });
    };
    const outside = (event: PointerEvent) => {
      if (
        !wrapper.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      ) {
        setOpen(false);
        onClose?.();
      }
    };
    place();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, picker, onClose]);

  const close = () => {
    setOpen(false);
    if (onClose) onClose();
    else
      wrapper.current
        ?.querySelector<HTMLButtonElement>(".cell-picker-trigger")
        ?.focus({ preventScroll: true });
  };
  const save = (next: Cell, finish = true) => {
    try {
      onChange(next);
      setError("");
      if (finish) {
        completed.current = true;
        close();
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };
  const commit = () => {
    if (completed.current) return true;
    try {
      return save(parseCellText(field, draft, workspace));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };

  if (isComputed(field))
    return (
      <div className="cell-readonly">
        <CellDisplay field={field} value={value} workspace={workspace} />
        <small>Calculated field</small>
      </div>
    );
  if (field.type === "checkbox")
    return (
      <label className="cell-checkbox-input">
        <input
          type="checkbox"
          checked={value === true}
          autoFocus={autoFocus}
          onChange={(event) => save(event.target.checked, false)}
        />
        <span>{value === true ? "Checked" : "Unchecked"}</span>
        {error && <small role="alert">{error}</small>}
      </label>
    );

  const linkedTable =
    field.type === "link"
      ? workspace.bases
          .flatMap((base) => base.tables)
          .find((table) => table.id === field.linkedTableId)
      : undefined;
  const options =
    field.type === "link"
      ? (linkedTable?.records.map((record) => ({
          id: record.id,
          name: String(
            record.cells[linkedTable.fields[0]?.id] ?? "Untitled record",
          ),
          color: "#e6eff4",
        })) ?? [])
      : (field.options ?? []);
  const filtered = options.filter((option) =>
    option.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const shown = filtered.slice(0, 100);
  const selected = (option: (typeof options)[number]) =>
    multiple
      ? Array.isArray(value) &&
        value.includes(field.type === "link" ? option.id : option.name)
      : value === option.name;
  const choose = (option: (typeof options)[number]) => {
    const key = field.type === "link" ? option.id : option.name;
    if (!multiple) save(key);
    else {
      const current = Array.isArray(value) ? value : [];
      save(
        current.includes(key)
          ? current.filter((item) => item !== key)
          : [...current, key],
        false,
      );
    }
  };

  return (
    <div
      className={`cell-input-wrap ${compact ? "cell-input-compact" : ""}`}
      ref={wrapper}
    >
      {picker ? (
        <>
          <button
            type="button"
            className="cell-picker-trigger"
            aria-label={`Choose ${field.name}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <span>
              <CellDisplay field={field} value={value} workspace={workspace} />
              {(value == null ||
                value === "" ||
                (Array.isArray(value) && !value.length)) && (
                <span className="cell-placeholder">
                  Choose{" "}
                  {field.type === "link"
                    ? "records"
                    : multiple
                      ? "options"
                      : "an option"}
                  …
                </span>
              )}
            </span>
            <ChevronDown size={14} />
          </button>
          {open &&
            createPortal(
              <div
                ref={popup}
                className="cell-picker"
                style={position}
                onPointerDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setHighlight((index) =>
                      Math.min(shown.length - 1, index + 1),
                    );
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setHighlight((index) => Math.max(0, index - 1));
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (shown[highlight]) choose(shown[highlight]);
                  }
                  if (event.key === "Tab") {
                    if (onNavigate) {
                      event.preventDefault();
                      close();
                      onNavigate(event.shiftKey ? "previous" : "next");
                    } else close();
                  }
                }}
              >
                <div className="cell-picker-search">
                  <Search size={15} />
                  <input
                    autoFocus
                    aria-label={`Search ${field.name}`}
                    placeholder="Search…"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setHighlight(0);
                    }}
                  />
                </div>
                <div
                  role="listbox"
                  aria-label={field.name}
                  aria-multiselectable={multiple}
                  className="cell-picker-options"
                >
                  {shown.map((option, index) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected(option)}
                      className={`cell-picker-option ${highlight === index ? "cell-picker-highlight" : ""}`}
                      key={option.id}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => choose(option)}
                    >
                      <span
                        className="cell-tag"
                        style={{ background: option.color }}
                      >
                        {option.name}
                      </span>
                      {selected(option) && <Check size={15} />}
                    </button>
                  ))}
                  {!shown.length && (
                    <div className="cell-picker-empty">
                      {options.length
                        ? "No matches found"
                        : field.type === "link"
                          ? "No records in the linked table"
                          : "Add options in field settings"}
                    </div>
                  )}
                  {filtered.length > shown.length && (
                    <div className="cell-picker-empty">
                      Showing 100 of {filtered.length}. Search to narrow the
                      list.
                    </div>
                  )}
                </div>
                {error && (
                  <div role="alert" className="cell-input-error">
                    {error}
                  </div>
                )}
                <div className="cell-picker-footer">
                  <button type="button" onClick={() => save(null, !multiple)}>
                    <X size={12} /> Clear
                  </button>
                  {multiple && (
                    <button type="button" onClick={close}>
                      Done
                    </button>
                  )}
                </div>
              </div>,
              wrapper.current?.closest("dialog") ?? document.body,
            )}
        </>
      ) : field.type === "longText" ? (
        <textarea
          ref={(node) => {
            input.current = node;
          }}
          aria-label={field.name}
          value={draft}
          rows={compact ? 1 : 4}
          onChange={(event) => {
            completed.current = false;
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              completed.current = true;
              setDraft(value == null ? "" : String(value));
              onClose?.();
            }
            if (
              (event.key === "Enter" &&
                ((compact && !event.shiftKey) ||
                  event.metaKey ||
                  event.ctrlKey)) ||
              (event.key === "Tab" && onNavigate)
            ) {
              event.preventDefault();
              if (commit())
                onNavigate?.(
                  event.key === "Tab"
                    ? event.shiftKey
                      ? "previous"
                      : "next"
                    : "down",
                );
            }
          }}
        />
      ) : (
        <input
          ref={(node) => {
            input.current = node;
          }}
          type={
            field.type === "date"
              ? "date"
              : field.type === "email"
                ? "email"
                : "text"
          }
          inputMode={
            ["number", "currency", "percent"].includes(field.type)
              ? "decimal"
              : undefined
          }
          aria-label={field.name}
          value={draft}
          onChange={(event) => {
            completed.current = false;
            setDraft(event.target.value);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              event.preventDefault();
              completed.current = true;
              setDraft(value == null ? "" : String(value));
              onClose?.();
            }
            if (event.key === "Enter" || event.key === "Tab") {
              if (event.key === "Enter" || onNavigate) event.preventDefault();
              if (commit())
                onNavigate?.(
                  event.key === "Tab"
                    ? event.shiftKey
                      ? "previous"
                      : "next"
                    : event.shiftKey
                      ? "up"
                      : "down",
                );
            }
          }}
        />
      )}
      {error && !picker && (
        <div role="alert" className="cell-input-error">
          {error}
        </div>
      )}
    </div>
  );
}
