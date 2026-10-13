import { useState } from "react";
import { Plus, Trash2, Info } from "lucide-react";
import { Dialog } from "./Dialog";
import {
  FIELD_TYPES,
  PALETTE,
  id,
  type Field,
  type FieldType,
  type Table,
  type Workspace,
} from "../types";
export function FieldDialog({
  table,
  workspace,
  field,
  onSave,
  onDelete,
  onClose,
}: {
  table: Table;
  workspace: Workspace;
  field?: Field;
  onSave: (field: Field) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Field>(
    field
      ? structuredClone(field)
      : { id: id(), name: "", type: "text", width: 180 },
  );
  const [error, setError] = useState("");
  const tables = workspace.bases.flatMap((b) => b.tables);
  const linkField = table.fields.find((f) => f.id === draft.linkFieldId);
  const target = tables.find((t) => t.id === linkField?.linkedTableId);
  const patch = (partial: Partial<Field>) =>
    setDraft((d) => ({ ...d, ...partial }));
  function setType(type: FieldType) {
    setDraft((d) => ({
      id: d.id,
      name: d.name,
      type,
      width: d.width,
      ...(["singleSelect", "multiSelect"].includes(type)
        ? {
            options: [
              { id: id(), name: "Option 1", color: PALETTE[0] },
              { id: id(), name: "Option 2", color: PALETTE[1] },
            ],
          }
        : {}),
      ...(type === "formula"
        ? { formula: "{" + table.fields[0].name + "}" }
        : {}),
      ...(type === "link"
        ? {
            linkedTableId:
              tables.find((t) => t.id !== table.id)?.id ?? table.id,
          }
        : {}),
      ...(["lookup", "rollup"].includes(type)
        ? {
            linkFieldId: table.fields.find((f) => f.type === "link")?.id,
            aggregation: "SUM" as const,
          }
        : {}),
    }));
  }
  const save = () => {
    try {
      if (!draft.name.trim()) throw new Error("Give this field a name.");
      if (
        table.fields.some(
          (f) =>
            f.id !== draft.id &&
            f.name.toLowerCase() === draft.name.trim().toLowerCase(),
        )
      )
        throw new Error("A field with this name already exists.");
      if (draft.options?.some((o) => !o.name.trim()))
        throw new Error("Each option needs a name.");
      if (
        draft.options &&
        new Set(draft.options.map((o) => o.name.trim())).size !==
          draft.options.length
      )
        throw new Error("Option names must be unique.");
      if (
        ["lookup", "rollup"].includes(draft.type) &&
        (!draft.linkFieldId || !draft.targetFieldId)
      )
        throw new Error("Choose a linked field and a field to look up.");
      onSave({ ...draft, name: draft.name.trim() });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog title={field ? "Edit field" : "Create a field"} onClose={onClose}>
      <div className="dialog-body field-dialog">
        <label>
          Field name
          <input
            autoFocus
            value={draft.name}
            placeholder="e.g. Launch date"
            onChange={(e) => patch({ name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
          />
        </label>
        <label>
          Field type
          <select
            aria-label="Field type"
            value={draft.type}
            onChange={(e) => setType(e.target.value as FieldType)}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.symbol} {t.label}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          {FIELD_TYPES.find((t) => t.type === draft.type)?.description}
        </p>
        {["number", "currency", "percent"].includes(draft.type) && (
          <label>
            Decimal places
            <select
              value={draft.precision ?? (draft.type === "currency" ? 2 : 0)}
              onChange={(e) => patch({ precision: Number(e.target.value) })}
            >
              {[0, 1, 2, 3, 4].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
        )}
        {draft.options && (
          <section>
            <h3>Options</h3>
            {draft.options.map((option, i) => (
              <div className="option-row" key={option.id}>
                <button
                  title="Change option color"
                  className="color-dot"
                  style={{ background: option.color }}
                  onClick={() =>
                    patch({
                      options: draft.options!.map((o, j) =>
                        j === i
                          ? {
                              ...o,
                              color:
                                PALETTE[
                                  (PALETTE.indexOf(o.color) + 1) %
                                    PALETTE.length
                                ],
                            }
                          : o,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`Option ${i + 1}`}
                  value={option.name}
                  onChange={(e) =>
                    patch({
                      options: draft.options!.map((o, j) =>
                        j === i ? { ...o, name: e.target.value } : o,
                      ),
                    })
                  }
                />
                <button
                  className="icon-button"
                  aria-label={`Remove ${option.name}`}
                  onClick={() =>
                    patch({ options: draft.options!.filter((_, j) => j !== i) })
                  }
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <button
              className="text-button"
              onClick={() =>
                patch({
                  options: [
                    ...draft.options!,
                    {
                      id: id(),
                      name: `Option ${draft.options!.length + 1}`,
                      color: PALETTE[draft.options!.length % PALETTE.length],
                    },
                  ],
                })
              }
            >
              <Plus size={15} /> Add option
            </button>
          </section>
        )}
        {draft.type === "link" && (
          <label>
            Link to table
            <select
              value={draft.linkedTableId ?? ""}
              onChange={(e) => patch({ linkedTableId: e.target.value })}
            >
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.id === table.id ? " (this table)" : ""}
                </option>
              ))}
            </select>
            <span className="hint">
              Records are connected by their identity, so renaming them keeps
              links intact.
            </span>
          </label>
        )}
        {["lookup", "rollup"].includes(draft.type) && (
          <>
            <label>
              Linked record field
              <select
                value={draft.linkFieldId ?? ""}
                onChange={(e) =>
                  patch({
                    linkFieldId: e.target.value,
                    targetFieldId: undefined,
                  })
                }
              >
                <option value="">Choose a linked field</option>
                {table.fields
                  .filter((f) => f.type === "link")
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Field from linked table
              <select
                value={draft.targetFieldId ?? ""}
                onChange={(e) => patch({ targetFieldId: e.target.value })}
              >
                <option value="">Choose a field</option>
                {target?.fields
                  .filter((f) => f.id !== draft.id)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </label>
            {draft.type === "rollup" && (
              <label>
                Summarize with
                <select
                  value={draft.aggregation ?? "SUM"}
                  onChange={(e) =>
                    patch({
                      aggregation: e.target.value as Field["aggregation"],
                    })
                  }
                >
                  {[
                    "SUM",
                    "AVERAGE",
                    "MIN",
                    "MAX",
                    "COUNT",
                    "COUNTA",
                    "ARRAYJOIN",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {draft.type === "formula" && (
          <>
            <label>
              Formula
              <textarea
                className="formula-input"
                rows={4}
                value={draft.formula ?? ""}
                onChange={(e) => patch({ formula: e.target.value })}
                placeholder={'IF({Status} = "Done", 1, 0)'}
              />
            </label>
            <div className="formula-fields">
              {table.fields
                .filter((f) => f.id !== draft.id)
                .map((f) => (
                  <button
                    key={f.id}
                    onClick={() =>
                      patch({
                        formula: (draft.formula ?? "") + "{" + f.name + "}",
                      })
                    }
                  >
                    {"{" + f.name + "}"}
                  </button>
                ))}
            </div>
            <p className="hint">
              Use field names in braces. Supports arithmetic, comparisons, IF,
              AND, OR, SUM, ROUND, CONCATENATE, UPPER, LOWER, LEN and more.
              Formula errors appear in the cells.
            </p>
          </>
        )}
        <label>
          Description <span className="muted">optional</span>
          <textarea
            rows={2}
            value={draft.description ?? ""}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Help people understand this field"
          />
        </label>
        {field && field.type !== draft.type && (
          <p className="notice">
            <Info size={16} /> Existing values will be converted only if every
            value fits the new type.
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-actions">
        {field && onDelete && (
          <button
            className="text-button danger-text push-left"
            onClick={onDelete}
          >
            <Trash2 size={15} /> Delete field
          </button>
        )}
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={save}>
          {field ? "Save field" : "Create field"}
        </button>
      </div>
    </Dialog>
  );
}
