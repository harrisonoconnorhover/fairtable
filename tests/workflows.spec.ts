import { test, expect, type Page } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-13T12:00:00Z"));
});
async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("grid")).toBeVisible();
  await page.getByRole("button", { name: "Make yourself at home" }).click();
}
async function saved(page: Page) {
  await expect(page.locator(".save-status")).toHaveText("Saved");
}
async function snapshot(page: Page) {
  await saved(page);
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("fairtable-v1", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const value = await new Promise<any>((resolve, reject) => {
      const r = db.transaction("state").objectStore("state").get("workspace");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return value.workspace;
  });
}
async function view(page: Page, name: string) {
  await page
    .locator(".view-link")
    .getByRole("button", { name, exact: true })
    .click();
}

test("edits persist, undo/redo works, view filters and CSV export match", async ({
  page,
}) => {
  await open(page);
  const first = page.getByRole("gridcell").first();
  await first.dblclick();
  await page
    .getByRole("textbox", { name: "Task", exact: true })
    .fill("Ship Fairtable");
  await page.getByRole("textbox", { name: "Task", exact: true }).press("Enter");
  await saved(page);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(first).toHaveText("Finalize the launch brief");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(first).toHaveText("Ship Fairtable");
  await saved(page);
  await page.reload();
  await expect(page.getByRole("gridcell").first()).toHaveText("Ship Fairtable");
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "Add condition" }).click();
  await page
    .getByRole("textbox", { name: "Filter 1 value" })
    .fill("Ship Fairtable");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "2");
  await page.locator('summary[aria-label="Table actions"]').click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export this view as CSV" }).click();
  const file = await download;
  const stream = await file.createReadStream();
  let csv = "";
  for await (const chunk of stream!) csv += chunk;
  expect(csv).toContain("Ship Fairtable");
  expect(csv).not.toContain("Build the product story");
  await saved(page);
  await page.reload();
  await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "2");
});

test("links recalculate lookups and rollups, both directions survive reload", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  const record = page.getByRole("dialog");
  await record.getByRole("textbox", { name: "Hours", exact: true }).fill("10");
  await record
    .getByRole("textbox", { name: "Hours", exact: true })
    .press("Tab");
  await record
    .getByRole("button", { name: "Choose Project", exact: true })
    .click();
  await record
    .getByRole("option", { name: "Autumn launch", exact: true })
    .click();
  await record
    .getByRole("option", { name: "Website refresh", exact: true })
    .click();
  await record
    .getByRole("button", { name: "Done", exact: true })
    .last()
    .click();
  if (await record.isVisible())
    await record
      .getByRole("button", { name: "Done", exact: true })
      .last()
      .click();
  await saved(page);
  const doc = await snapshot(page);
  const [tasks, projects] = doc.bases[0].tables;
  const projectLink = tasks.fields.find((f: any) => f.name === "Project"),
    backLink = projects.fields.find((f: any) => f.type === "link");
  const website = projects.records.find(
    (r: any) => r.cells[projects.fields[0].id] === "Website refresh",
  );
  const autumn = projects.records.find(
    (r: any) => r.cells[projects.fields[0].id] === "Autumn launch",
  );
  expect(tasks.records[0].cells[projectLink.id]).toEqual([website.id]);
  expect(website.cells[backLink.id]).toContain(tasks.records[0].id);
  expect(autumn.cells[backLink.id]).not.toContain(tasks.records[0].id);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page
    .getByRole("button", { name: "Expand record 3", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").locator(".calculated-value"),
  ).not.toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await saved(page);
  await page.reload();
  expect(
    (await snapshot(page)).bases[0].tables[0].records[0].cells[projectLink.id],
  ).toEqual([website.id]);
});

test("board, calendar, gallery, personal form, and view renaming", async ({
  page,
}) => {
  await open(page);
  await view(page, "By status");
  const card = page
    .locator(".record-card")
    .filter({ hasText: "Finalize the launch brief" });
  await card.dragTo(
    page.locator(".board-column").filter({
      has: page.getByRole("heading", { name: "In progress", exact: true }),
    }),
  );
  await expect(
    page
      .locator(".board-column")
      .filter({
        has: page.getByRole("heading", { name: "In progress", exact: true }),
      })
      .getByText("Finalize the launch brief"),
  ).toBeVisible();
  await view(page, "Calendar");
  await expect(page.locator(".calendar-day")).toHaveCount(42);
  const calendarCard = page.getByRole("button", {
    name: "Finalize the launch brief",
    exact: true,
  });
  const target = page.locator(".calendar-day").filter({
    has: page.getByRole("button", {
      name: "Add record on 2026-10-20",
      exact: true,
    }),
  });
  await calendarCard.dragTo(target, { targetPosition: { x: 25, y: 45 } });
  await expect(target.getByText("Finalize the launch brief")).toBeVisible();
  await view(page, "Gallery");
  await expect(page.locator(".record-card")).toHaveCount(20);
  await view(page, "New task");
  await page
    .getByRole("textbox", { name: "Task", exact: true })
    .fill("Created through form");
  await page.getByRole("textbox", { name: "Task", exact: true }).press("Tab");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Record added" }),
  ).toBeVisible();
  await view(page, "All tasks");
  await page
    .getByRole("textbox", { name: "Search records" })
    .fill("Created through form");
  await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "2");
  await page.locator('summary[aria-label="Table actions"]').click();
  await page.getByRole("button", { name: "Rename table…" }).click();
  await page.getByRole("textbox", { name: "Table name" }).fill("Launch tasks");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Tables" })
      .getByRole("button", { name: "Launch tasks" }),
  ).toBeVisible();
  expect((await snapshot(page)).bases[0].tables).toHaveLength(2);
});

test("CSV preview keeps identifiers, type errors are atomic, full backup restores", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator(".file-drop input").setInputFiles({
    name: "Contacts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Name,ZIP,Hours\nAlice,00123,3\nBob,00456,bad\n"),
  });
  await page.getByLabel("Type for Hours").selectOption("number");
  await page.getByRole("button", { name: "Import table", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not a number");
  expect((await snapshot(page)).bases[0].tables).toHaveLength(2);
  await page.getByLabel("Type for Hours").selectOption("text");
  await page.getByRole("button", { name: "Import table", exact: true }).click();
  await expect(
    page.getByRole("gridcell", { name: "00123", exact: true }),
  ).toBeVisible();
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "Backup", exact: true }).click();
  const file = await wait,
    stream = await file.createReadStream();
  let backup = "";
  for await (const chunk of stream!) backup += chunk;
  expect(JSON.parse(backup).bases[0].tables).toHaveLength(3);
  await page.getByRole("gridcell", { name: "Alice", exact: true }).dblclick();
  await page
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("Changed");
  await page.getByRole("textbox", { name: "Name", exact: true }).press("Enter");
  await saved(page);
  await page
    .getByRole("button", { name: "Backup and restore", exact: true })
    .click();
  await page.locator(".backup-choice input").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });
  await page
    .getByRole("dialog", { name: "Restore this workspace?" })
    .getByRole("button", { name: "Restore backup" })
    .click();
  await saved(page);
  expect(
    (await snapshot(page)).bases[0].tables[2].records[0].cells[
      JSON.parse(backup).bases[0].tables[2].fields[0].id
    ],
  ).toBe("Alice");
});

test("mobile navigation, modal, and cell editing remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await expect(page.getByRole("grid")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Toggle views" }).click();
  await view(page, "By status");
  await expect(page.locator(".board")).toBeVisible();
  await page.getByRole("button", { name: "Toggle views" }).click();
  await view(page, "All tasks");
  await page.getByRole("gridcell").first().dblclick();
  await page
    .getByRole("textbox", { name: "Task", exact: true })
    .fill("Mobile edit");
  await page.getByRole("textbox", { name: "Task", exact: true }).press("Enter");
  await saved(page);
  await page.screenshot({ path: "artifacts/mobile.png" });
  await page
    .getByRole("button", { name: "Help and keyboard shortcuts" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .getByRole("dialog")
      .evaluate((el) => el.getBoundingClientRect().right),
  ).toBeLessThanOrEqual(390);
});

test("fields calculate, rename safely, and remain configured after reopening", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Add field", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Field name", exact: true })
    .fill("Estimate");
  await page.getByLabel("Field type", { exact: true }).selectOption("formula");
  await page
    .getByRole("textbox", { name: "Formula", exact: true })
    .fill("{Hours} * 100");
  await page.getByRole("button", { name: "Create field", exact: true }).click();
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  const detail = page.getByRole("dialog");
  await expect(
    detail
      .getByRole("group", { name: "Estimate", exact: true })
      .locator(".calculated-value"),
  ).toHaveText("300");
  await detail.getByRole("textbox", { name: "Hours", exact: true }).fill("7");
  await detail
    .getByRole("textbox", { name: "Hours", exact: true })
    .press("Tab");
  await expect(
    detail
      .getByRole("group", { name: "Estimate", exact: true })
      .locator(".calculated-value"),
  ).toHaveText("700");
  await detail.getByRole("button", { name: "Done", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit Hours field", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Field name", exact: true })
    .fill("Effort");
  await page.getByRole("button", { name: "Save field", exact: true }).click();
  let doc = await snapshot(page);
  expect(
    doc.bases[0].tables[0].fields.find((f: any) => f.name === "Estimate")
      .formula,
  ).toBe("{Effort} * 100");
  await page.getByRole("button", { name: "Hide fields", exact: true }).click();
  await page.getByLabel("Notes", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Edit Notes field", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("group", { name: "Estimate", exact: true })
      .locator(".calculated-value"),
  ).toHaveText("700");
});

test("10,000 by 30 CSV stays virtualized and editable with durable reload", async ({
  page,
}) => {
  test.setTimeout(90000);
  await open(page);
  const headers = Array.from({ length: 30 }, (_, i) =>
    i === 0 ? "Record" : `Column ${i + 1}`,
  );
  const csv = [
    headers.join(","),
    ...Array.from({ length: 10000 }, (_, r) =>
      Array.from({ length: 30 }, (_, c) =>
        c === 0 ? `Record ${r + 1}` : `value ${r}-${c}`,
      ).join(","),
    ),
  ].join("\n");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator(".file-drop input").setInputFiles({
    name: "Large.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Import table", exact: true }).click();
  await expect(page.getByRole("grid")).toHaveAttribute(
    "aria-rowcount",
    "10001",
    { timeout: 30000 },
  );
  await saved(page);
  expect(await page.locator(".grid-row").count()).toBeLessThan(100);
  await page
    .getByRole("textbox", { name: "Search records" })
    .fill("Record 10000");
  await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "2");
  await page.getByRole("gridcell").first().dblclick();
  await page
    .getByRole("textbox", { name: "Record", exact: true })
    .fill("Final record updated");
  await page
    .getByRole("textbox", { name: "Record", exact: true })
    .press("Enter");
  await saved(page);
  await page
    .getByRole("textbox", { name: "Search records" })
    .fill("Final record updated");
  await expect(page.getByRole("gridcell").first()).toHaveText(
    "Final record updated",
  );
  await page.reload();
  await page
    .getByRole("textbox", { name: "Search records" })
    .fill("Final record updated");
  await expect(page.getByRole("gridcell").first()).toHaveText(
    "Final record updated",
  );
});

test("calculated primary names display in links without persisting derived cells", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit Project field", exact: true })
    .click();
  await page.getByLabel("Field type", { exact: true }).selectOption("formula");
  await page
    .getByRole("textbox", { name: "Formula", exact: true })
    .fill('"Calculated project"');
  await page.getByRole("button", { name: "Save field", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Tables" })
    .getByRole("button", { name: "Tasks", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Choose Project" }),
  ).toContainText("Calculated project");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Choose Project" })
    .click();
  await expect(
    page.getByRole("option", { name: "Calculated project", exact: true }),
  ).toHaveCount(3);
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  const doc = await snapshot(page),
    projects = doc.bases[0].tables[1];
  expect(projects.records[0].cells[projects.fields[0].id]).toBeUndefined();
  await page.reload();
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Choose Project" }),
  ).toContainText("Calculated project");
});
