import { test, expect, type Page } from "@playwright/test";

async function openRecord(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Make yourself at home" }).click();
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  return page.getByRole("dialog");
}

test("picker buttons keep their keyboard meaning and are reachable with Tab", async ({
  page,
}) => {
  const record = await openRecord(page);
  await record
    .getByRole("button", { name: "Choose Project", exact: true })
    .click();
  const picker = page.locator(".cell-picker");
  await picker.getByRole("textbox", { name: "Search Project" }).press("Tab");
  await expect(picker.getByRole("option").first()).toBeFocused();
  for (let i = 0; i < (await picker.getByRole("option").count()); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(
    picker.getByRole("button", { name: "Clear", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    picker.getByRole("button", { name: "Done", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(picker).not.toBeVisible();
  await expect(
    record.getByRole("button", { name: "Choose Project", exact: true }),
  ).toContainText("Autumn launch");

  await record
    .getByRole("button", { name: "Choose Project", exact: true })
    .click();
  await picker
    .getByRole("button", { name: "Clear", exact: true })
    .press("Enter");
  await expect(
    record.getByRole("button", { name: "Choose Project", exact: true }),
  ).toContainText("Choose records");
  await picker
    .getByRole("button", { name: "Done", exact: true })
    .press("Enter");
  await record
    .getByRole("button", { name: "Choose Status", exact: true })
    .click();
  await picker
    .getByRole("button", { name: "Clear", exact: true })
    .press("Enter");
  await expect(picker).not.toBeVisible();
  await expect(
    record.getByRole("button", { name: "Choose Status", exact: true }),
  ).toContainText("Choose an option");
  await record.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  await expect(
    record.getByRole("button", { name: "Choose Project", exact: true }),
  ).toContainText("Choose records");
  await expect(
    record.getByRole("button", { name: "Choose Status", exact: true }),
  ).toContainText("Choose an option");
});

test("canceling an invalid numeric draft restores a usable editor", async ({
  page,
}) => {
  const record = await openRecord(page);
  const hours = record.getByRole("textbox", { name: "Hours", exact: true });
  await hours.fill("not a number");
  await hours.press("Tab");
  await expect(hours).toHaveAttribute("aria-invalid", "true");
  await expect(record.getByRole("alert")).toContainText("not a number");
  await hours.press("Escape");
  await expect(hours).toHaveValue("3");
  await expect(hours).toHaveAttribute("aria-invalid", "false");
  await hours.fill("12.5");
  await hours.press("Tab");
  await record.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".save-status")).toHaveText("Saved");
  await page.reload();
  await page
    .getByRole("button", { name: "Expand record 1", exact: true })
    .click();
  await expect(hours).toHaveValue("12.5");
});
