import { useState } from "react";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CalendarDays,
  LayoutGrid,
} from "lucide-react";
import { CellDisplay, CellInput } from "./CellInput";
import {
  isComputed,
  type Table,
  type View,
  type Row,
  type Workspace,
  type Evaluation,
  type Cell,
  type CellChange,
} from "../types";
import { rawValue, displayText } from "../data";
type Props = {
  table: Table;
  view: View;
  records: Row[];
  workspace: Workspace;
  evaluation: Evaluation;
  onOpen: (id: string) => void;
  onChange: (changes: CellChange[]) => void;
  onAdd: (cells?: Record<string, Cell>) => void;
  onConfigure: () => void;
};
export function OtherViews(props: Props) {
  switch (props.view.type) {
    case "kanban":
      return <Board {...props} />;
    case "calendar":
      return <Calendar {...props} />;
    case "gallery":
      return <Gallery {...props} />;
    case "form":
      return <Form {...props} />;
    default:
      return null;
  }
}
function title(p: Props, row: Row) {
  return (
    displayText(
      rawValue(p.evaluation, p.table, row, p.table.fields[0]),
      p.table.fields[0],
      p.workspace,
    ) || "Untitled record"
  );
}
function Card({ p, row }: { p: Props; row: Row }) {
  const visible = p.table.fields
    .slice(1)
    .filter(
      (f) =>
        !p.view.hiddenFields.includes(f.id) && f.id !== p.view.groupFieldId,
    )
    .slice(0, 3);
  return (
    <button
      className="record-card"
      onClick={() => p.onOpen(row.id)}
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData("text/fairtable-record", row.id)
      }
    >
      <strong>{title(p, row)}</strong>
      {visible.map((f) => (
        <div className="card-field" key={f.id}>
          <span>{f.name}</span>
          <CellDisplay
            field={f}
            value={rawValue(p.evaluation, p.table, row, f)}
            workspace={p.workspace}
            error={p.evaluation.errors[p.table.id]?.[row.id]?.[f.id]}
          />
        </div>
      ))}
    </button>
  );
}
function Board(p: Props) {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const field =
    p.table.fields.find(
      (f) => f.id === p.view.groupFieldId && f.type === "singleSelect",
    ) ?? p.table.fields.find((f) => f.type === "singleSelect");
  if (!field)
    return (
      <div className="view-empty">
        <LayoutGrid />
        <h2>Choose a field for your board</h2>
        <p>Kanban organizes records by a single-select field.</p>
        <button onClick={p.onConfigure}>Configure view</button>
      </div>
    );
  const stacks = [
    { id: "", name: `No ${field.name}`, color: "#e8e9ed" },
    ...(field.options ?? []),
  ];
  return (
    <div className="board" aria-label="Kanban board">
      {stacks.map((option) => {
        const rows = p.records.filter((row) =>
          option.id
            ? row.cells[field.id] === option.name
            : !row.cells[field.id],
        );
        return (
          <section
            className="board-column"
            key={option.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const recordId = e.dataTransfer.getData("text/fairtable-record");
              if (recordId)
                p.onChange([
                  {
                    recordId,
                    fieldId: field.id,
                    value: option.id ? option.name : null,
                  },
                ]);
            }}
          >
            <header>
              <span
                className="status-dot"
                style={{ background: option.color }}
              />
              <h3>{option.name}</h3>
              <span className="count">{rows.length}</span>
              <button
                className="icon-button"
                aria-label={`Add record to ${option.name}`}
                onClick={() =>
                  p.onAdd({ [field.id]: option.id ? option.name : null })
                }
              >
                <Plus size={17} />
              </button>
            </header>
            <div className="board-cards">
              {rows.slice(0, limits[option.id] ?? 100).map((row) => (
                <Card key={row.id} p={p} row={row} />
              ))}
              {rows.length > (limits[option.id] ?? 100) && (
                <button
                  onClick={() =>
                    setLimits({
                      ...limits,
                      [option.id]: (limits[option.id] ?? 100) + 100,
                    })
                  }
                >
                  Show more ({rows.length - (limits[option.id] ?? 100)}{" "}
                  remaining)
                </button>
              )}
              <button
                className="add-card"
                onClick={() =>
                  p.onAdd({ [field.id]: option.id ? option.name : null })
                }
              >
                <Plus size={15} /> Add record
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
function Gallery(p: Props) {
  const [limit, setLimit] = useState(120);
  return (
    <div className="gallery">
      {p.records.slice(0, limit).map((row) => (
        <Card key={row.id} p={p} row={row} />
      ))}
      {p.records.length > limit && (
        <button className="gallery-add" onClick={() => setLimit(limit + 120)}>
          Show next {Math.min(120, p.records.length - limit)} records
        </button>
      )}
      <button className="gallery-add" onClick={() => p.onAdd()}>
        <Plus size={25} />
        <span>Add record</span>
      </button>
    </div>
  );
}
function Calendar(p: Props) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const field =
    p.table.fields.find(
      (f) => f.id === p.view.dateFieldId && f.type === "date",
    ) ?? p.table.fields.find((f) => f.type === "date");
  if (!field)
    return (
      <div className="view-empty">
        <CalendarDays />
        <h2>Add a date field to use Calendar</h2>
        <p>Choose which date places your records on the calendar.</p>
        <button onClick={p.onConfigure}>Configure view</button>
      </div>
    );
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());
  const dates = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return (
    <div className="calendar-view">
      <div className="calendar-heading">
        <h2>
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </h2>
        <button
          onClick={() =>
            setMonth(
              new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            )
          }
        >
          Today
        </button>
        <button
          className="icon-button"
          aria-label="Previous month"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
          }
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="Next month"
          onClick={() =>
            setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
          }
        >
          <ChevronRight size={18} />
        </button>
        <span className="muted">Using {field.name}</span>
      </div>
      <div className="calendar-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div className="weekday" key={d}>
            {d}
          </div>
        ))}
        {dates.map((date) => (
          <div
            key={key(date)}
            className={
              "calendar-day " +
              (date.getMonth() !== month.getMonth() ? "outside " : "") +
              (key(date) === key(new Date()) ? "today" : "")
            }
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const recordId = e.dataTransfer.getData("text/fairtable-record");
              if (recordId)
                p.onChange([{ recordId, fieldId: field.id, value: key(date) }]);
            }}
          >
            <div className="day-heading">
              <span>{date.getDate()}</span>
              <button
                className="icon-button"
                aria-label={`Add record on ${key(date)}`}
                onClick={() => p.onAdd({ [field.id]: key(date) })}
              >
                <Plus size={13} />
              </button>
            </div>
            {p.records
              .filter((r) => r.cells[field.id] === key(date))
              .map((row) => (
                <button
                  className="calendar-record"
                  key={row.id}
                  onClick={() => p.onOpen(row.id)}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData("text/fairtable-record", row.id)
                  }
                >
                  {title(p, row)}
                </button>
              ))}
          </div>
        ))}
      </div>
      <details className="unscheduled">
        <summary>
          {p.records.filter((r) => !r.cells[field.id]).length} records without a
          date
        </summary>
        <p className="hint">
          Drag a record onto a day to schedule it, or open it to set{" "}
          {field.name}.
        </p>
        {p.records
          .filter((r) => !r.cells[field.id])
          .map((row) => (
            <button
              key={row.id}
              onClick={() => p.onOpen(row.id)}
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData("text/fairtable-record", row.id)
              }
            >
              {title(p, row)}
            </button>
          ))}
      </details>
    </div>
  );
}
function Form(p: Props) {
  const [values, setValues] = useState<Record<string, Cell>>({}),
    [error, setError] = useState(""),
    [submitted, setSubmitted] = useState(false);
  const fields = p.table.fields.filter(
    (f) => !isComputed(f) && !p.view.hiddenFields.includes(f.id),
  );
  if (submitted)
    return (
      <div className="form-page">
        <div className="form-paper submitted">
          <CheckCircle2 size={44} />
          <h1>Record added</h1>
          <p>Your response has been added to {p.table.name}.</p>
          <button
            className="primary"
            onClick={() => {
              setValues({});
              setSubmitted(false);
            }}
          >
            Add another response
          </button>
        </div>
      </div>
    );
  return (
    <div className="form-page">
      <form
        className="form-paper"
        onSubmit={(e) => {
          e.preventDefault();
          if (!e.currentTarget.reportValidity()) return;
          setError("");
          try {
            for (const f of fields.filter((f) =>
              p.view.requiredFields?.includes(f.id),
            )) {
              const v = values[f.id];
              if (
                v === null ||
                v === undefined ||
                v === "" ||
                v === false ||
                (Array.isArray(v) && !v.length)
              )
                throw new Error(`${f.name} is required.`);
            }
            p.onAdd(values);
            setSubmitted(true);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <div className="form-brand">
          F<span>Fairtable</span>
        </div>
        <h1>{p.view.name}</h1>
        <p>{p.view.formDescription || `Add a record to ${p.table.name}.`}</p>
        {fields.map((f) => (
          <div className="form-field" key={f.id}>
            <label>
              {f.name}
              {p.view.requiredFields?.includes(f.id) && (
                <span className="required"> *</span>
              )}
            </label>
            {f.description && <p className="hint">{f.description}</p>}
            <CellInput
              field={f}
              value={values[f.id] ?? null}
              workspace={p.workspace}
              onChange={(value) =>
                setValues((current) => ({ ...current, [f.id]: value }))
              }
            />
          </div>
        ))}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <button className="primary" type="submit">
          Submit
        </button>
        <p className="form-footnote">
          Personal form · submits to this workspace
        </p>
      </form>
    </div>
  );
}
