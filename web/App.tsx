import { useMemo, useState, useEffect } from "react";
import {
  Plus,
  ChevronDown,
  Search,
  Grid2X2,
  Columns3,
  LayoutGrid,
  CalendarDays,
  ClipboardList,
  Filter,
  ArrowDownUp,
  Group,
  EyeOff,
  Rows3,
  MoreHorizontal,
  Download,
  Upload,
  History,
  Undo2,
  Redo2,
  HelpCircle,
  Home,
  Check,
  Database,
  HardDrive,
  ExternalLink,
  Trash2,
  Copy,
  Pencil,
  Menu,
  X,
  FileJson,
  FolderOpen,
  CheckCircle2,
} from "lucide-react";
import { Grid } from "./components/Grid";
import { CellInput, CellDisplay } from "./components/CellInput";
import { OtherViews } from "./components/OtherViews";
import { Dialog, Confirm } from "./components/Dialog";
import { FieldDialog } from "./components/FieldDialog";
import { ImportDialog } from "./components/ImportDialog";
import { useWorkspace } from "./useWorkspace";
import { evaluateWorkspace, validateWorkspace } from "./engine";
import {
  id,
  emptyView,
  newRow,
  isComputed,
  FIELD_TYPES,
  type Workspace,
  type Field,
  type View,
  type Cell,
  type CellChange,
  type Table,
  type Filter as FilterType,
} from "./types";
import {
  findTable,
  visibleRows,
  rawValue,
  displayText,
  blankBase,
  blankTable,
  cloneBase,
  download,
  exportCsv,
  removeRecords,
  applyCellChanges,
  deleteField as removeField,
  removeTable,
  saveField as updateField,
} from "./data";
import type { StorageAdapter, Saved, HistoryItem } from "./storage";
import "./style.css";
import "./grid.css";

const viewIcons: Record<View["type"], typeof Grid2X2> = {
  grid: Grid2X2,
  kanban: Columns3,
  gallery: LayoutGrid,
  calendar: CalendarDays,
  form: ClipboardList,
};
const viewNames: Record<View["type"], string> = {
  grid: "Grid",
  kanban: "Kanban",
  gallery: "Gallery",
  calendar: "Calendar",
  form: "Form",
};
type Modal =
  | "help"
  | "filter"
  | "sort"
  | "group"
  | "hide"
  | "view"
  | "newView"
  | "newBase"
  | "newTable"
  | "renameTable"
  | "baseSettings"
  | "import"
  | "history"
  | "backup"
  | null;
type ConfirmState = {
  title: string;
  message: string;
  action?: string;
  run: () => void;
};
function Mark() {
  return (
    <span className="fairtable-mark" aria-hidden="true">
      F
    </span>
  );
}

export default function App({
  adapter,
  initial,
}: {
  adapter: StorageAdapter;
  initial: Saved;
}) {
  const {
    workspace,
    update,
    undo,
    redo,
    canUndo,
    canRedo,
    status,
    error: saveError,
    restore,
  } = useWorkspace(adapter, initial);
  const [navigation, setNavigation] = useState(() => {
    try {
      return JSON.parse(
        localStorage.getItem("fairtable-navigation") ?? "{}",
      ) as {
        baseId?: string;
        tableId?: string;
        viewId?: string;
        home?: boolean;
      };
    } catch {
      return {};
    }
  });
  const [descriptionInput, setDescriptionInput] = useState("");
  const [home, setHome] = useState(navigation.home ?? false);
  const [modal, setModal] = useState<Modal>(null);
  const [fieldEditing, setFieldEditing] = useState<Field | null | undefined>(
    undefined,
  );
  const [recordId, setRecordId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [homeSearch, setHomeSearch] = useState("");
  const [toast, setToast] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmState | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [newViewType, setNewViewType] = useState<View["type"]>("grid");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sidebar, setSidebar] = useState(false);
  const [welcome, setWelcome] = useState(
    !localStorage.getItem("fairtable-welcomed"),
  );
  const base =
    workspace.bases.find((b) => b.id === navigation.baseId) ??
    workspace.bases[0];
  const table =
    base?.tables.find((t) => t.id === navigation.tableId) ?? base?.tables[0];
  const view =
    table?.views.find((v) => v.id === navigation.viewId) ?? table?.views[0];
  const evaluation = useMemo(() => evaluateWorkspace(workspace), [workspace]);
  // Read-only record-name projection. Calculated values never enter the saved document.
  const displayWorkspace = useMemo<Workspace>(
    () => ({
      ...workspace,
      bases: workspace.bases.map((b) => ({
        ...b,
        tables: b.tables.map((t) =>
          !isComputed(t.fields[0])
            ? t
            : {
                ...t,
                records: t.records.map((r) => ({
                  ...r,
                  cells: {
                    ...r.cells,
                    [t.fields[0].id]:
                      evaluation.values[t.id]?.[r.id]?.[t.fields[0].id] ?? null,
                  },
                })),
              },
        ),
      })),
    }),
    [workspace, evaluation],
  );
  const records = useMemo(
    () =>
      table && view
        ? visibleRows(table, view, evaluation, search, displayWorkspace)
        : [],
    [table, view, evaluation, search, displayWorkspace],
  );
  const selectedRecord = table?.records.find((r) => r.id === recordId);
  const notify = (message: string) => {
    setToast(message);
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    localStorage.setItem(
      "fairtable-navigation",
      JSON.stringify({ ...navigation, home }),
    );
  }, [navigation, home]);
  function go(baseId: string, tableId?: string, viewId?: string) {
    setNavigation({ baseId, tableId, viewId });
    setHome(false);
    setSearch("");
    setSidebar(false);
    setRecordId(null);
  }
  function mutate(fn: (draft: Workspace) => void, label: string) {
    try {
      update(fn, label);
    } catch (e) {
      notify((e as Error).message);
      throw e;
    }
  }
  function changeTable(
    fn: (table: Table, draft: Workspace) => void,
    label = "Edited table",
  ) {
    mutate((draft) => {
      const target = findTable(draft, table!.id);
      if (target) fn(target, draft);
    }, label);
  }
  function changeView(patch: Partial<View>) {
    changeTable((t) => {
      const current = t.views.find((v) => v.id === view!.id);
      if (current) Object.assign(current, patch);
    }, "Updated view");
  }
  function changeCells(changes: CellChange[]) {
    mutate(
      (draft) =>
        Object.assign(draft, applyCellChanges(draft, table!.id, changes)),
      changes.length === 1 ? "Edited a cell" : `Edited ${changes.length} cells`,
    );
  }
  function addRecord(cells: Record<string, Cell> = {}) {
    const row = newRow();
    mutate((draft) => {
      findTable(draft, table!.id)!.records.push(row);
      Object.assign(
        draft,
        applyCellChanges(
          draft,
          table!.id,
          Object.entries(cells).map(([fieldId, value]) => ({
            recordId: row.id,
            fieldId,
            value,
          })),
        ),
      );
    }, "Added a record");
    if (view?.type !== "form") setRecordId(row.id);
  }
  function saveField(next: Field) {
    mutate(
      (draft) =>
        Object.assign(draft, updateField(draft, table!.id, next, evaluation)),
      fieldEditing ? "Updated field" : "Created field",
    );
  }
  function deleteField(field: Field) {
    setConfirmation({
      title: `Delete “${field.name}”?`,
      message:
        "This removes the field and its values. Dependent lookup and rollup fields will also be removed. You can undo this action.",
      run: () => {
        mutate(
          (draft) =>
            Object.assign(draft, removeField(draft, table!.id, field.id)),
          "Deleted field",
        );
        setFieldEditing(undefined);
      },
    });
  }
  function deleteTable() {
    setConfirmation({
      title: `Delete “${table!.name}”?`,
      message:
        "This removes the table and its records. Linked and calculated fields in other tables that depend on it are also removed. You can undo this action.",
      run: () => {
        mutate(
          (draft) => Object.assign(draft, removeTable(draft, table!.id)),
          "Deleted table",
        );
      },
    });
  }
  function backup() {
    download(
      "fairtable-backup-" + new Date().toISOString().slice(0, 10) + ".json",
      JSON.stringify(workspace, null, 2),
    );
    notify("Workspace backup downloaded.");
  }
  async function loadBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 32 * 1024 * 1024)
        throw new Error("Choose a backup smaller than 32 MiB.");
      const parsed = JSON.parse(await file.text()) as Workspace;
      validateWorkspace(parsed);
      setConfirmation({
        title: "Restore this workspace?",
        message: `Replace the current workspace with “${parsed.name}” (${parsed.bases.length} bases). Your current workspace will be kept in history.`,
        action: "Restore backup",
        run: () => {
          mutate(
            (draft) => Object.assign(draft, parsed),
            "Before restoring backup",
          );
          setModal(null);
          setNavigation({});
          setHome(true);
        },
      });
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function openModal(next: Modal) {
    setModal(next);
    setNameInput("");
    if (next === "baseSettings") {
      setNameInput(base?.name ?? "");
      setDescriptionInput(base?.description ?? "");
    }
    if (next === "view") setNameInput(view?.name ?? "");
    if (next === "history")
      void adapter
        .history()
        .then(setHistory)
        .catch((e) => notify(e.message));
  }
  const close = () => setModal(null);
  const storageLabel =
    adapter.mode === "server"
      ? "Saved on your server"
      : "Saved in this browser";
  const Icon = view ? viewIcons[view.type] : Grid2X2;
  const createFromName = () => {
    if (!nameInput.trim()) {
      notify("Please enter a name.");
      return;
    }
    if (modal === "newBase") {
      const next = blankBase(nameInput.trim());
      mutate((draft) => draft.bases.push(next), "Created base");
      go(next.id);
    }
    if (modal === "newTable") {
      const next = blankTable(nameInput.trim());
      mutate(
        (draft) =>
          draft.bases.find((b) => b.id === base!.id)!.tables.push(next),
        "Created table",
      );
      go(base!.id, next.id);
    }
    if (modal === "renameTable")
      changeTable((t) => {
        t.name = nameInput.trim();
      }, "Renamed table");
    if (modal === "newView") {
      const next = emptyView(nameInput.trim(), newViewType);
      if (next.type === "kanban")
        next.groupFieldId = table!.fields.find(
          (f) => f.type === "singleSelect",
        )?.id;
      if (next.type === "calendar")
        next.dateFieldId = table!.fields.find((f) => f.type === "date")?.id;
      changeTable((t) => t.views.push(next), "Created view");
      go(base!.id, table!.id, next.id);
    }
    close();
  };
  return (
    <div className="app-shell">
      <aside className="app-rail">
        <button
          aria-label="Workspace home"
          title="Workspace home"
          onClick={() => setHome(true)}
        >
          <Mark />
        </button>
        <button
          className={home ? "selected" : ""}
          aria-label="Home"
          onClick={() => setHome(true)}
        >
          <Home size={20} />
        </button>
        <div className="rail-bases">
          {workspace.bases.map((b) => (
            <button
              key={b.id}
              aria-label={`Open ${b.name}`}
              title={b.name}
              className={!home && base?.id === b.id ? "selected" : ""}
              onClick={() => go(b.id)}
            >
              <span className="base-mini" style={{ background: b.color }}>
                {b.name.charAt(0).toUpperCase()}
              </span>
            </button>
          ))}
        </div>
        <button
          aria-label="Create base"
          title="Create base"
          onClick={() => openModal("newBase")}
        >
          <Plus size={21} />
        </button>
        <div className="rail-bottom">
          <button
            aria-label="Backup and restore"
            title="Backup and restore"
            onClick={() => openModal("backup")}
          >
            <HardDrive size={19} />
          </button>
          <button
            aria-label="Help and keyboard shortcuts"
            title="Help and keyboard shortcuts"
            onClick={() => openModal("help")}
          >
            <HelpCircle size={21} />
          </button>
          <span className="avatar" title="Personal workspace">
            You
          </span>
        </div>
      </aside>
      <div className="app-main">
        {saveError && (
          <div className="save-error" role="alert">
            <strong>Changes are not being saved.</strong>
            <span>{saveError}</span>
            <button onClick={backup}>Download unsaved backup</button>
            <button onClick={() => location.reload()}>Reload</button>
          </div>
        )}
        {home || !base ? (
          <>
            <header className="home-header">
              <div>
                <Mark />
                <strong>Fairtable</strong>
                <span className="edition">Personal edition</span>
              </div>
              <div className="home-header-actions">
                <span className={"save-status " + status} title={storageLabel}>
                  {status === "saved" ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <span className="saving-dot" />
                  )}
                  {status === "saved"
                    ? "Saved"
                    : status === "saving"
                      ? "Saving…"
                      : "Not saved"}
                </span>
                <button onClick={() => openModal("help")}>
                  <HelpCircle size={17} /> Help
                </button>
              </div>
            </header>
            <main className="workspace-home">
              <div className="home-intro">
                <div>
                  <div className="eyebrow">YOUR WORK, YOUR WAY</div>
                  <h1>{workspace.name}</h1>
                  <p>
                    If you know how to use Airtable, you know how to use
                    Fairtable.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => openModal("newBase")}
                >
                  <Plus size={17} /> Create a base
                </button>
              </div>
              <div className="home-tools">
                <h2>
                  All bases{" "}
                  <span className="count">{workspace.bases.length}</span>
                </h2>
                <label className="search-box">
                  <Search size={17} />
                  <input
                    placeholder="Find a base"
                    aria-label="Find a base"
                    value={homeSearch}
                    onChange={(e) => setHomeSearch(e.target.value)}
                  />
                </label>
              </div>
              <div className="base-cards">
                {workspace.bases
                  .filter((b) =>
                    b.name.toLowerCase().includes(homeSearch.toLowerCase()),
                  )
                  .map((b) => (
                    <button
                      className="base-card"
                      key={b.id}
                      onClick={() => go(b.id)}
                    >
                      <span
                        className="base-art"
                        style={{ background: b.color }}
                      >
                        <Grid2X2 size={28} />
                      </span>
                      <div>
                        <strong>{b.name}</strong>
                        <span>
                          {b.tables.length} tables ·{" "}
                          {b.tables
                            .reduce((n, t) => n + t.records.length, 0)
                            .toLocaleString()}{" "}
                          records
                        </span>
                      </div>
                      <ChevronDown className="turn-left" size={18} />
                    </button>
                  ))}
                <button
                  className="base-card new-base"
                  onClick={() => openModal("newBase")}
                >
                  <span className="base-art">
                    <Plus size={27} />
                  </span>
                  <div>
                    <strong>Start from scratch</strong>
                    <span>A blank canvas for your next idea</span>
                  </div>
                </button>
              </div>
              <section className="ownership-card">
                <div className="ownership-icon">
                  <Database size={26} />
                </div>
                <div>
                  <h3>Your tables. Your rules.</h3>
                  <p>
                    {adapter.mode === "server"
                      ? "Your workspace is stored in SQLite on your own server."
                      : "This edition saves your workspace on this device, in this browser. Your records are not uploaded."}{" "}
                    Download a backup to keep a portable copy.
                  </p>
                </div>
                <button onClick={backup}>
                  <Download size={16} /> Back up workspace
                </button>
              </section>
              <div className="home-bottom">
                <span>Open source · MIT license · Rust calculation engine</span>
                <button
                  className="text-button"
                  onClick={() => openModal("help")}
                >
                  About Fairtable <ExternalLink size={13} />
                </button>
              </div>
            </main>
          </>
        ) : (
          <>
            <header className="base-header">
              <div className="base-identity">
                <button
                  className="icon-button mobile-menu"
                  aria-label="Toggle views"
                  onClick={() => setSidebar(!sidebar)}
                >
                  <Menu size={19} />
                </button>
                <span
                  className="base-symbol"
                  style={{ background: base.color }}
                >
                  <Grid2X2 size={19} />
                </span>
                <button
                  className="base-name"
                  onClick={() => openModal("baseSettings")}
                >
                  {base.name}
                  <ChevronDown size={15} />
                </button>
              </div>
              <div className="base-section">
                <span>Data</span>
              </div>
              <div className="header-right">
                <span className={"save-status " + status} title={storageLabel}>
                  {status === "saving" ? (
                    <span className="saving-dot" />
                  ) : status === "saved" ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <span>!</span>
                  )}
                  {status === "saved"
                    ? "Saved"
                    : status === "saving"
                      ? "Saving…"
                      : "Not saved"}
                </span>
                <button
                  className="icon-button"
                  aria-label="Revision history"
                  title="Revision history"
                  onClick={() => openModal("history")}
                >
                  <History size={18} />
                </button>
                <button className="header-backup" onClick={backup}>
                  <Download size={15} /> Backup
                </button>
              </div>
            </header>
            <nav className="table-tabs" aria-label="Tables">
              {base.tables.map((t) => (
                <button
                  key={t.id}
                  className={t.id === table?.id ? "active" : ""}
                  onClick={() => go(base.id, t.id)}
                >
                  {t.name}
                  {t.id === table?.id && <ChevronDown size={13} />}
                </button>
              ))}
              <button
                aria-label="Add table"
                onClick={() => openModal("newTable")}
              >
                <Plus size={17} />
              </button>
              <button
                className="table-import"
                onClick={() => openModal("import")}
              >
                <Upload size={14} /> Import
              </button>
            </nav>
            {!table ? (
              <div className="view-empty">
                <Grid2X2 size={38} />
                <h2>A fresh start</h2>
                <p>
                  Add a table or bring in a CSV to start organizing your work.
                </p>
                <button
                  className="primary"
                  onClick={() => openModal("newTable")}
                >
                  <Plus size={16} /> Create a table
                </button>
              </div>
            ) : (
              <div className="base-workspace">
                <aside className={"view-sidebar " + (sidebar ? "is-open" : "")}>
                  <div className="view-sidebar-top">
                    <span>VIEWS</span>
                    <button
                      className="icon-button"
                      aria-label="Add view"
                      onClick={() => {
                        setNewViewType("grid");
                        openModal("newView");
                      }}
                    >
                      <Plus size={17} />
                    </button>
                  </div>
                  {table.views.map((v) => {
                    const I = viewIcons[v.type];
                    return (
                      <div
                        key={v.id}
                        className={
                          "view-link " + (v.id === view?.id ? "active" : "")
                        }
                      >
                        <button onClick={() => go(base.id, table.id, v.id)}>
                          <I size={16} />
                          <span>{v.name}</span>
                        </button>
                        {v.id === view?.id && (
                          <button
                            className="view-options icon-button"
                            aria-label="View settings"
                            onClick={(e) => {
                              e.stopPropagation();
                              openModal("view");
                            }}
                          >
                            <MoreHorizontal size={15} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <div className="view-create">
                    <span>CREATE A VIEW</span>
                    {(Object.keys(viewNames) as View["type"][]).map((type) => {
                      const I = viewIcons[type];
                      return (
                        <button
                          key={type}
                          onClick={() => {
                            setNewViewType(type);
                            openModal("newView");
                          }}
                        >
                          <I size={15} />
                          {viewNames[type]}
                          <Plus size={13} />
                        </button>
                      );
                    })}
                  </div>
                  <div className="sidebar-storage">
                    <HardDrive size={15} />
                    <span>
                      {adapter.mode === "server"
                        ? "Self-hosted workspace"
                        : "On this device"}
                    </span>
                  </div>
                </aside>
                <section className="table-content">
                  <div className="toolbar">
                    <button
                      className="view-title"
                      onClick={() => openModal("view")}
                    >
                      <Icon size={17} />
                      <span>{view?.name}</span>
                      <ChevronDown size={13} />
                    </button>
                    <span className="toolbar-divider" />
                    <button
                      className={view?.hiddenFields.length ? "engaged" : ""}
                      onClick={() => openModal("hide")}
                    >
                      <EyeOff size={15} />
                      <span>Hide fields</span>
                      {!!view?.hiddenFields.length && (
                        <b>{view.hiddenFields.length}</b>
                      )}
                    </button>
                    {view?.type !== "form" && (
                      <button
                        className={view?.filters.length ? "engaged" : ""}
                        onClick={() => openModal("filter")}
                      >
                        <Filter size={15} />
                        <span>Filter</span>
                        {!!view?.filters.length && <b>{view.filters.length}</b>}
                      </button>
                    )}
                    {(view?.type === "grid" || view?.type === "kanban") && (
                      <button
                        className={view?.groupFieldId ? "engaged" : ""}
                        onClick={() => openModal("group")}
                      >
                        <Group size={15} />
                        <span>Group</span>
                      </button>
                    )}
                    {view?.type !== "form" && (
                      <button
                        className={view?.sorts.length ? "engaged" : ""}
                        onClick={() => openModal("sort")}
                      >
                        <ArrowDownUp size={15} />
                        <span>Sort</span>
                        {!!view?.sorts.length && <b>{view.sorts.length}</b>}
                      </button>
                    )}
                    {view?.type === "grid" && (
                      <button
                        title="Change row height"
                        aria-label="Change row height"
                        onClick={() =>
                          changeView({
                            rowHeight:
                              view?.rowHeight === "compact"
                                ? "comfortable"
                                : view?.rowHeight === "comfortable"
                                  ? "tall"
                                  : "compact",
                          })
                        }
                      >
                        <Rows3 size={16} />
                      </button>
                    )}
                    <div className="toolbar-space" />
                    <button
                      className="icon-button"
                      aria-label="Undo"
                      title="Undo (Ctrl/⌘ Z)"
                      disabled={!canUndo}
                      onClick={undo}
                    >
                      <Undo2 size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Redo"
                      title="Redo (Ctrl/⌘ Shift Z)"
                      disabled={!canRedo}
                      onClick={redo}
                    >
                      <Redo2 size={16} />
                    </button>
                    {view?.type !== "form" && (
                      <label className="table-search">
                        <Search size={16} />
                        <input
                          aria-label="Search records"
                          placeholder="Find in view"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                          <button
                            className="icon-button"
                            aria-label="Clear search"
                            onClick={() => setSearch("")}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </label>
                    )}
                    <details className="menu">
                      <summary aria-label="Table actions">
                        <MoreHorizontal size={19} />
                      </summary>
                      <div
                        className="menu-items"
                        onClick={(e) =>
                          (
                            e.currentTarget.parentElement as HTMLDetailsElement
                          ).removeAttribute("open")
                        }
                      >
                        <button
                          onClick={() => {
                            setNameInput(table.name);
                            setModal("renameTable");
                          }}
                        >
                          <Pencil size={15} /> Rename table…
                        </button>
                        <button
                          onClick={() => {
                            download(
                              `${table.name}-${view?.name}.csv`,
                              exportCsv(
                                table,
                                view!,
                                records,
                                evaluation,
                                displayWorkspace,
                              ),
                              "text/csv;charset=utf-8",
                            );
                            notify(
                              `Exported ${records.length} records from this view.`,
                            );
                          }}
                        >
                          <Download size={15} /> Export this view as CSV
                        </button>
                        <button onClick={() => openModal("import")}>
                          <Upload size={15} /> Import CSV as a new table
                        </button>
                        <button className="danger-text" onClick={deleteTable}>
                          <Trash2 size={15} /> Delete table…
                        </button>
                      </div>
                    </details>
                  </div>
                  {view?.type === "grid" ? (
                    <Grid
                      table={table}
                      view={view}
                      records={records}
                      workspace={displayWorkspace}
                      evaluation={evaluation}
                      onChangeCells={changeCells}
                      onAddRecord={() => addRecord()}
                      onOpenRecord={setRecordId}
                      onEditField={(fieldId) =>
                        setFieldEditing(
                          table.fields.find((f) => f.id === fieldId),
                        )
                      }
                      onResizeField={(fieldId, width) =>
                        changeTable((t) => {
                          t.fields.find((f) => f.id === fieldId)!.width = width;
                        }, "Resized field")
                      }
                      onReorderField={(fieldId, beforeId) =>
                        changeTable((t) => {
                          const from = t.fields.findIndex(
                              (f) => f.id === fieldId,
                            ),
                            to = t.fields.findIndex((f) => f.id === beforeId);
                          if (from < 1 || to < 1) return;
                          const [field] = t.fields.splice(from, 1);
                          t.fields.splice(
                            t.fields.findIndex((f) => f.id === beforeId),
                            0,
                            field,
                          );
                        }, "Reordered fields")
                      }
                      onDeleteRecords={(ids) =>
                        setConfirmation({
                          title: `Delete ${ids.length} record${ids.length === 1 ? "" : "s"}?`,
                          message:
                            "These records will be removed from all views and linked fields. You can undo this action.",
                          run: () =>
                            mutate(
                              (draft) => removeRecords(draft, table.id, ids),
                              "Deleted records",
                            ),
                        })
                      }
                      onUndo={undo}
                      onRedo={redo}
                    />
                  ) : (
                    view && (
                      <OtherViews
                        key={view.id}
                        table={table}
                        view={view}
                        records={records}
                        workspace={displayWorkspace}
                        evaluation={evaluation}
                        onOpen={setRecordId}
                        onChange={changeCells}
                        onAdd={addRecord}
                        onConfigure={() => openModal("view")}
                      />
                    )
                  )}
                  <div className="table-bottom">
                    <button
                      className="text-button"
                      onClick={() => setFieldEditing(null)}
                    >
                      <Plus size={14} /> Add field
                    </button>
                    <span>
                      {records.length.toLocaleString()} of{" "}
                      {table.records.length.toLocaleString()} records
                    </span>
                    <span className="push-right">{storageLabel}</span>
                  </div>
                </section>
              </div>
            )}
          </>
        )}
      </div>
      {welcome && (
        <div className="welcome-card">
          <button
            className="icon-button"
            aria-label="Dismiss welcome"
            onClick={() => {
              setWelcome(false);
              localStorage.setItem("fairtable-welcomed", "1");
            }}
          >
            <X size={15} />
          </button>
          <span className="welcome-kicker">WELCOME TO FAIRTABLE</span>
          <strong>Familiar tables. Your data.</strong>
          <p>
            {adapter.mode === "server"
              ? "Your workspace saves to your own SQLite database."
              : "Your workspace saves privately in this browser."}{" "}
            The starter base is yours to explore and edit.
          </p>
          <button
            className="primary"
            onClick={() => {
              setWelcome(false);
              localStorage.setItem("fairtable-welcomed", "1");
            }}
          >
            Make yourself at home
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {fieldEditing !== undefined && table && (
        <FieldDialog
          key={fieldEditing?.id ?? "new"}
          table={table}
          workspace={displayWorkspace}
          field={fieldEditing ?? undefined}
          onClose={() => setFieldEditing(undefined)}
          onSave={saveField}
          onDelete={
            fieldEditing && table.fields[0].id !== fieldEditing.id
              ? () => deleteField(fieldEditing)
              : undefined
          }
        />
      )}
      {selectedRecord && table && (
        <Dialog
          title={
            displayText(
              rawValue(evaluation, table, selectedRecord, table.fields[0]),
              table.fields[0],
              displayWorkspace,
            ) || "Untitled record"
          }
          onClose={() => setRecordId(null)}
          wide
        >
          <div className="record-detail">
            <div className="record-detail-meta">
              <span>{table.name}</span>
              <span>
                Created{" "}
                {new Date(selectedRecord.createdAt).toLocaleDateString()}
              </span>
            </div>
            {table.fields.map((f) => (
              <div
                className="record-detail-field"
                role="group"
                aria-label={f.name}
                key={f.id}
              >
                <label>
                  <span className="field-symbol">
                    {FIELD_TYPES.find((t) => t.type === f.type)?.symbol}
                  </span>
                  {f.name}
                  {isComputed(f) && (
                    <span className="computed-tag">Calculated</span>
                  )}
                </label>
                {f.description && <p className="hint">{f.description}</p>}
                {isComputed(f) ? (
                  <div className="calculated-value">
                    <CellDisplay
                      field={f}
                      value={rawValue(evaluation, table, selectedRecord, f)}
                      workspace={displayWorkspace}
                      error={
                        evaluation.errors[table.id]?.[selectedRecord.id]?.[f.id]
                      }
                    />
                  </div>
                ) : (
                  <CellInput
                    key={f.id}
                    field={f}
                    value={selectedRecord.cells[f.id] ?? null}
                    workspace={displayWorkspace}
                    onChange={(value) =>
                      changeCells([
                        { recordId: selectedRecord.id, fieldId: f.id, value },
                      ])
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <div className="dialog-actions">
            <button
              className="danger-text text-button push-left"
              onClick={() =>
                setConfirmation({
                  title: "Delete this record?",
                  message:
                    "The record will be removed from all views. You can undo this action.",
                  run: () => {
                    mutate(
                      (draft) =>
                        removeRecords(draft, table.id, [selectedRecord.id]),
                      "Deleted record",
                    );
                    setRecordId(null);
                  },
                })
              }
            >
              <Trash2 size={15} /> Delete record
            </button>
            <button className="primary" onClick={() => setRecordId(null)}>
              Done
            </button>
          </div>
        </Dialog>
      )}
      {modal === "import" && (
        <ImportDialog
          onClose={close}
          onImport={(next) => {
            if (!base) {
              const created = blankBase("Imported data");
              created.tables = [next];
              mutate((draft) => draft.bases.push(created), "Imported CSV");
              go(created.id, next.id);
            } else {
              mutate(
                (draft) =>
                  draft.bases.find((b) => b.id === base.id)!.tables.push(next),
                "Imported CSV",
              );
              go(base.id, next.id);
            }
            notify(`Imported ${next.records.length.toLocaleString()} records.`);
          }}
        />
      )}
      {["newBase", "newTable", "renameTable", "newView"].includes(
        modal ?? "",
      ) && (
        <Dialog
          title={
            modal === "newBase"
              ? "Create a base"
              : modal === "renameTable"
                ? "Rename table"
                : modal === "newTable"
                  ? "Create a table"
                  : "Create a view"
          }
          onClose={close}
        >
          <div className="dialog-body">
            <label>
              {modal === "newView"
                ? "View name"
                : modal === "newBase"
                  ? "Base name"
                  : "Table name"}
              <input
                autoFocus
                placeholder={
                  modal === "newBase"
                    ? "e.g. Content calendar"
                    : modal === "newTable"
                      ? "e.g. Contacts"
                      : `${viewNames[newViewType]} view`
                }
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createFromName();
                }}
              />
            </label>
            {modal === "newView" && (
              <div className="view-types">
                {(Object.keys(viewNames) as View["type"][]).map((type) => {
                  const I = viewIcons[type];
                  return (
                    <button
                      key={type}
                      className={newViewType === type ? "active" : ""}
                      onClick={() => setNewViewType(type)}
                    >
                      <I size={20} />
                      {viewNames[type]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="dialog-actions">
            <button onClick={close}>Cancel</button>
            <button className="primary" onClick={createFromName}>
              {modal === "renameTable" ? "Save" : "Create"}
            </button>
          </div>
        </Dialog>
      )}
      {modal === "baseSettings" && base && (
        <Dialog title="Base settings" onClose={close}>
          <div className="dialog-body">
            <label>
              Base name
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
              />
            </label>
            <label>
              Description
              <textarea
                rows={3}
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
              />
            </label>
            <div className="base-colors">
              {[
                "#087f8c",
                "#2563eb",
                "#7c3aed",
                "#db2777",
                "#ea580c",
                "#16a34a",
                "#475569",
              ].map((color) => (
                <button
                  key={color}
                  aria-label={`Set base color ${color}`}
                  style={{ background: color }}
                  onClick={() =>
                    mutate((d) => {
                      d.bases.find((b) => b.id === base.id)!.color = color;
                    }, "Changed base color")
                  }
                >
                  {base.color === color && <Check size={17} />}
                </button>
              ))}
            </div>
            <div className="settings-actions">
              <button
                onClick={() => {
                  const copy = cloneBase(base);
                  mutate((d) => d.bases.push(copy), "Duplicated base");
                  go(copy.id);
                  close();
                }}
              >
                <Copy size={16} /> Duplicate base
              </button>
              <button
                className="danger-text"
                onClick={() =>
                  setConfirmation({
                    title: `Delete “${base.name}”?`,
                    message:
                      "This removes the base, its tables, and its records. Download a backup if you want a separate copy. You can undo this action.",
                    run: () => {
                      mutate((d) => {
                        const ids = new Set(base.tables.map((t) => t.id));
                        if (
                          d.bases
                            .filter((b) => b.id !== base.id)
                            .some((b) =>
                              b.tables.some((t) =>
                                t.fields.some((f) =>
                                  ids.has(f.linkedTableId ?? ""),
                                ),
                              ),
                            )
                        )
                          throw new Error(
                            "Remove links from other bases before deleting this base.",
                          );
                        d.bases = d.bases.filter((b) => b.id !== base.id);
                      }, "Deleted base");
                      close();
                      setHome(true);
                    },
                  })
                }
              >
                <Trash2 size={16} /> Delete base…
              </button>
            </div>
          </div>
          <div className="dialog-actions">
            <button onClick={close}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                if (nameInput.trim()) {
                  mutate((d) => {
                    const target = d.bases.find((b) => b.id === base.id)!;
                    target.name = nameInput.trim();
                    target.description = descriptionInput;
                  }, "Updated base");
                  close();
                }
              }}
            >
              Save changes
            </button>
          </div>
        </Dialog>
      )}
      {modal === "view" && view && table && (
        <Dialog title="View settings" onClose={close}>
          <div className="dialog-body">
            <label>
              View name
              <input
                autoFocus
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
              />
            </label>
            {view.type === "kanban" && (
              <label>
                Stack by
                <select
                  value={view.groupFieldId ?? ""}
                  onChange={(e) =>
                    changeView({ groupFieldId: e.target.value || undefined })
                  }
                >
                  <option value="">Choose a single-select field</option>
                  {table.fields
                    .filter((f) => f.type === "singleSelect")
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {view.type === "calendar" && (
              <label>
                Date field
                <select
                  value={view.dateFieldId ?? ""}
                  onChange={(e) =>
                    changeView({ dateFieldId: e.target.value || undefined })
                  }
                >
                  <option value="">Choose a date field</option>
                  {table.fields
                    .filter((f) => f.type === "date")
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {view.type === "form" && (
              <>
                <label>
                  Form description
                  <textarea
                    rows={3}
                    value={view.formDescription ?? ""}
                    onChange={(e) =>
                      changeView({ formDescription: e.target.value })
                    }
                  />
                </label>
                <h3>Required fields</h3>
                {table.fields
                  .filter((f) => !isComputed(f))
                  .map((f) => (
                    <label key={f.id} className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={view.requiredFields?.includes(f.id) ?? false}
                        onChange={(e) =>
                          changeView({
                            requiredFields: e.target.checked
                              ? [...(view.requiredFields ?? []), f.id]
                              : (view.requiredFields ?? []).filter(
                                  (x) => x !== f.id,
                                ),
                          })
                        }
                      />
                      {f.name}
                    </label>
                  ))}
                <p className="hint">
                  This personal form creates records in your workspace. Public
                  collection links are not part of this edition.
                </p>
              </>
            )}
            <button
              onClick={() => {
                const copy = structuredClone(view);
                copy.id = id();
                copy.name = view.name + " copy";
                copy.filters = copy.filters.map((f) => ({ ...f, id: id() }));
                changeTable((t) => t.views.push(copy), "Duplicated view");
                go(base!.id, table.id, copy.id);
                close();
              }}
            >
              <Copy size={15} /> Duplicate view
            </button>
            {table.views.length > 1 && (
              <button
                className="text-button danger-text"
                onClick={() => {
                  changeTable((t) => {
                    t.views = t.views.filter((v) => v.id !== view.id);
                  }, "Deleted view");
                  close();
                }}
              >
                <Trash2 size={15} /> Delete view
              </button>
            )}
          </div>
          <div className="dialog-actions">
            <button onClick={close}>Close</button>
            <button
              className="primary"
              onClick={() => {
                if (nameInput.trim()) changeView({ name: nameInput.trim() });
                close();
              }}
            >
              Save name
            </button>
          </div>
        </Dialog>
      )}
      {modal === "filter" && view && table && (
        <Dialog title="Filter records" onClose={close} wide>
          <div className="dialog-body">
            <p className="dialog-copy">
              Show records that match{" "}
              <select
                className="inline-select"
                value={view.filterMode}
                onChange={(e) =>
                  changeView({ filterMode: e.target.value as "and" | "or" })
                }
              >
                <option value="and">all conditions</option>
                <option value="or">any condition</option>
              </select>
              . Filtering never deletes records.
            </p>
            {view.filters.length === 0 && (
              <div className="settings-empty">
                <Filter size={25} />
                <p>All records are shown in this view.</p>
              </div>
            )}
            {view.filters.map((f, i) => (
              <div className="condition-row" key={f.id}>
                <span>
                  {i === 0 ? "Where" : view.filterMode === "and" ? "And" : "Or"}
                </span>
                <select
                  aria-label={`Filter ${i + 1} field`}
                  value={f.fieldId}
                  onChange={(e) =>
                    changeView({
                      filters: view.filters.map((x) =>
                        x.id === f.id ? { ...x, fieldId: e.target.value } : x,
                      ),
                    })
                  }
                >
                  {table.fields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Filter ${i + 1} operator`}
                  value={f.operator}
                  onChange={(e) =>
                    changeView({
                      filters: view.filters.map((x) =>
                        x.id === f.id
                          ? {
                              ...x,
                              operator: e.target
                                .value as FilterType["operator"],
                            }
                          : x,
                      ),
                    })
                  }
                >
                  {Object.entries({
                    contains: "contains",
                    notContains: "does not contain",
                    is: "is",
                    isNot: "is not",
                    empty: "is empty",
                    notEmpty: "is not empty",
                    gt: ">",
                    lt: "<",
                    gte: "≥",
                    lte: "≤",
                  }).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {!["empty", "notEmpty"].includes(f.operator) && (
                  <input
                    aria-label={`Filter ${i + 1} value`}
                    placeholder="Enter a value"
                    value={f.value}
                    onChange={(e) =>
                      changeView({
                        filters: view.filters.map((x) =>
                          x.id === f.id ? { ...x, value: e.target.value } : x,
                        ),
                      })
                    }
                  />
                )}
                <button
                  className="icon-button"
                  aria-label={`Remove filter ${i + 1}`}
                  onClick={() =>
                    changeView({
                      filters: view.filters.filter((x) => x.id !== f.id),
                    })
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              className="text-button"
              onClick={() =>
                changeView({
                  filters: [
                    ...view.filters,
                    {
                      id: id(),
                      fieldId: table.fields[0].id,
                      operator: "contains",
                      value: "",
                    },
                  ],
                })
              }
            >
              <Plus size={15} /> Add condition
            </button>
          </div>
          <div className="dialog-actions">
            <span className="muted push-left">
              {records.length} matching records
            </span>
            <button onClick={() => changeView({ filters: [] })}>
              Clear filters
            </button>
            <button className="primary" onClick={close}>
              Done
            </button>
          </div>
        </Dialog>
      )}
      {modal === "sort" && view && table && (
        <Dialog title="Sort records" onClose={close}>
          <div className="dialog-body">
            <p className="dialog-copy">
              Sort by these fields, in this order. New and edited records move
              into place automatically.
            </p>
            {view.sorts.map((s, i) => (
              <div className="sort-row" key={i}>
                <span>{i + 1}</span>
                <select
                  aria-label={`Sort ${i + 1} field`}
                  value={s.fieldId}
                  onChange={(e) =>
                    changeView({
                      sorts: view.sorts.map((x, j) =>
                        i === j ? { ...x, fieldId: e.target.value } : x,
                      ),
                    })
                  }
                >
                  {table.fields.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Sort ${i + 1} direction`}
                  value={s.direction}
                  onChange={(e) =>
                    changeView({
                      sorts: view.sorts.map((x, j) =>
                        i === j
                          ? {
                              ...x,
                              direction: e.target.value as "asc" | "desc",
                            }
                          : x,
                      ),
                    })
                  }
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <button
                  className="icon-button"
                  aria-label={`Remove sort ${i + 1}`}
                  onClick={() =>
                    changeView({ sorts: view.sorts.filter((_, j) => j !== i) })
                  }
                >
                  <X size={15} />
                </button>
              </div>
            ))}
            <button
              className="text-button"
              onClick={() =>
                changeView({
                  sorts: [
                    ...view.sorts,
                    { fieldId: table.fields[0].id, direction: "asc" },
                  ],
                })
              }
            >
              <Plus size={15} /> Add sort
            </button>
          </div>
          <div className="dialog-actions">
            <button onClick={() => changeView({ sorts: [] })}>
              Clear sorts
            </button>
            <button className="primary" onClick={close}>
              Done
            </button>
          </div>
        </Dialog>
      )}
      {modal === "group" && view && table && (
        <Dialog title="Group records" onClose={close}>
          <div className="dialog-body">
            <p className="dialog-copy">
              Organize records into groups using a field.
            </p>
            <label>
              Group by
              <select
                value={view.groupFieldId ?? ""}
                onChange={(e) =>
                  changeView({ groupFieldId: e.target.value || undefined })
                }
              >
                <option value="">No grouping</option>
                {table.fields
                  .filter(
                    (f) => view.type !== "kanban" || f.type === "singleSelect",
                  )
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="dialog-actions">
            <button className="primary" onClick={close}>
              Done
            </button>
          </div>
        </Dialog>
      )}
      {modal === "hide" && view && table && (
        <Dialog title="Visible fields" onClose={close}>
          <div className="dialog-body">
            <p className="dialog-copy">
              Choose the fields shown in this view. The primary field stays
              visible.
            </p>
            {table.fields.map((f, i) => (
              <label className="field-visibility" key={f.id}>
                <span className="field-symbol">
                  {FIELD_TYPES.find((t) => t.type === f.type)?.symbol}
                </span>
                <span>{f.name}</span>
                <input
                  aria-label={f.name}
                  type="checkbox"
                  disabled={i === 0}
                  checked={i === 0 || !view.hiddenFields.includes(f.id)}
                  onChange={(e) =>
                    changeView({
                      hiddenFields: e.target.checked
                        ? view.hiddenFields.filter((x) => x !== f.id)
                        : [...view.hiddenFields, f.id],
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="dialog-actions">
            <button onClick={() => changeView({ hiddenFields: [] })}>
              Show all fields
            </button>
            <button className="primary" onClick={close}>
              Done
            </button>
          </div>
        </Dialog>
      )}
      {modal === "history" && (
        <Dialog title="Revision history" onClose={close}>
          <div className="dialog-body">
            <p className="dialog-copy">
              Restore a previous saved workspace. The latest 30 prior versions
              are kept; restoring also saves your current version.
            </p>
            {history.length === 0 ? (
              <div className="settings-empty">
                <History size={28} />
                <p>Your edits will appear here.</p>
              </div>
            ) : (
              history.map((item) => (
                <div className="history-item" key={item.id}>
                  <History size={17} />
                  <div>
                    <strong>{item.label}</strong>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                  <button
                    onClick={() =>
                      setConfirmation({
                        title: "Restore this version?",
                        message:
                          "Your current workspace will be saved to history before restoring this version.",
                        action: "Restore",
                        run: () => {
                          void restore(item.id)
                            .then(() => {
                              close();
                              setRecordId(null);
                              notify("Workspace restored.");
                            })
                            .catch((e) => notify(e.message));
                        },
                      })
                    }
                  >
                    Restore
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="dialog-actions">
            <button onClick={close}>Close</button>
          </div>
        </Dialog>
      )}
      {modal === "backup" && (
        <Dialog title="Your data, always yours" onClose={close}>
          <div className="dialog-body">
            <div className="backup-callout">
              <HardDrive size={30} />
              <div>
                <h3>
                  {adapter.mode === "server"
                    ? "Stored on your server"
                    : "Stored in this browser"}
                </h3>
                <p>
                  {adapter.mode === "server"
                    ? "Fairtable saves to a local SQLite database."
                    : "Your workspace is saved in this browser’s local storage database. Clearing site data removes it; keep a backup."}
                </p>
              </div>
            </div>
            <button className="backup-choice" onClick={backup}>
              <FileJson size={24} />
              <div>
                <strong>Download a complete backup</strong>
                <span>
                  All bases, records, fields, links, and views in one JSON file
                </span>
              </div>
              <Download size={19} />
            </button>
            <label className="backup-choice">
              <FolderOpen size={24} />
              <div>
                <strong>Restore a backup</strong>
                <span>
                  Import a Fairtable workspace you previously downloaded
                </span>
              </div>
              <Upload size={19} />
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => void loadBackup(e.target.files?.[0])}
              />
            </label>
            <p className="hint">
              CSV exports are available in each table’s ••• menu. CSV contains
              the current view’s visible fields and matching records, not the
              complete workspace.
            </p>
          </div>
          <div className="dialog-actions">
            <button onClick={close}>Done</button>
          </div>
        </Dialog>
      )}
      {modal === "help" && (
        <Dialog title="Welcome to Fairtable" onClose={close} wide>
          <div className="dialog-body help-body">
            <div className="help-brand">
              <Mark />
              <div>
                <h3>Familiar tables. Your data.</h3>
                <p>An independent, open-source relational spreadsheet.</p>
              </div>
            </div>
            <p>
              Create bases for your projects, tables for your information, and
              views to see the same records in different ways. Double-click a
              cell to edit, or expand a record to see all its fields.
            </p>
            <h3>Keyboard shortcuts</h3>
            <div className="shortcut-list">
              {[
                ["Move between cells", "↑ ↓ ← →"],
                ["Edit the selected cell", "Enter / F2"],
                ["Extend your selection", "Shift + arrows"],
                ["Move to the next cell", "Tab"],
                ["Expand a record", "Space"],
                ["Copy / paste a range", "Ctrl/⌘ C / V"],
                ["Clear selected cells", "Delete / Backspace"],
                ["Undo / redo", "Ctrl/⌘ Z / Shift Z"],
                ["Close an editor or dialog", "Escape"],
              ].map(([label, key]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
            <h3>Personal edition</h3>
            <p>
              {adapter.mode === "server"
                ? "You are using the Rust server with durable SQLite storage."
                : "You are using the browser edition. The Rust engine runs on your device through WebAssembly, and records stay in this browser."}{" "}
              Backups include your complete workspace. Keep a backup before
              clearing browser data.
            </p>
            <p>
              Fairtable supports the everyday table workflows shown here. Team
              accounts, live collaboration, public form collection, automation
              builders, attachments, and full Airtable formula compatibility are
              not included in this release.
            </p>
            <div className="help-links">
              <a
                href="https://github.com/harrisonoconnorhover/fairtable"
                target="_blank"
                rel="noreferrer"
              >
                Source & self-hosting <ExternalLink size={14} />
              </a>
              <span>
                MIT license · Original implementation · Built with AI assistance
              </span>
            </div>
            <p className="hint">
              Fairtable is not affiliated with or endorsed by Airtable.
            </p>
          </div>
          <div className="dialog-actions">
            <button className="primary" onClick={close}>
              Back to my workspace
            </button>
          </div>
        </Dialog>
      )}
      {confirmation && (
        <Confirm
          title={confirmation.title}
          message={confirmation.message}
          action={confirmation.action}
          onClose={() => setConfirmation(null)}
          onConfirm={() => {
            try {
              confirmation.run();
            } catch (e) {
              notify((e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}
