import { and, desc, eq } from "drizzle-orm";
import type { Database, Queryable } from "../db";
import { debts, financialAccounts, transactions } from "../db/schema";
import { audit, diff, invalid, notFound, ownedAccount } from "./common";
import { createAccount, listAccounts } from "./accounts";
import { compareStrategies, DEBT_ASSUMPTIONS, type DebtInput } from "@/domain/debt";
import { assertCents } from "@/domain/money";
import { isLiability, type AccountType } from "@/domain/ledger";
import { addMonths, isValidDate, type ISODate } from "@/domain/dates";

export type DebtRow = typeof debts.$inferSelect;
export type DebtKind = DebtRow["kind"];

export interface DebtView extends DebtRow {
  accountName: string;
  accountType: AccountType;
  currency: string;
  /** Amount owed (positive), from the linked account's ledger balance. */
  balance: number;
  payments: { id: string; date: ISODate; amount: number; merchant: string }[];
  paidLast90Days: number;
  nextDueDate: ISODate | null;
}

export async function listDebts(db: Queryable, userId: string, today: ISODate): Promise<DebtView[]> {
  const [rows, accounts] = await Promise.all([
    db
      .select({ d: debts, a: financialAccounts })
      .from(debts)
      .innerJoin(financialAccounts, eq(financialAccounts.id, debts.accountId))
      .where(eq(debts.userId, userId)),
    listAccounts(db, userId, { includeArchived: true }),
  ]);
  const out: DebtView[] = [];
  for (const { d, a } of rows) {
    const bal = accounts.find((x) => x.id === a.id)?.balance ?? 0;
    const payments = await db
      .select({ id: transactions.id, date: transactions.date, amount: transactions.amount, merchant: transactions.merchant })
      .from(transactions)
      .where(and(eq(transactions.userId, userId), eq(transactions.accountId, a.id)))
      .orderBy(desc(transactions.date))
      .limit(60);
    const pays = payments.filter((p) => p.amount > 0 && p.merchant !== "Opening balance");
    const since = addMonths(today, -3);
    let next: ISODate | null = null;
    if (d.dueDay) {
      const [y, m] = today.split("-").map(Number);
      const thisMonth = addMonths(`${y}-${String(m).padStart(2, "0")}-01`, 0, d.dueDay);
      next = thisMonth >= today ? thisMonth : addMonths(`${y}-${String(m).padStart(2, "0")}-01`, 1, d.dueDay);
    }
    out.push({
      ...d,
      accountName: a.name,
      accountType: a.type,
      currency: a.currency,
      balance: Math.max(-bal, 0),
      payments: pays.slice(0, 12),
      paidLast90Days: pays.filter((p) => p.date >= since).reduce((s, p) => s + p.amount, 0),
      nextDueDate: next,
    });
  }
  return out.sort((x, y) => y.aprBps - x.aprBps);
}

export interface DebtInputForm {
  kind: DebtKind;
  lender?: string | null;
  aprBps: number;
  aprIsEstimate?: boolean;
  minimumPayment: number;
  dueDay?: number | null;
  originalPrincipal?: number | null;
  notes?: string | null;
  rateChanges?: { fromMonth: number; aprBps: number }[];
}

function validate(input: Partial<DebtInputForm>) {
  if (input.aprBps !== undefined && (!Number.isInteger(input.aprBps) || input.aprBps < 0 || input.aprBps > 20000)) throw invalid("Interest rate must be 0–200%");
  if (input.minimumPayment !== undefined) {
    assertCents(input.minimumPayment);
    if (input.minimumPayment < 0) throw invalid("Minimum payment can't be negative");
  }
  if (input.dueDay !== undefined && input.dueDay !== null && (input.dueDay < 1 || input.dueDay > 31)) throw invalid("Due day must be 1–31");
  for (const r of input.rateChanges ?? []) {
    if (!Number.isInteger(r.fromMonth) || r.fromMonth < 1 || r.fromMonth > 600) throw invalid("Rate change month must be 1–600");
    if (!Number.isInteger(r.aprBps) || r.aprBps < 0 || r.aprBps > 20000) throw invalid("Rate change must be 0–200%");
  }
}

const KIND_TO_ACCOUNT: Record<DebtKind, AccountType> = {
  credit_card: "credit_card",
  personal_loan: "loan",
  student_loan: "loan",
  vehicle: "loan",
  mortgage: "loan",
  other: "other_liability",
};

/** Record a new debt: creates the liability account (balance = amount owed) and its debt profile. */
export async function createDebtWithAccount(
  db: Database,
  userId: string,
  input: DebtInputForm & { name: string; currency: string; balanceOwed: number; asOf: ISODate },
): Promise<DebtRow> {
  validate(input);
  assertCents(input.balanceOwed);
  if (input.balanceOwed < 0) throw invalid("Enter the amount owed as a positive number");
  if (!isValidDate(input.asOf)) throw invalid("Invalid date");
  const account = await createAccount(db, userId, {
    name: input.name,
    type: KIND_TO_ACCOUNT[input.kind],
    currency: input.currency,
    institution: input.lender ?? null,
    openingBalance: -input.balanceOwed,
    openingDate: input.asOf,
    spendable: false,
    onBudget: false,
  });
  return attachDebtProfile(db, userId, account.id, input);
}

export async function attachDebtProfile(db: Database, userId: string, accountId: string, input: DebtInputForm): Promise<DebtRow> {
  validate(input);
  return db.transaction(async (tx) => {
    const account = await ownedAccount(tx, userId, accountId);
    if (!isLiability(account.type)) throw invalid("Debts must be linked to a credit card, loan or other liability account");
    const [row] = await tx
      .insert(debts)
      .values({
        userId,
        accountId,
        kind: input.kind,
        lender: input.lender?.trim() || null,
        aprBps: input.aprBps,
        aprIsEstimate: input.aprIsEstimate ?? false,
        minimumPayment: input.minimumPayment,
        dueDay: input.dueDay ?? null,
        originalPrincipal: input.originalPrincipal ?? null,
        notes: input.notes?.trim() || null,
        rateChanges: input.rateChanges ?? [],
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw invalid("This account already has a debt profile");
    await audit(tx, userId, "debt", row.id, "create", { kind: row.kind, aprBps: row.aprBps });
    return row;
  });
}

export async function updateDebt(db: Database, userId: string, id: string, patch: Partial<DebtInputForm> & { confirmedBalance?: number | null; confirmedBalanceDate?: ISODate | null }) {
  validate(patch);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(debts).where(and(eq(debts.id, id), eq(debts.userId, userId)));
    if (!before) throw notFound("Debt");
    const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<DebtRow>;
    await tx.update(debts).set(values).where(eq(debts.id, id));
    await audit(tx, userId, "debt", id, "update", diff(before, values));
  });
}

export async function deleteDebtProfile(db: Database, userId: string, id: string) {
  const res = await db.delete(debts).where(and(eq(debts.id, id), eq(debts.userId, userId))).returning();
  if (!res.length) throw notFound("Debt");
  await audit(db, userId, "debt", id, "delete");
}

export function payoffPlan(list: DebtView[], extraMonthly: number) {
  const inputs: DebtInput[] = list
    .filter((d) => d.balance > 0)
    .map((d) => ({ id: d.id, name: d.accountName, balance: d.balance, aprBps: d.aprBps, minimumPayment: d.minimumPayment, rateChanges: d.rateChanges }));
  return { ...compareStrategies(inputs, extraMonthly), assumptions: DEBT_ASSUMPTIONS, estimatedRates: list.filter((d) => d.aprIsEstimate).map((d) => d.accountName) };
}
