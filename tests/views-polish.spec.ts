import { test, expect, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-13T12:00:00Z"));
  await page.goto("/");
  await expect(page.getByRole("grid")).toBeVisible();
  await page.getByRole("button", { name: "Make yourself at home" }).click();
});

async function view(page: Page, name: string) {
  await page
    .locator(".view-link")
    .getByRole("button", { name, exact: true })
    .click();
}

async function saved(page: Page) {
  await expect(page.locator(".save-status")).toHaveText("Saved");
}

test("kanban separates an Unassigned option from genuinely empty values", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Edit Status field", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Option 1", exact: true })
    .fill("Unassigned");
  await page.getByRole("button", { name: "Save field", exact: true }).click();
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  const record = page.getByRole("dialog");
  await record
    .getByRole("button", { name: "Choose Status", exact: true })
    .click();
  await record.getByRole("button", { name: "Clear", exact: true }).click();
  await record.getByRole("button", { name: "Done", exact: true }).click();
  await view(page, "By status");

  const column = (name: string) =>
    page.locator(".board-column").filter({
      has: page.getByRole("heading", { name, exact: true }),
    });
  const empty = column("No Status");
  const unassigned = column("Unassigned");
  await expect(page.locator(".record-card")).toHaveCount(20);
  await expect(empty.locator(".record-card")).toHaveCount(1);
  await expect(unassigned.locator(".record-card")).toHaveCount(6);
  await expect(empty).toContainText("Finalize the launch brief");
  await expect(unassigned).not.toContainText("Finalize the launch brief");

  await unassigned.locator(".record-card").first().dragTo(empty);
  await expect(empty.locator(".record-card")).toHaveCount(2);
  await expect(unassigned.locator(".record-card")).toHaveCount(5);
  await saved(page);
  await page.reload();
  await expect(empty.locator(".record-card")).toHaveCount(2);
  await expect(unassigned.locator(".record-card")).toHaveCount(5);
  await expect(page.locator(".record-card")).toHaveCount(20);
});

test("undated records can be dragged onto the calendar and keep their date", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  const record = page.getByRole("dialog");
  await record.getByRole("textbox", { name: "Due date", exact: true }).fill("");
  await record
    .getByRole("textbox", { name: "Due date", exact: true })
    .press("Tab");
  await record.getByRole("button", { name: "Done", exact: true }).click();
  await view(page, "Calendar");

  const undated = page.locator(".unscheduled");
  await undated.locator("summary").click();
  await expect(undated).toContainText(
    "Drag a record onto a day to schedule it",
  );
  const card = undated.getByRole("button", {
    name: "Finalize the launch brief",
    exact: true,
  });
  await expect(card).toHaveAttribute("draggable", "true");
  const target = page.locator(".calendar-day").filter({
    has: page.getByRole("button", {
      name: "Add record on 2026-10-20",
      exact: true,
    }),
  });
  await card.dragTo(target, { targetPosition: { x: 25, y: 45 } });
  await expect(
    target.getByRole("button", {
      name: "Finalize the launch brief",
      exact: true,
    }),
  ).toBeVisible();
  await expect(undated.locator("summary")).toHaveText(
    "0 records without a date",
  );
  await saved(page);
  await page.reload();
  await expect(
    target.getByRole("button", {
      name: "Finalize the launch brief",
      exact: true,
    }),
  ).toBeVisible();
  await target
    .getByRole("button", { name: "Finalize the launch brief", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Due date", exact: true }),
  ).toHaveValue("2026-10-20");
});

test("personal forms reject an invalid optional number without adding a record", async ({
  page,
}) => {
  await view(page, "New task");
  await page
    .getByRole("textbox", { name: "Task", exact: true })
    .fill("Form number validation");
  const hours = page.getByRole("textbox", { name: "Hours", exact: true });
  await hours.fill("abc");
  await hours.press("Tab");
  await expect(hours).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Record added" }),
  ).not.toBeVisible();
  await expect(hours).toHaveValue("abc");
  await expect(hours).toBeFocused();
  await expect
    .poll(() =>
      hours.evaluate((input: HTMLInputElement) => input.validity.valid),
    )
    .toBe(false);
  await expect(page.locator(".table-bottom")).toContainText("20 of 20 records");
  await hours.fill("12.5");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Record added" }),
  ).toBeVisible();
  await expect(page.locator(".table-bottom")).toContainText("21 of 21 records");
  await saved(page);
  await page.reload();
  await view(page, "All tasks");
  await page
    .getByRole("textbox", { name: "Search records", exact: true })
    .fill("Form number validation");
  await expect(page.getByRole("grid")).toHaveAttribute("aria-rowcount", "2");
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("textbox", { name: "Hours", exact: true }),
  ).toHaveValue("12.5");
});
