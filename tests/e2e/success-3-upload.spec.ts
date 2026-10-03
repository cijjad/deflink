import { expect, test } from "@playwright/test";
import ExcelJS from "exceljs";
import { waitHydrated } from "./helpers";

async function makeWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Requirement");
  ws.addRow(["Part Number", "Description", "Qty", "UOM"]);
  const exact = ["ABC123", "HP-4521", "FLT-200-10", "FLT-300-25", "LF-AIR-900", "LF-FUEL-45", "BRG-6205-DMO", "BRG-6308-DMO", "BRG-22210-DMO", "KM-GBX-40", "KM-BLT-1200", "MFP-CYL-63", "MFP-HOSE-12", "MFP-SV-24", "NS-ORK-112", "NS-SEAL-75", "OA-SNS-310"];
  exact.forEach((pn, i) => ws.addRow([pn, "", i + 1, "EA"]));
  ws.addRow(["OA-CON-29", "Connector", 4, "EA"]); // typo of OA-CON-28
  ws.addRow(["NS-GSK-405", "Gasket", 2, "EA"]); // typo of NS-GSK-450
  ws.addRow(["QQQ-0000-ZZ", "Widget", 1, "EA"]); // unknown
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("success test 3: Excel with 20 lines, correct two without restarting", async ({ page }) => {
  await page.goto("/");
  await waitHydrated(page);
  await page.getByTestId("file-input").setInputFiles({ name: "requirement.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await makeWorkbook() });
  await expect(page.getByText("I found 20 items: 17 identified exactly, 2 need confirmation and 1 could not be identified.")).toBeVisible();
  await expect(page.getByTestId("line-row")).toHaveCount(20);
  await expect(page.getByTestId("actions").getByRole("button", { name: "Review" })).toBeVisible();
  await expect(page.getByTestId("actions").getByRole("button", { name: "Create RFQ" })).toBeVisible();

  // Fix one by choosing the suggested candidate, the other by editing the part number.
  await page.getByRole("button", { name: "Use OA-CON-28" }).click();
  await expect(page.getByText(/Line 18 set to OA-CON-28/)).toBeVisible();
  await expect(page.getByText(/2 items still need attention/)).toBeVisible();

  const table = page.getByTestId("lines").last();
  await table.getByTestId("edit-lines").click();
  await table.getByLabel("Part number line 19").fill("NS-GSK-450");
  await table.getByRole("button", { name: "Save changes" }).click();
  const latest = page.getByTestId("lines").last();
  await expect(latest.getByTestId("line-row").nth(18)).toContainText("Exact match");
  await expect(latest.getByTestId("line-row").nth(17)).toContainText("Exact match");
  await expect(latest.getByTestId("line-row")).toHaveCount(20);
});
