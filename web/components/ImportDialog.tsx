import { useState } from "react";
import { Upload, FileSpreadsheet } from "lucide-react";
import { Dialog } from "./Dialog";
import { parseCsv, csvTable } from "../data";
import type { Table, Field } from "../types";
export function ImportDialog({
  onImport,
  onClose,
}: {
  onImport: (table: Table) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("Imported table");
  const [data, setData] = useState<ReturnType<typeof parseCsv> | null>(null);
  const [types, setTypes] = useState<Field["type"][]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(file?: File) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 32 * 1024 * 1024)
        throw new Error("Choose a CSV smaller than 32 MiB.");
      const parsed = parseCsv(await file.text());
      setData(parsed);
      setName(file.name.replace(/\.csv$/i, ""));
      setTypes(parsed.headers.map(() => "text"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog title="Import a CSV" onClose={onClose} wide>
      <div className="dialog-body">
        <p className="dialog-copy">
          Bring a spreadsheet into a new table. Review the columns before
          importing; your existing tables stay intact.
        </p>
        {!data ? (
          <label
            className="file-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void load(e.dataTransfer.files[0]);
            }}
          >
            <Upload size={30} />
            <strong>Choose a CSV or drop it here</strong>
            <span>UTF-8 · up to 25,000 records · 32 MiB</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void load(e.target.files?.[0])}
            />
          </label>
        ) : (
          <>
            <div className="import-meta">
              <FileSpreadsheet size={21} />
              <span>
                {data.rows.length.toLocaleString()} records ·{" "}
                {data.headers.length} fields
              </span>
              <button className="text-button" onClick={() => setData(null)}>
                Choose another file
              </button>
            </div>
            <label>
              Table name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <p className="hint">
              The first row supplies field names. Text is the safe default: it
              preserves leading zeros and identifiers. Choose numeric or date
              types where appropriate.
            </p>
            <div className="import-preview">
              <table>
                <thead>
                  <tr>
                    {data.headers.map((h, i) => (
                      <th key={i}>
                        {h}
                        <select
                          aria-label={`Type for ${h}`}
                          value={types[i]}
                          onChange={(e) =>
                            setTypes(
                              types.map((t, j) =>
                                i === j ? (e.target.value as Field["type"]) : t,
                              ),
                            )
                          }
                        >
                          <option value="text">Text</option>
                          <option value="longText">Long text</option>
                          <option value="number">Number</option>
                          <option value="currency">Currency</option>
                          <option value="percent">Percent</option>
                          <option value="checkbox">Checkbox</option>
                          <option value="date">Date (YYYY-MM-DD)</option>
                          <option value="email">Email</option>
                          <option value="url">URL</option>
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>
                          {cell || <span className="muted">Empty</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              Previewing the first {Math.min(5, data.rows.length)} records. All
              records are validated before anything is saved.
            </p>
          </>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={!data || busy}
          onClick={() => {
            setBusy(true);
            setTimeout(() => {
              try {
                if (!name.trim()) throw new Error("Give the table a name.");
                onImport(
                  csvTable(name.trim(), data!.headers, data!.rows, types),
                );
                onClose();
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }, 30);
          }}
        >
          {busy ? "Importing…" : "Import table"}
        </button>
      </div>
    </Dialog>
  );
}
