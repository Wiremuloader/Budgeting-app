import { expect, test } from "@playwright/test";
import { signUpWithAccount } from "./helpers";

test("mobile layout uses the bottom navigation", async ({ page }) => {
  await signUpWithAccount(page, "800");
  await page.goto("/overview");
  const bottom = page.getByRole("navigation", { name: "Main navigation" }).last();
  await expect(bottom).toBeVisible();
  await expect(page.locator("aside[aria-label='Main navigation']")).toBeHidden();

  await bottom.getByRole("link", { name: "Budget" }).click();
  await expect(page).toHaveURL(/\/budget/);

  await bottom.getByRole("button", { name: "More destinations" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Savings goals" }).click();
  await expect(page).toHaveURL(/\/goals/);

  await bottom.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByRole("dialog", { name: "Add transaction" })).toBeVisible();

  // No horizontal page scroll at phone width
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
