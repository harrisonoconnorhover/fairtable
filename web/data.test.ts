import { describe, expect, it } from "vitest";
import {
  applyCellChanges,
  cloneBase,
  deleteField,
  findTable,
  parseCell,
  parseCsv,
  removeTable,
  saveField,
  starterWorkspace,
  visibleRows,
} from "./data";
import type { Cell, Field, Row, Table, View, Workspace } from "./types";

const oldTime = "2026-10-01T00:00:00Z",
  newTime = "2026-10-13T12:00:00Z";
const field = (
  id: string,
  type: Field["type"] = "text",
  extra: Partial<Field> = {},
): Field => ({ id, name: id, type, width: 180, ...extra });
const row = (id: string, cells: Record<string, Cell> = {}): Row => ({
  id,
  cells,
  createdAt: oldTime,
  updatedAt: oldTime,
});
const view = (id: string, ref?: string): View => ({
  id,
  name: id,
  type: "grid",
  filters: ref
    ? [{ id: id + "-filter", fieldId: ref, operator: "notEmpty", value: "" }]
    : [],
  sorts: ref ? [{ fieldId: ref, direction: "asc" }] : [],
  hiddenFields: ref ? [ref] : [],
  filterMode: "and",
  rowHeight: "compact",
  ...(ref
    ? { groupFieldId: ref, dateFieldId: ref, requiredFields: [ref] }
    : {}),
});
const table = (
  id: string,
  fields: Field[],
  records: Row[],
  views: View[] = [view(id + "-view")],
): Table => ({ id, name: id, fields, records, views });
function fixture(): Workspace {
  const a = table(
    "a",
    [
      field("a-name"),
      field("amount", "number"),
      field("a-b", "link", { linkedTableId: "b", inverseFieldId: "b-a" }),
      field("a-b-other", "link", {
        linkedTableId: "b",
        inverseFieldId: "b-a-other",
      }),
    ],
    [
      row("a1", {
        "a-name": "One",
        amount: 10,
        "a-b": ["b1"],
        "a-b-other": ["b2"],
      }),
      row("a2", { "a-name": "Two", amount: 20, "a-b": ["b1"] }),
    ],
  );
  const b = table(
    "b",
    [
      field("b-name"),
      field("b-a", "link", { linkedTableId: "a", inverseFieldId: "a-b" }),
      field("b-a-other", "link", {
        linkedTableId: "a",
        inverseFieldId: "a-b-other",
      }),
      field("unpaired", "link", { linkedTableId: "a" }),
      field("lookup", "lookup", {
        linkFieldId: "b-a",
        targetFieldId: "amount",
      }),
      field("formula", "formula", { formula: "SUM({lookup})" }),
    ],
    [
      row("b1", { "b-name": "First", "b-a": ["a1", "a2"], unpaired: ["a1"] }),
      row("b2", { "b-name": "Second", "b-a-other": ["a1"] }),
    ],
    [view("b-view", "lookup")],
  );
  const c = table(
    "c",
    [
      field("c-name"),
      field("c-b", "link", { linkedTableId: "b" }),
      field("rollup", "rollup", {
        linkFieldId: "c-b",
        targetFieldId: "lookup",
        aggregation: "SUM",
      }),
    ],
    [row("c1", { "c-name": "Summary", "c-b": ["b1"] })],
    [view("c-view", "rollup")],
  );
  // Reverse dependency order proves cleanup is recursive rather than one pass.
  return {
    version: 1,
    name: "Fixture",
    bases: [
      {
        id: "base",
        name: "Fixture",
        color: "blue",
        description: "",
        tables: [c, b, a],
      },
    ],
  };
}
const cells = (workspace: Workspace, tableId: string, rowId: string) =>
  findTable(workspace, tableId)!.records.find((row) => row.id === rowId)!.cells;

describe("import and duplication", () => {
  it("deduplicates CSV headers case-insensitively without changing cell text", () => {
    const parsed = parseCsv("Name,name,NAME 2,,Name\n001,002,003,004,005");
    expect(parsed.headers).toEqual([
      "Name",
      "name 2",
      "NAME 2 2",
      "Field 4",
      "Name 3",
    ]);
    expect(parsed.rows).toEqual([["001", "002", "003", "004", "005"]]);
  });

  it("imports numeric formatting without turning a bare currency or percent symbol into zero", () => {
    expect(parseCell("$1,234.50", field("price", "currency"))).toBe(1234.5);
    expect(parseCell("0%", field("percent", "percent"))).toBe(0);
    expect(() => parseCell("$", field("price", "currency"))).toThrow(
      "not a number",
    );
    expect(() => parseCell("%", field("percent", "percent"))).toThrow(
      "not a number",
    );
  });

  it("duplicates identities and internal links while preserving literal text and formula source", () => {
    const original = fixture().bases[0],
      a = original.tables.find((table) => table.id === "a")!;
    a.records[0].cells["a-name"] = "b1";
    a.views[0].filters = [
      { id: "literal-filter", fieldId: "a-name", operator: "is", value: "b1" },
    ];
    a.fields.push(field("literal-formula", "formula", { formula: '"b1"' }));
    const before = structuredClone(original),
      copy = cloneBase(original),
      copyA = copy.tables.find((table) => table.name === "a")!,
      copyB = copy.tables.find((table) => table.name === "b")!;
    const copiedField = (name: string) =>
      copyA.fields.find((field) => field.name === name)!;
    const forward = copiedField("a-b"),
      back = copyB.fields.find((field) => field.name === "b-a")!;
    expect(original).toEqual(before);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Fixture copy");
    expect(copyA.id).not.toBe("a");
    expect(copyA.records[0].id).not.toBe("a1");
    expect(forward.linkedTableId).toBe(copyB.id);
    expect(forward.inverseFieldId).toBe(back.id);
    expect(back.inverseFieldId).toBe(forward.id);
    expect(copyA.records[0].cells[forward.id]).toEqual([copyB.records[0].id]);
    expect(copyB.records[0].cells[back.id]).toEqual(
      copyA.records.map((row) => row.id),
    );
    expect(copyA.records[0].cells[copiedField("a-name").id]).toBe("b1");
    expect(copyA.views[0].filters[0]).toMatchObject({
      fieldId: copiedField("a-name").id,
      value: "b1",
    });
    expect(copyA.views[0].filters[0].id).not.toBe("literal-filter");
    expect(copiedField("literal-formula").formula).toBe('"b1"');
  });

  it("keeps external linked records as one-way links without editing the original pair", () => {
    const workspace = fixture(),
      a = findTable(workspace, "a")!,
      base = { ...workspace.bases[0], tables: [a] },
      before = structuredClone(workspace);
    const copy = cloneBase(base),
      copied = copy.tables[0],
      forward = copied.fields.find((field) => field.name === "a-b")!;
    expect(workspace).toEqual(before);
    expect(forward.linkedTableId).toBe("b");
    expect(forward.inverseFieldId).toBeUndefined();
    expect(copied.records[0].cells[forward.id]).toEqual(["b1"]);
    expect(
      findTable(workspace, "b")!.fields.find((field) => field.id === "b-a")!
        .inverseFieldId,
    ).toBe("a-b");
  });
});

describe("reciprocal cell changes", () => {
  it("updates exactly the explicit inverse, preserving other relationships and input", () => {
    const original = fixture(),
      before = structuredClone(original);
    const next = applyCellChanges(
      original,
      "a",
      [{ recordId: "a1", fieldId: "a-b", value: ["b2", "b2"] }],
      newTime,
    );
    expect(original).toEqual(before);
    expect(cells(next, "a", "a1")["a-b"]).toEqual(["b2"]);
    expect(cells(next, "b", "b1")["b-a"]).toEqual(["a2"]);
    expect(cells(next, "b", "b2")["b-a"]).toEqual(["a1"]);
    expect(cells(next, "b", "b2")["b-a-other"]).toEqual(["a1"]);
    expect(cells(next, "b", "b1").unpaired).toEqual(["a1"]);
    expect(findTable(next, "b")!.records.map((row) => row.updatedAt)).toEqual([
      newTime,
      newTime,
    ]);
    expect(findTable(next, "a")!.records[1].updatedAt).toBe(oldTime);
  });

  it("supports changes from either side, clears links, and never guesses an inverse", () => {
    const original = fixture();
    const next = applyCellChanges(
      original,
      "b",
      [
        { recordId: "b1", fieldId: "b-a", value: null },
        { recordId: "b2", fieldId: "unpaired", value: ["a2"] },
      ],
      newTime,
    );
    expect(cells(next, "a", "a1")["a-b"]).toEqual([]);
    expect(cells(next, "a", "a2")["a-b"]).toEqual([]);
    expect(cells(next, "a", "a1")["a-b-other"]).toEqual(["b2"]);
    expect(cells(next, "a", "a2")["a-b-other"]).toBeUndefined();
  });

  it("keeps self-table pairs coherent, including a self-linked record", () => {
    const workspace: Workspace = {
      version: 1,
      name: "Self",
      bases: [
        {
          id: "base",
          name: "Base",
          color: "blue",
          description: "",
          tables: [
            table(
              "people",
              [
                field("name"),
                field("parent", "link", {
                  linkedTableId: "people",
                  inverseFieldId: "children",
                }),
                field("children", "link", {
                  linkedTableId: "people",
                  inverseFieldId: "parent",
                }),
              ],
              [row("one"), row("two")],
            ),
          ],
        },
      ],
    };
    const next = applyCellChanges(
      workspace,
      "people",
      [{ recordId: "one", fieldId: "parent", value: ["one", "two"] }],
      newTime,
    );
    expect(cells(next, "people", "one").children).toEqual(["one"]);
    expect(cells(next, "people", "two").children).toEqual(["one"]);
    const cleared = applyCellChanges(
      next,
      "people",
      [{ recordId: "two", fieldId: "children", value: [] }],
      newTime,
    );
    expect(cells(cleared, "people", "one").parent).toEqual(["one"]);
  });

  it("rejects a bad batch atomically and leaves calculated cells read-only", () => {
    const workspace = fixture(),
      before = structuredClone(workspace);
    expect(() =>
      applyCellChanges(
        workspace,
        "a",
        [
          { recordId: "a1", fieldId: "amount", value: 99 },
          { recordId: "a1", fieldId: "a-b", value: ["deleted"] },
        ],
        newTime,
      ),
    ).toThrow("no longer exists");
    expect(workspace).toEqual(before);
    expect(() =>
      applyCellChanges(
        workspace,
        "b",
        [{ recordId: "b1", fieldId: "lookup", value: 123 }],
        newTime,
      ),
    ).toThrow("calculated");
    expect(() =>
      applyCellChanges(
        workspace,
        "a",
        [{ recordId: "missing", fieldId: "amount", value: 1 }],
        newTime,
      ),
    ).toThrow("no longer exists");
  });

  it("seeds an explicit pair that remains coherent when a task moves projects", () => {
    const original = starterWorkspace(),
      tasks = original.bases[0].tables.find((t) => t.name === "Tasks")!,
      projects = original.bases[0].tables.find((t) => t.name === "Projects")!;
    const project = tasks.fields.find((f) => f.type === "link")!,
      backlink = projects.fields.find((f) => f.id === project.inverseFieldId)!;
    expect(backlink.inverseFieldId).toBe(project.id);
    const task = tasks.records[0],
      oldProject = (task.cells[project.id] as string[])[0],
      nextProject = projects.records.find((row) => row.id !== oldProject)!;
    const next = applyCellChanges(
      original,
      tasks.id,
      [{ recordId: task.id, fieldId: project.id, value: [nextProject.id] }],
      newTime,
    );
    expect(cells(next, projects.id, oldProject)[backlink.id]).not.toContain(
      task.id,
    );
    expect(cells(next, projects.id, nextProject.id)[backlink.id]).toContain(
      task.id,
    );
  });
});

describe("field and table deletion", () => {
  it("removes indirect derived dependents and every affected view reference", () => {
    const original = fixture(),
      before = structuredClone(original),
      next = deleteField(original, "a", "amount");
    expect(original).toEqual(before);
    expect(findTable(next, "a")!.fields.map((field) => field.id)).not.toContain(
      "amount",
    );
    expect(findTable(next, "b")!.fields.map((field) => field.id)).not.toContain(
      "lookup",
    );
    expect(findTable(next, "c")!.fields.map((field) => field.id)).not.toContain(
      "rollup",
    );
    expect(
      findTable(next, "b")!.fields.some((field) => field.id === "formula"),
    ).toBe(true);
    expect(cells(next, "a", "a1").amount).toBeUndefined();
    for (const id of ["b", "c"]) {
      const cleaned = findTable(next, id)!.views[0];
      expect(cleaned.filters).toEqual([]);
      expect(cleaned.sorts).toEqual([]);
      expect(cleaned.hiddenFields).toEqual([]);
      expect(cleaned.requiredFields).toEqual([]);
      expect(cleaned.groupFieldId).toBeUndefined();
      expect(cleaned.dateFieldId).toBeUndefined();
    }
  });

  it("detaches a surviving inverse when its paired field is deleted", () => {
    const next = deleteField(fixture(), "a", "a-b");
    expect(
      findTable(next, "b")!.fields.find((field) => field.id === "b-a")!
        .inverseFieldId,
    ).toBeUndefined();
    expect(cells(next, "b", "b1")["b-a"]).toEqual(["a1", "a2"]);
  });

  it("removes incoming links and all recursive dependents when a table is deleted", () => {
    const original = fixture(),
      before = structuredClone(original),
      next = removeTable(original, "a");
    expect(original).toEqual(before);
    expect(findTable(next, "a")).toBeUndefined();
    expect(findTable(next, "b")!.fields.map((field) => field.id)).toEqual([
      "b-name",
      "formula",
    ]);
    expect(findTable(next, "c")!.fields.map((field) => field.id)).toEqual([
      "c-name",
      "c-b",
    ]);
    expect(cells(next, "b", "b1")).toEqual({ "b-name": "First" });
    expect(findTable(next, "c")!.views[0].filters).toEqual([]);
  });

  it("protects primary fields and leaves a rejected cascading deletion unchanged", () => {
    const original = fixture();
    expect(() => deleteField(original, "a", "a-name")).toThrow("primary field");
    const b = findTable(original, "b")!;
    b.fields = [
      b.fields.find((field) => field.id === "lookup")!,
      ...b.fields.filter((field) => field.id !== "lookup"),
    ];
    const before = structuredClone(original);
    expect(() => deleteField(original, "a", "amount")).toThrow("primary field");
    expect(() => removeTable(original, "a")).toThrow("primary field");
    expect(original).toEqual(before);
  });
});

describe("ordered date filters", () => {
  const workspace: Workspace = {
    version: 1,
    name: "Dates",
    bases: [
      {
        id: "base",
        name: "Base",
        color: "blue",
        description: "",
        tables: [
          table(
            "dates",
            [field("date", "date"), field("number", "number")],
            [
              row("before", { date: "2026-09-30", number: 2 }),
              row("same", { date: "2026-10-13", number: 10 }),
              row("after", { date: "2026-11-01", number: 20 }),
              row("blank", { date: null, number: null }),
            ],
          ),
        ],
      },
    ],
  };
  const tableValue = findTable(workspace, "dates")!;
  const filtered = (
    operator: View["filters"][number]["operator"],
    value = "2026-10-13",
    fieldId = "date",
  ) =>
    visibleRows(
      tableValue,
      {
        ...view("dates-view"),
        filters: [{ id: "filter", fieldId, operator, value }],
      },
      { values: {}, errors: {} },
      "",
      workspace,
    ).map((row) => row.id);

  it("compares dates chronologically for all four ordered operators", () => {
    expect(filtered("gt")).toEqual(["after"]);
    expect(filtered("lt")).toEqual(["before"]);
    expect(filtered("gte")).toEqual(["same", "after"]);
    expect(filtered("lte")).toEqual(["before", "same"]);
  });
  it("excludes blank or invalid filter dates and retains numeric ordering", () => {
    expect(filtered("gt", "")).toEqual([]);
    expect(filtered("lt", "nonsense")).toEqual([]);
    expect(filtered("gt", "2026-02-31")).toEqual([]);
    expect(filtered("gt", "10", "number")).toEqual(["after"]);
  });
});

describe("field schema edits", () => {
  const evaluation = { values: {}, errors: {} };
  it("renames and removes used select options by stable ID for single and multiple selection", () => {
    const workspace = fixture(),
      a = findTable(workspace, "a")!;
    const options = [
      { id: "red", name: "Red", color: "red" },
      { id: "blue", name: "Blue", color: "blue" },
    ];
    a.fields.push(
      field("single", "singleSelect", { options }),
      field("multi", "multiSelect", {
        options: options.map((option) => ({
          ...option,
          id: option.id + "-multi",
        })),
      }),
    );
    a.records[0].cells.single = "Red";
    a.records[1].cells.single = "Blue";
    a.records[0].cells.multi = ["Red", "Blue"];
    const before = structuredClone(workspace);
    const single = saveField(
      workspace,
      "a",
      field("single", "singleSelect", {
        options: [{ ...options[0], name: "Crimson" }],
      }),
      evaluation,
    );
    expect(cells(single, "a", "a1").single).toBe("Crimson");
    expect(cells(single, "a", "a2").single).toBeNull();
    const multi = saveField(
      single,
      "a",
      field("multi", "multiSelect", {
        options: [{ id: "red-multi", name: "Crimson", color: "red" }],
      }),
      evaluation,
    );
    expect(cells(multi, "a", "a1").multi).toEqual(["Crimson"]);
    expect(workspace).toEqual(before);
  });

  it("rewrites case-insensitive formula field tokens while leaving string literals intact", () => {
    const workspace = fixture(),
      a = findTable(workspace, "a")!;
    a.fields.push(
      field("local-formula", "formula", {
        formula: "{AMOUNT} & \"{amount}\" & '{amount}'",
      }),
    );
    const next = saveField(
      workspace,
      "a",
      field("amount", "number", { name: "Price" }),
      evaluation,
    );
    expect(
      findTable(next, "a")!.fields.find(
        (field) => field.id === "local-formula",
      )!.formula,
    ).toBe("{Price} & \"{amount}\" & '{amount}'");
  });

  it("converts all rows atomically, including calculated values", () => {
    const workspace = fixture(),
      a = findTable(workspace, "a")!;
    a.records[0].cells.amount = "12";
    a.records[1].cells.amount = "not a number";
    a.fields.find((field) => field.id === "amount")!.type = "text";
    const before = structuredClone(workspace);
    expect(() =>
      saveField(workspace, "a", field("amount", "number"), evaluation),
    ).toThrow("not a number");
    expect(workspace).toEqual(before);
    const converted = saveField(workspace, "b", field("formula", "number"), {
      values: { b: { b1: { formula: 45 }, b2: { formula: 0 } } },
      errors: {},
    });
    expect(cells(converted, "b", "b1").formula).toBe(45);
    expect(cells(converted, "b", "b2").formula).toBe(0);
  });

  it("preserves an existing pair when editing it and creates a pair for a new link", () => {
    const workspace = fixture(),
      source = findTable(workspace, "a")!.fields.find(
        (field) => field.id === "a-b",
      )!;
    const edited = saveField(
      workspace,
      "a",
      { ...source, name: "Related B" },
      evaluation,
    );
    expect(findTable(edited, "b")!.fields.length).toBe(
      findTable(workspace, "b")!.fields.length,
    );
    expect(
      findTable(edited, "a")!.fields.find((field) => field.id === "a-b")!
        .inverseFieldId,
    ).toBe("b-a");
    const created = saveField(
      workspace,
      "a",
      field("new-link", "link", { linkedTableId: "b" }),
      evaluation,
    );
    const forward = findTable(created, "a")!.fields.find(
        (field) => field.id === "new-link",
      )!,
      back = findTable(created, "b")!.fields.find(
        (field) => field.id === forward.inverseFieldId,
      )!;
    expect(back.linkedTableId).toBe("a");
    expect(back.inverseFieldId).toBe(forward.id);
    expect(cells(created, "b", "b1")[back.id]).toEqual([]);
  });

  it("detaches old reciprocal metadata and removes lookups when a link becomes text", () => {
    const workspace = fixture(),
      a = findTable(workspace, "a")!;
    a.fields.push(
      field("linked-name", "lookup", {
        linkFieldId: "a-b",
        targetFieldId: "b-name",
      }),
    );
    const next = saveField(workspace, "a", field("a-b", "text"), evaluation);
    expect(cells(next, "a", "a1")["a-b"]).toBe("First");
    expect(
      findTable(next, "a")!.fields.some((field) => field.id === "linked-name"),
    ).toBe(false);
    expect(
      findTable(next, "b")!.fields.find((field) => field.id === "b-a")!
        .inverseFieldId,
    ).toBeUndefined();
    expect(cells(next, "b", "b1")["b-a"]).toEqual(["a1", "a2"]);
  });

  it("requires populated links to be cleared before retargeting and builds a valid replacement pair", () => {
    const workspace = fixture(),
      source = findTable(workspace, "a")!.fields.find(
        (field) => field.id === "a-b",
      )!;
    expect(() =>
      saveField(workspace, "a", { ...source, linkedTableId: "c" }, evaluation),
    ).toThrow("Clear existing links");
    const cleared = applyCellChanges(
      workspace,
      "a",
      [
        { recordId: "a1", fieldId: "a-b", value: [] },
        { recordId: "a2", fieldId: "a-b", value: [] },
      ],
      newTime,
    );
    const next = saveField(
        cleared,
        "a",
        { ...source, linkedTableId: "c" },
        evaluation,
      ),
      saved = findTable(next, "a")!.fields.find((field) => field.id === "a-b")!;
    expect(
      findTable(next, "b")!.fields.find((field) => field.id === "b-a")!
        .inverseFieldId,
    ).toBeUndefined();
    expect(
      findTable(next, "c")!.fields.find(
        (field) => field.id === saved.inverseFieldId,
      )!.inverseFieldId,
    ).toBe("a-b");
  });

  it("converts text into uniquely matched linked records and synchronizes the new inverse", () => {
    const workspace = fixture(),
      a = findTable(workspace, "a")!;
    a.fields.push(field("convert"));
    a.records[0].cells.convert = "First";
    a.records[1].cells.convert = "Second";
    const next = saveField(
        workspace,
        "a",
        field("convert", "link", { linkedTableId: "b" }),
        evaluation,
      ),
      saved = findTable(next, "a")!.fields.find(
        (field) => field.id === "convert",
      )!;
    expect(cells(next, "a", "a1").convert).toEqual(["b1"]);
    expect(cells(next, "b", "b1")[saved.inverseFieldId!]).toEqual(["a1"]);
    expect(cells(next, "a", "a2").convert).toEqual(["b2"]);
    expect(cells(next, "b", "b2")[saved.inverseFieldId!]).toEqual(["a2"]);
  });
});
