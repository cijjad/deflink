import { expect, type Browser, type Page } from "@playwright/test";

export const PASSWORD = process.env.SEED_PASSWORD ?? "DemoPass2026!";

export async function login(page: Page, email: string) {
  await page.getByLabel("Business e-mail").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function newSignedInPage(browser: Browser, email: string, path = "/") {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/login?next=${encodeURIComponent(path)}`);
  await login(page, email);
  await page.waitForURL((u) => u.pathname === path.split("?")[0]);
  return page;
}

export async function say(page: Page, text: string) {
  const input = page.getByTestId("chat-input");
  await input.fill(text);
  await input.press("Enter");
}

export async function waitHydrated(page: Page) {
  // The send button is disabled until there is text; typing proves React handlers are attached.
  await page.getByTestId("chat-input").fill("x");
  await expect(page.getByTestId("send")).toBeEnabled();
  await page.getByTestId("chat-input").fill("");
}
