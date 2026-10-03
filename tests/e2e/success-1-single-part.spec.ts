import { expect, test } from "@playwright/test";
import { login, newSignedInPage, say, waitHydrated } from "./helpers";

test("success test 1: part → quote → supplier response → negotiation → comparison", async ({ page, browser }) => {
  /* --- Visitor: no registration wall for searching --- */
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What do you need?" })).toBeVisible();
  await waitHydrated(page);
  await say(page, "I need 25 units of Part ABC123.");
  await expect(page.getByText(/I found .*ABC123/)).toBeVisible();
  await expect(page.getByTestId("results").getByText("XYZ Demo Industries").first()).toBeVisible();
  await expect(page.getByText("New only?")).toBeVisible();

  await page.getByTestId("actions").getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByText("Where should it be delivered?")).toBeVisible();
  await say(page, "Islamabad, Pakistan.");
  const card = page.getByTestId("requirement-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("ABC123");
  await expect(card).toContainText("25 units");
  await expect(card).toContainText("New");
  await expect(card).toContainText("Islamabad, Pakistan");

  /* --- GET QUOTES requires sign-in; the requirement survives it --- */
  await page.getByTestId("actions").getByRole("button", { name: "Get quotes" }).click();
  await page.waitForURL(/\/login/);
  await expect(page.getByText(/Your requirement is saved/)).toBeVisible();
  await login(page, "buyer@demo.test");
  const created = page.getByText(/RFQ-\d+ created and sent to \d+ matched supplier/);
  await expect(created).toBeVisible({ timeout: 30_000 });
  const ref = (await created.textContent())!.match(/RFQ-\d+/)![0];

  /* --- Supplier receives the RFQ (buyer identity withheld) and quotes --- */
  const alpha = await newSignedInPage(browser, "alpha@supplier.demo.test", "/supplier");
  await alpha.getByTestId("supplier-rfq-row").filter({ hasText: ref }).click();
  await expect(alpha.getByRole("heading", { name: ref })).toBeVisible();
  await expect(alpha.getByText(/Buyer organization · Pakistan/)).toBeVisible();
  await expect(alpha.getByText("Demo Buyer Organization")).toHaveCount(0);
  await alpha.getByTestId("unit-price").fill("4700");
  await alpha.getByTestId("lead-time").fill("7");
  await alpha.getByLabel("Certification").fill("CoC");
  await alpha.getByTestId("submit-quote").click();
  await expect(alpha.getByTestId("quote-done")).toContainText("Quotation submitted");

  const bravo = await newSignedInPage(browser, "bravo@supplier.demo.test", "/supplier");
  await bravo.getByTestId("supplier-rfq-row").filter({ hasText: ref }).click();
  await bravo.getByTestId("unit-price").fill("4850");
  await bravo.getByTestId("lead-time").fill("5");
  await bravo.getByTestId("submit-quote").click();
  await expect(bravo.getByTestId("quote-done")).toBeVisible();

  /* --- Buyer is notified and opens the quotation --- */
  await page.goto("/requests");
  await expect(page.getByTestId("notification-count")).toBeVisible({ timeout: 30_000 });
  const row = page.getByTestId("rfq-row").filter({ hasText: ref }).first();
  await expect(row).toContainText("2 quotations received");
  await row.click();
  const alphaQuote = page.getByTestId("quote-card").filter({ hasText: "Alpha Demo Industrial Supply" });
  await expect(alphaQuote).toContainText("USD 4,700");
  await alphaQuote.getByTestId("view-quote").click();
  await expect(alphaQuote).toContainText("Payment terms");

  /* --- Buyer asks; supplier answers and revises --- */
  await alphaQuote.getByTestId("ask-supplier").click();
  await alphaQuote.getByTestId("thread-input").fill("Can you supply 100 instead of 25?");
  await alphaQuote.getByRole("button", { name: "Send" }).click();
  await expect(alphaQuote.getByTestId("thread-message").filter({ hasText: "Can you supply 100 instead of 25?" })).toBeVisible();

  await alpha.reload();
  const supplierThread = alpha.getByTestId("thread");
  await expect(supplierThread.getByText("Can you supply 100 instead of 25?")).toBeVisible();
  await supplierThread.getByTestId("thread-input").fill("Yes — 100 available. Revised quotation sent.");
  await supplierThread.getByRole("button", { name: "Send" }).click();
  await expect(supplierThread.getByTestId("thread-message").filter({ hasText: "Revised quotation sent" })).toBeVisible();
  await alpha.getByTestId("unit-price").fill("4600");
  await alpha.getByTestId("revision-note").fill("Volume price for 100 units");
  await alpha.getByTestId("submit-quote").click();
  await expect(alpha.getByTestId("quote-done")).toContainText("Revision 2 submitted");

  await page.reload();
  const updated = page.getByTestId("quote-card").filter({ hasText: "Alpha Demo Industrial Supply" });
  await expect(updated).toContainText("Updated · rev 2");
  await expect(updated).toContainText("USD 4,600");
  await updated.getByTestId("ask-supplier").click();
  await expect(updated.getByText("Yes — 100 available. Revised quotation sent.")).toBeVisible();
  await expect(updated.getByText(/Updated quotation \(revision 2\)/)).toBeVisible();

  /* --- Objective comparison, no recommendation --- */
  await page.getByRole("tab", { name: "Compare" }).click();
  const compare = page.getByTestId("compare");
  await expect(compare).toContainText("USD 4,600");
  await expect(compare).toContainText("USD 4,850");
  await expect(compare).toContainText("does not recommend a supplier");
});
