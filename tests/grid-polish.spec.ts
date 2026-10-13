import { test, expect, type Page } from "@playwright/test";
import type { View, Workspace } from "../web/types";

const timestamp = "2026-10-13T12:00:00.000Z";
const gridView = (
  id: string,
  name: string,
  patch: Partial<View> = {},
): View => ({
  id,
  name,
  type: "grid",
  filters: [],
  filterMode: "and",
  sorts: [],
  hiddenFields: [],
  rowHeight: "compact",
  ...patch,
});

function fixture(recordCount = 2): Workspace {
  return {
    version: 1,
    name: "Grid polish fixture",
    bases: [
      {
        id: "base",
        name: "Paste workspace",
        color: "#d8f3e8",
        description: "Synthetic browser test records",
        tables: [
          {
            id: "table",
            name: "Records",
            fields: [
              { id: "name", name: "Name", type: "text", width: 180 },
              { id: "hours", name: "Hours", type: "number", width: 100 },
              {
                id: "double",
                name: "Double",
                type: "formula",
                formula: "{Hours} * 2",
                width: 100,
              },
              { id: "notes", name: "Notes", type: "longText", width: 150 },
              {
                id: "status",
                name: "Status",
                type: "singleSelect",
                width: 130,
                options: [{ id: "todo", name: "To do", color: "#d8f3e8" }],
              },
            ],
            records: Array.from({ length: recordCount }, (_, index) => ({
              id: `row-${index}`,
              cells: {
                name:
                  index < 2
                    ? `Existing ${index ? "B" : "A"}`
                    : `Record ${index + 1}`,
                hours: index + 1,
                notes: "Original notes",
                status: "To do",
              },
              createdAt: timestamp,
              updatedAt: timestamp,
            })),
            views: [
              gridView("all", "All records"),
              gridView("filtered", "Filtered", {
                filters: [
                  {
                    id: "filter",
                    fieldId: "name",
                    operator: "contains",
                    value: "Existing",
                  },
                ],
              }),
              gridView("sorted", "Sorted", {
                sorts: [{ fieldId: "name", direction: "asc" }],
              }),
              gridView("grouped", "Grouped", { groupFieldId: "status" }),
              gridView("text-last", "Text last", { hiddenFields: ["status"] }),
            ],
          },
        ],
      },
    ],
  };
}

async function saved(page: Page) {
  await expect(page.locator(".save-status")).toHaveText("Saved");
}

async function snapshot(page: Page): Promise<Workspace> {
  await saved(page);
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fairtable-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const value = await new Promise<{ workspace: Workspace }>(
      (resolve, reject) => {
        const request = db
          .transaction("state")
          .objectStore("state")
          .get("workspace");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      },
    );
    db.close();
    return value.workspace;
  });
}

async function open(page: Page, workspace = fixture()) {
  await page.clock.setFixedTime(new Date(timestamp));
  await page.goto("/");
  await expect(page.getByRole("grid")).toBeVisible();
  await page.getByRole("button", { name: "Make yourself at home" }).click();
  await page
    .getByRole("button", { name: "Backup and restore", exact: true })
    .click();
  await page.locator(".backup-choice input").setInputFiles({
    name: "grid-fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(workspace)),
  });
  await page
    .getByRole("dialog", { name: "Restore this workspace?" })
    .getByRole("button", { name: "Restore backup" })
    .click();
  await saved(page);
  await page
    .getByRole("button", { name: "Open Paste workspace", exact: true })
    .click();
  await expect(page.getByRole("grid", { name: "All records" })).toBeVisible();
}

async function paste(page: Page, text: string) {
  await page.getByRole("grid").evaluate((grid, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", value);
    grid.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

async function view(page: Page, name: string) {
  await page
    .locator(".view-link")
    .getByRole("button", { name, exact: true })
    .click();
}

test("paste appends records and preserves calculations as one undoable saved edit", async ({
  page,
}) => {
  await open(page);
  const before = await snapshot(page);
  await page.getByRole("gridcell", { name: "Existing B", exact: true }).click();
  await paste(
    page,
    "Updated B\t4\tignored\nNew C\t5\tignored\nNew D\t6\tignored",
  );
  await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "5");
  await expect(page.locator(".grid-status")).toContainText("added 2 records");
  await expect(page.locator(".grid-status")).toContainText(
    "3 calculated cells preserved",
  );
  const pasted = await snapshot(page);
  const rows = pasted.bases[0].tables[0].records;
  expect(rows.map((row) => row.cells.name)).toEqual([
    "Existing A",
    "Updated B",
    "New C",
    "New D",
  ]);
  expect(rows.map((row) => row.cells.double)).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  await expect(page.locator("#grid-cell-row-1-double")).toHaveText("8");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect(await snapshot(page)).toEqual(pasted);
  await page.reload();
  await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "5");
  expect(await snapshot(page)).toEqual(pasted);
});

test("invalid appended values and the workspace limit leave the whole paste unchanged", async ({
  page,
}) => {
  await open(page);
  const before = await snapshot(page);
  await page.getByRole("gridcell", { name: "Existing B", exact: true }).click();
  await paste(page, "Changed B\t5\nInvalid new row\tnot a number");
  await expect(page.getByRole("alert")).toContainText("Nothing was pasted");
  expect(await snapshot(page)).toEqual(before);
  await page.reload();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole("gridcell", { name: "Existing B", exact: true }).click();
  // Existing two records plus 25,000 pasted rows from row two exceeds the workspace cap.
  await paste(
    page,
    Array.from({ length: 25000 }, (_, index) => `Pasted ${index + 1}`).join(
      "\n",
    ),
  );
  await expect(page.getByRole("alert")).toContainText("25,000 record limit");
  expect(await snapshot(page)).toEqual(before);
  await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "3");
});

test("view restrictions reject growth but allow pasting existing visible records", async ({
  page,
}) => {
  await open(page);
  const before = await snapshot(page);
  for (const name of ["Filtered", "Sorted", "Grouped"]) {
    await view(page, name);
    await page
      .getByRole("gridcell", { name: "Existing B", exact: true })
      .click();
    await paste(page, "Changed B\nNew row");
    await expect(page.getByRole("alert")).toContainText(
      "clear search, filters, sorting, and grouping",
    );
    expect(await snapshot(page)).toEqual(before);
  }
  await view(page, "All records");
  await page
    .getByRole("textbox", { name: "Search records" })
    .fill("Existing B");
  await page.getByRole("gridcell", { name: "Existing B", exact: true }).click();
  await paste(page, "Changed B\nNew row");
  await expect(page.getByRole("alert")).toContainText(
    "clear search, filters, sorting, and grouping",
  );
  expect(await snapshot(page)).toEqual(before);
  await paste(page, "Existing B revised");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("gridcell", { name: "Existing B revised", exact: true }),
  ).toBeVisible();
  const after = await snapshot(page);
  expect(after.bases[0].tables[0].records).toHaveLength(2);
  expect(after.bases[0].tables[0].records[1].cells.name).toBe(
    "Existing B revised",
  );
});

test("Tab exits grid boundaries, including text and picker editors", async ({
  page,
}) => {
  await open(page);
  const first = page.getByRole("gridcell", { name: "Existing A", exact: true });
  const beforeGrid = page.locator('summary[aria-label="Table actions"]');
  const afterGrid = page.getByRole("button", {
    name: "Add field",
    exact: true,
  });
  await first.click();
  await page.keyboard.press("Shift+Tab");
  await expect(beforeGrid).toBeFocused();
  await first.dblclick();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Updated first");
  await page.keyboard.press("Shift+Tab");
  await expect(beforeGrid).toBeFocused();
  await expect(
    page.getByRole("gridcell", { name: "Updated first", exact: true }),
  ).toBeVisible();
  const grid = page.getByRole("grid");
  await grid.focus();
  await grid.press("ControlOrMeta+End");
  await grid.press("Tab");
  await expect(afterGrid).toBeFocused();
  await grid.focus();
  await grid.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Search Status" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(afterGrid).toBeFocused();
  await expect(
    page.getByRole("textbox", { name: "Search Status" }),
  ).toHaveCount(0);
  await view(page, "Text last");
  await grid.focus();
  await grid.press("ControlOrMeta+End");
  await grid.press("Enter");
  await page
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill("Last edited notes");
  await page.keyboard.press("Tab");
  await expect(afterGrid).toBeFocused();
  expect((await snapshot(page)).bases[0].tables[0].records[1].cells.notes).toBe(
    "Last edited notes",
  );
  // Interior Tab still moves between cells and wraps to the next record.
  await grid.focus();
  await grid.press("ControlOrMeta+Home");
  await grid.press("Tab");
  await expect(grid).toHaveAttribute(
    "aria-activedescendant",
    "grid-cell-row-0-hours",
  );
  await grid.press("End");
  await grid.press("Tab");
  await expect(grid).toHaveAttribute(
    "aria-activedescendant",
    "grid-cell-row-1-name",
  );
});
