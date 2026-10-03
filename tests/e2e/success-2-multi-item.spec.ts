import { expect, test } from "@playwright/test";
import { say, waitHydrated } from "./helpers";

test("success test 2: three items in one sentence", async ({ page }) => {
  await page.goto("/");
  await waitHydrated(page);
  await say(page, "I need 50 bearings, 20 filters and 10 pumps.");
  const rows = page.getByTestId("line-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Bearing");
  await expect(rows.nth(0)).toContainText("50 units");
  await expect(rows.nth(1)).toContainText("Filter");
  await expect(rows.nth(1)).toContainText("20 units");
  await expect(rows.nth(2)).toContainText("Pump");
  await expect(rows.nth(2)).toContainText("10 units");
  for (let i = 0; i < 3; i++) await expect(rows.nth(i)).toContainText("Identified");
  await expect(page.getByTestId("actions").getByRole("button", { name: "Create RFQ" })).toBeVisible();

  // Creating the RFQ asks only for what is still missing.
  await page.getByTestId("actions").getByRole("button", { name: "Create RFQ" }).click();
  await expect(page.getByText("New only?")).toBeVisible();
});
