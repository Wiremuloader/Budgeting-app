import { expect, type Page } from "@playwright/test";

/** Test-only password for throwaway accounts created against the local e2e database. */
export const E2E_PASSWORD = "e2e-password-12345";

export function uniqueEmail(prefix = "user") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@ledger.test`;
}

export async function signUp(page: Page, name = "Test Person") {
  const email = uniqueEmail();
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/onboarding");
  return email;
}

/** Sign up and skip onboarding, then add one everyday account. */
export async function signUpWithAccount(page: Page, balance = "1500") {
  const email = await signUp(page);
  await page.getByRole("button", { name: "Skip setup for now" }).click();
  await page.waitForURL("**/overview");
  await page.goto("/accounts?new=1");
  await page.getByLabel("Account name").fill("Everyday");
  await page.getByLabel("Current balance").fill(balance);
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Account added")).toBeVisible();
  return email;
}
