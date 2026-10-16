import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, signUp, signUpWithAccount } from "./helpers";

test("protected pages redirect to sign in", async ({ page }) => {
  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Ftransactions/);
  const res = await page.request.get("/api/export/transactions");
  expect(res.status()).toBe(401);
});

test("sign up, complete onboarding and see a starter budget", async ({ page }) => {
  await signUp(page, "Mere Tane");
  await expect(page.getByRole("heading", { name: /Kia ora Mere/ })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click(); // Region

  // Income
  await page.getByLabel("Source").fill("Salary");
  await page.getByLabel("Amount each time").fill("2000");
  await page.getByRole("button", { name: "Continue" }).click();

  // Accounts
  await page.getByLabel("Balance", { exact: true }).fill("1200");
  await page.getByRole("button", { name: "Continue" }).click();

  // Bills: rent is preselected
  await page.getByLabel("Rent or mortgage amount").fill("450");
  await page.getByLabel("Power amount").fill("160");
  await page.getByRole("button", { name: "Continue" }).click();

  // Spending, debts, goals, style → defaults
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Your starter budget" })).toBeVisible();
  await expect(page.getByText("Left unassigned")).toBeVisible();
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.waitForURL("**/overview");
  await expect(page.getByText("Safe to spend", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Cash in your accounts")).toBeVisible();

  await page.goto("/budget");
  await expect(page.getByRole("row", { name: /Housing/ })).toBeVisible();
  await page.goto("/recurring?tab=rules");
  await expect(page.getByText("Salary").first()).toBeVisible();
  await expect(page.getByText("Rent or mortgage").first()).toBeVisible();
});

test("add, edit, split and delete transactions; balances follow", async ({ page }) => {
  await signUpWithAccount(page, "1500");
  await page.goto("/transactions");

  // Add an expense
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount").fill("42.50");
  await dialog.getByLabel("Payee").fill("Countdown");
  await dialog.getByLabel("Category", { exact: true }).selectOption({ label: "Groceries" });
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByText("Transaction added")).toBeVisible();
  await expect(page.getByRole("row", { name: /Countdown/ })).toContainText("-$42.50");

  // A refund in the same category
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  await dialog.getByLabel("Amount").fill("10");
  await dialog.getByLabel("Payee").fill("Countdown refund");
  await dialog.getByLabel("Category", { exact: true }).selectOption({ label: "Groceries" });
  await dialog.getByText("This is a refund").click();
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByRole("row", { name: /Countdown refund/ })).toContainText("+$10.00");

  // Split purchase
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  await dialog.getByLabel("Amount").fill("100");
  await dialog.getByLabel("Payee").fill("The Warehouse");
  await dialog.getByRole("button", { name: "Split" }).click();
  await dialog.getByLabel("Split 1 category").selectOption({ label: "Groceries" });
  await dialog.getByLabel("Split 2 category").selectOption({ label: "Shopping" });
  const amounts = dialog.locator('input[inputmode="decimal"]');
  await amounts.nth(1).fill("60");
  await amounts.nth(2).fill("40");
  await expect(dialog.getByText("Balanced")).toBeVisible();
  await dialog.getByRole("button", { name: "Add transaction" }).click();
  await expect(page.getByRole("row", { name: /The Warehouse/ })).toContainText("Split · 2 categories");

  // Account balance reflects everything: 1500 − 42.50 + 10 − 100
  await page.goto("/accounts");
  await expect(page.getByText("$1,367.50").first()).toBeVisible();

  // Edit the expense amount
  await page.goto("/transactions?q=Countdown");
  await page.getByRole("button", { name: /^Countdown$/ }).click();
  await dialog.getByLabel("Amount").fill("50");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Transaction updated")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Countdown" }).filter({ hasNotText: "refund" })).toContainText("-$50.00");

  // Delete it
  await page.getByRole("button", { name: "Actions for Countdown", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete" }).last().click();
  await expect(page.getByText("Deleted")).toBeVisible();
  await page.goto("/accounts");
  await expect(page.getByText("$1,410.00").first()).toBeVisible();
});

test("transfers are not spending", async ({ page }) => {
  await signUpWithAccount(page, "1000");
  await page.goto("/accounts?new=1");
  await page.getByLabel("Account name").fill("Visa");
  await page.getByLabel("Type").selectOption("credit_card");
  await page.getByLabel("Amount currently owed").fill("300");
  await page.getByRole("button", { name: "Add account" }).last().click();
  await expect(page.getByText("Account added")).toBeVisible();

  await page.goto("/transactions");
  await page.getByRole("button", { name: "Add transaction" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: "Transfer" }).click();
  await dialog.getByLabel("Amount").fill("300");
  await dialog.getByLabel("From").selectOption({ label: "Everyday" });
  await dialog.getByLabel("To").selectOption({ label: "Visa" });
  await dialog.getByRole("button", { name: "Record transfer" }).click();
  await expect(page.getByText("Transfer recorded")).toBeVisible();

  await page.goto("/overview");
  const summary = page.locator("section[aria-label='Your money right now']");
  await expect(summary.getByText("Spent")).toBeVisible();
  await expect(summary.locator("dd").nth(1)).toContainText("$0.00");
  await page.goto("/accounts");
  await expect(page.getByText("$700.00").first()).toBeVisible(); // everyday after paying the card
});

test("CSV import is previewed, idempotent and undoable", async ({ page }) => {
  await signUpWithAccount(page, "500");
  await page.goto("/transactions/import");
  await page.setInputFiles("#imp-file", path.join(__dirname, "fixtures", "anz-sample.csv"));
  await expect(page.getByText(/5 new/)).toBeVisible();
  await page.getByRole("button", { name: /Import 5 transactions/ }).click();
  await expect(page.getByText("Imported 5 transactions").first()).toBeVisible();

  await page.setInputFiles("#imp-file", path.join(__dirname, "fixtures", "anz-sample.csv"));
  await expect(page.getByText(/5 already imported/)).toBeVisible();
  await expect(page.getByText(/You imported this exact file/)).toBeVisible();

  await page.goto("/transactions?q=countdown");
  await expect(page.getByRole("row", { name: /Countdown/ })).toHaveCount(1);
});

test("budget, goals, debt and export", async ({ page }) => {
  await signUpWithAccount(page, "2000");

  // Budget: assign to groceries → ready to assign drops
  await page.goto("/budget");
  await expect(page.getByText("Ready to assign")).toBeVisible();
  await page.getByLabel("Assigned for Groceries").fill("400");
  await page.getByLabel("Assigned for Groceries").press("Enter");
  await expect(page.getByText("$1,600.00").first()).toBeVisible();

  // Goal
  await page.goto("/goals?new=1");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Target amount").fill("3000");
  await dialog.getByLabel("I’ll save").fill("100");
  await dialog.getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByText("Goal created")).toBeVisible();
  await page.getByRole("button", { name: "Add money" }).first().click();
  await dialog.getByLabel("Amount").fill("150");
  await dialog.getByRole("button", { name: "Add to goal" }).click();
  await expect(page.getByText("$150.00").first()).toBeVisible();

  // Debt
  await page.goto("/debt");
  await page.getByRole("button", { name: "Add debt" }).first().click();
  await dialog.getByLabel("Name").fill("Car loan");
  await dialog.getByLabel("Amount owed today").fill("8000");
  await dialog.getByLabel("Type").selectOption("vehicle");
  await dialog.getByLabel("Interest rate (% a year)").fill("12.5");
  await dialog.getByLabel("Minimum monthly payment").fill("250");
  await dialog.getByRole("button", { name: "Add debt" }).click();
  await expect(page.getByText("Payoff planner")).toBeVisible();
  await expect(page.getByText("Avalanche — highest rate first")).toBeVisible();

  // CSV export downloads
  const res = await page.request.get("/api/export/transactions");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  expect(await res.text()).toContain("Date,Time,Account,Payee");
});

test("users can't see each other's data", async ({ browser }) => {
  const a = await browser.newContext();
  const pa = await a.newPage();
  await signUpWithAccount(pa, "100");
  await pa.goto("/transactions");
  await pa.getByRole("button", { name: "Add transaction" }).first().click();
  await pa.getByRole("dialog").getByLabel("Amount").fill("12");
  await pa.getByRole("dialog").getByLabel("Payee").fill("Secret Purchase");
  await pa.getByRole("dialog").getByRole("button", { name: "Add transaction" }).click();
  await expect(pa.getByText("Transaction added")).toBeVisible();

  const b = await browser.newContext();
  const pb = await b.newPage();
  await signUpWithAccount(pb, "100");
  await pb.goto("/transactions?q=Secret");
  await expect(pb.getByText("No transactions match")).toBeVisible();
  const csv = await (await pb.request.get("/api/export/transactions")).text();
  expect(csv).not.toContain("Secret Purchase");
  await a.close();
  await b.close();
});

test("wrong password is rejected", async ({ page }) => {
  const email = await signUp(page);
  await page.getByRole("button", { name: "Skip setup for now" }).click();
  await page.waitForURL("**/overview");
  await page.context().clearCookies();
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/overview");
});
