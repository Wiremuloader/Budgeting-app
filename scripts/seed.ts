/**
 * Demo seed: creates a sample user with ~6 months of realistic New Zealand data.
 *
 *   npm run db:seed            (stop `npm run dev` first when using embedded PGlite)
 *
 * Everything created here is flagged `is_sample = true` and shown with a
 * "Sample" badge in the UI. Development/demo use only — never run against production.
 *
 * Demo sign-in (local development only):
 *   email:    demo@ledger.test
 *   password: ledger-demo-2026
 */
import { eq } from "drizzle-orm";
import { getDb, closeDatabase, type Database } from "../src/server/db";
import { createAuthForTesting } from "../src/server/auth";
import { categories, users, userPreferences, transactions } from "../src/server/db/schema";
import { createAccount } from "../src/server/services/accounts";
import { createTransaction, createTransfer } from "../src/server/services/transactions";
import { createRule } from "../src/server/services/recurring";
import { createGoal, addContribution } from "../src/server/services/goals";
import { attachDebtProfile, createDebtWithAccount } from "../src/server/services/debts";
import { applyAllocations } from "../src/server/services/budget";
import { addDays, addMonthKey, dayOfWeek, monthKey, todayIn, type ISODate } from "../src/domain/dates";

export const DEMO_EMAIL = "demo@ledger.test";
export const DEMO_PASSWORD = "ledger-demo-2026";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

// Deterministic pseudo-random numbers so the demo is stable between runs.
let state = 20260301;
function rand() {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
}
const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));

async function main() {
  process.env.DISABLE_AUTH_RATE_LIMIT = "true";
  const db: Database = await getDb();
  const existing = await db.select().from(users).where(eq(users.email, DEMO_EMAIL));
  if (existing.length) {
    console.log("Demo user exists — removing it and re-seeding.");
    await db.delete(users).where(eq(users.id, existing[0].id));
  }
  const auth = createAuthForTesting(db);
  const { user } = await auth.api.signUpEmail({ body: { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: "Aroha Ngata" } });
  await db.update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
  const uid = user.id;
  const today = todayIn("Pacific/Auckland");
  const start = addDays(today, -182);
  const startMonth = monthKey(start);

  await db
    .update(userPreferences)
    .set({ onboardingCompletedAt: new Date(), budgetStartMonth: addMonthKey(startMonth, 1), incomeFrequency: "fortnightly", safetyBuffer: 20_000, lowBalanceThreshold: 30_000, budgetMethod: "envelope" })
    .where(eq(userPreferences.userId, uid));

  const cats = await db.select().from(categories).where(eq(categories.userId, uid));
  const c = (k: string) => cats.find((x) => x.systemKey === k)!.id;
  const sample = { isSample: true };

  const everyday = await createAccount(db, uid, { name: "ANZ Everyday", type: "checking", currency: "NZD", institution: "ANZ", mask: "4821", openingBalance: 184_250, openingDate: start, ...sample });
  const savings = await createAccount(db, uid, { name: "Kiwibank Notice Saver", type: "savings", currency: "NZD", institution: "Kiwibank", openingBalance: 640_000, openingDate: start, ...sample });
  const card = await createAccount(db, uid, { name: "ASB Visa Light", type: "credit_card", currency: "NZD", institution: "ASB", mask: "9034", openingBalance: -42_310, openingDate: start, ...sample });
  await createAccount(db, uid, { name: "Wallet", type: "cash", currency: "NZD", openingBalance: 6_000, openingDate: start, ...sample });
  await attachDebtProfile(db, uid, card.id, { kind: "credit_card", lender: "ASB", aprBps: 1395, minimumPayment: 2_500, dueDay: 22 });
  await createDebtWithAccount(db, uid, { name: "StudyLink loan", kind: "student_loan", currency: "NZD", balanceOwed: 2_184_000, asOf: start, aprBps: 0, minimumPayment: 0, lender: "Inland Revenue", notes: "Interest-free while living in NZ. Repayments are deducted from salary (12% over the threshold)." });
  await createDebtWithAccount(db, uid, { name: "Car loan", kind: "vehicle", currency: "NZD", balanceOwed: 914_000, asOf: start, aprBps: 1290, minimumPayment: 31_500, dueDay: 5, lender: "MTF Finance" });

  // Recurring schedule (also used to generate history).
  const payAnchor = (() => {
    let d = start;
    while (dayOfWeek(d) !== 4) d = addDays(d, 1); // Thursdays
    return d;
  })();
  await createRule(db, uid, { name: "Salary — Kōwhai Design Ltd", kind: "income", accountId: everyday.id, categoryId: c("salary"), amount: 248_640, frequency: "fortnightly", anchorDate: payAnchor, merchantKey: "kowhai design ltd" }, today);
  await createRule(db, uid, { name: "Rent — Harcourts", kind: "bill", accountId: everyday.id, categoryId: c("housing"), amount: 54_000, frequency: "weekly", anchorDate: addDays(payAnchor, 1), merchantKey: "harcourts rent" }, today);
  await createRule(db, uid, { name: "Mercury Energy", kind: "bill", accountId: everyday.id, categoryId: c("utilities"), amount: 16_500, amountVaries: true, frequency: "monthly", anchorDate: `${startMonth}-18` }, today);
  await createRule(db, uid, { name: "One NZ", kind: "bill", accountId: card.id, categoryId: c("phone_internet"), amount: 8_999, frequency: "monthly", anchorDate: `${startMonth}-09`, merchantKey: "one nz" }, today);
  await createRule(db, uid, { name: "Netflix", kind: "subscription", accountId: card.id, categoryId: c("subscriptions"), amount: 2_799, frequency: "monthly", anchorDate: `${startMonth}-03` }, today);
  await createRule(db, uid, { name: "Spotify", kind: "subscription", accountId: card.id, categoryId: c("subscriptions"), amount: 1_699, frequency: "monthly", anchorDate: `${startMonth}-14` }, today);
  await createRule(db, uid, { name: "AA Insurance", kind: "bill", accountId: everyday.id, categoryId: c("insurance"), amount: 7_840, frequency: "monthly", anchorDate: `${startMonth}-25`, merchantKey: "aa insurance" }, today);
  await createRule(db, uid, { name: "Car loan repayment", kind: "debt_payment", accountId: everyday.id, toAccountId: (await db.query.financialAccounts.findFirst({ where: (a, { and, eq }) => and(eq(a.userId, uid), eq(a.name, "Car loan")) }))!.id, categoryId: c("debt_repayments"), amount: 31_500, frequency: "monthly", anchorDate: `${startMonth}-05` }, today);
  await createRule(db, uid, { name: "Savings sweep", kind: "transfer", accountId: everyday.id, toAccountId: savings.id, amount: 25_000, frequency: "fortnightly", anchorDate: addDays(payAnchor, 1) }, today);
  const carLoan = (await db.query.financialAccounts.findFirst({ where: (a, { and, eq }) => and(eq(a.userId, uid), eq(a.name, "Car loan")) }))!;

  const add = (accountId: string, date: ISODate, amount: number, merchant: string, categoryId: string | null, extra: Partial<Parameters<typeof createTransaction>[2]> = {}) =>
    date <= today ? createTransaction(db, uid, { accountId, date, amount, merchant, categoryId, reviewed: true, isSample: true, ...extra }, "system") : Promise.resolve(null);

  const groceries = ["Countdown Ponsonby", "New World Victoria Park", "PAK'nSAVE Royal Oak", "Farro Fresh"];
  const dining = ["Daily Bread", "Burger Burger", "Hello Beasty", "Sal's Pizza", "Uber Eats", "Ozone Coffee"];
  const shopping = ["Kmart", "The Warehouse", "Mitre 10", "Briscoes", "Rebel Sport"];

  for (let d = start; d <= today; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    const dom = Number(d.slice(8));
    const mk = d.slice(0, 7);
    // Fortnightly pay on Thursdays + savings sweep and rent next day
    if ((Math.round((Date.parse(d) - Date.parse(payAnchor)) / 86_400_000) % 14 + 14) % 14 === 0) {
      await add(everyday.id, d, 248_640, "Kōwhai Design Ltd", c("salary"), { notes: "Fortnightly salary (after PAYE, KiwiSaver and student loan deductions)" });
      const next = addDays(d, 1);
      if (next <= today) await createTransfer(db, uid, { fromAccountId: everyday.id, toAccountId: savings.id, amount: 25_000, date: next, isSample: true }, "system");
    }
    if (dow === 5) await add(everyday.id, d, -54_000, "Harcourts Rent", c("housing"));
    if (dow === 6 || dow === 3) await add(rand() < 0.6 ? everyday.id : card.id, d, -between(6_500, 17_500), groceries[between(0, groceries.length - 1)], c("groceries"));
    if (rand() < 0.32) await add(card.id, d, -between(900, 6_800), dining[between(0, dining.length - 1)], c("restaurants"));
    if (dow === 1 && rand() < 0.7) await add(card.id, d, -between(6_000, 9_500), "Z Energy Grey Lynn", c("transport"));
    if (rand() < 0.18) await add(everyday.id, d, -between(320, 1_200), "AT HOP Top Up", c("transport"));
    if (rand() < 0.07) await add(card.id, d, -between(1_800, 14_000), shopping[between(0, shopping.length - 1)], c("shopping"));
    if (dom === 3) await add(card.id, d, -2_799, "Netflix", c("subscriptions"));
    if (dom === 14) await add(card.id, d, mk >= monthKey(addDays(today, -40)) ? -1_999 : -1_699, "Spotify", c("subscriptions"));
    if (dom === 9) await add(card.id, d, -8_999, "One NZ", c("phone_internet"));
    if (dom === 18) await add(everyday.id, d, -between(13_500, 21_000), "Mercury Energy", c("utilities"));
    if (dom === 25) await add(everyday.id, d, -7_840, "AA Insurance", c("insurance"));
    if (dom === 12) await add(everyday.id, d, -2_400, "Les Mills Britomart", c("health"));
    if (dom === 5) await createTransfer(db, uid, { fromAccountId: everyday.id, toAccountId: carLoan.id, amount: 31_500, date: d, categoryId: c("debt_repayments"), isSample: true }, "system");
    if (dom === 22) {
      // Pay last month's card statement in full: a transfer, never spending.
      await createTransfer(db, uid, { fromAccountId: everyday.id, toAccountId: card.id, amount: between(52_000, 76_000), date: d, isSample: true }, "system");
      await add(carLoan.id, d, -between(8_900, 9_800), "Interest charged", c("fees"), { notes: "Car loan interest" });
    }
    if (rand() < 0.05) await add(everyday.id, d, -between(2_000, 9_000), "Unichem Pharmacy", c("health"));
    if (rand() < 0.03) await add(card.id, d, -between(2_500, 6_500), "Event Cinemas", c("entertainment"));
  }

  // A refund, a split transaction, a pending purchase, an uncategorised item and one large purchase.
  await add(card.id, addDays(today, -26), -18_999, "Rebel Sport", c("shopping"), { notes: "Running shoes" });
  await add(card.id, addDays(today, -19), 18_999, "Rebel Sport", c("shopping"), { notes: "Refund — wrong size" });
  await add(everyday.id, addDays(today, -9), -21_450, "The Warehouse", null, {
    splits: [
      { categoryId: c("groceries"), amount: -6_450 },
      { categoryId: c("shopping"), amount: -11_000 },
      { categoryId: c("gifts"), amount: -4_000 },
    ],
  });
  await add(card.id, addDays(today, -1), -4_350, "Burger Burger", c("restaurants"), { status: "pending" });
  await add(everyday.id, addDays(today, -3), -6_000, "POLI PAYMENT 0042", null, { reviewed: false });
  await add(card.id, addDays(today, -4), -64_900, "Noel Leeming", c("shopping"), { notes: "New laptop charger and headphones" });
  await add(everyday.id, addDays(today, -12), 4_500, "IRD", null, { reviewed: false, notes: "Unexplained deposit — needs review" });

  // Goals (earmarks against the savings account)
  const ef = await createGoal(db, uid, { name: "Emergency fund", kind: "emergency_fund", targetAmount: 800_000, targetDate: addDays(today, 300), cadence: "fortnightly", plannedContribution: 20_000, linkedAccountId: savings.id, priority: 1, initialSaved: 420_000 }, start);
  const japan = await createGoal(db, uid, { name: "Japan trip", kind: "holiday", targetAmount: 450_000, targetDate: addDays(today, 240), cadence: "fortnightly", plannedContribution: 5_000, linkedAccountId: savings.id, priority: 2, initialSaved: 90_000 }, start);
  await createGoal(db, uid, { name: "New laptop", kind: "laptop", targetAmount: 260_000, cadence: "monthly", plannedContribution: 15_000, priority: 3 }, start);
  for (let i = 1; i <= 6; i++) {
    await addContribution(db, uid, ef.id, { amount: 20_000, date: addDays(start, i * 28), note: "Fortnightly sweep" });
    await addContribution(db, uid, japan.id, { amount: 5_000, date: addDays(start, i * 28) });
  }

  // Budgets for every month since the budget start, so history and rollovers are meaningful.
  const plan: [string, number][] = [
    ["housing", 234_000],
    ["groceries", 70_000],
    ["restaurants", 32_000],
    ["transport", 38_000],
    ["utilities", 18_000],
    ["phone_internet", 9_000],
    ["subscriptions", 4_500],
    ["health", 6_000],
    ["entertainment", 5_000],
    ["shopping", 15_000],
    ["insurance", 7_840],
    ["debt_repayments", 31_500],
    ["gifts", 4_000],
    ["fees", 10_000],
    ["miscellaneous", 5_000],
  ];
  for (let m = addMonthKey(startMonth, 1); m <= monthKey(today); m = addMonthKey(m, 1)) {
    await applyAllocations(db, uid, m, plan.map(([k, amount]) => ({ categoryId: c(k), amount })), "system");
  }

  const [{ count }] = await db.select({ count: db.$count(transactions, eq(transactions.userId, uid)) }).from(users).limit(1);
  console.log(`Seeded demo user ${DEMO_EMAIL} with ${count} transactions.`);
  await closeDatabase();
}

main().catch(async (e) => {
  console.error(e);
  await closeDatabase();
  process.exit(1);
});
