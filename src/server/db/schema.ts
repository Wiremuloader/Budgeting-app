import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Ledger relational schema.
 *
 * Conventions
 *  - Money: `bigint` minor units (mode "number", guarded in the domain layer).
 *  - Calendar dates: `date` (mode "string", YYYY-MM-DD). Instants: `timestamptz`.
 *  - Every user-owned row carries `user_id` → users.id ON DELETE CASCADE, so
 *    account deletion removes all financial data, and every service query filters by it.
 *  - Ids: random UUIDs (non-guessable). Auth tables use Better Auth's text ids.
 */

const money = (name: string) => bigint(name, { mode: "number" });
const day = (name: string) => date(name, { mode: "string" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------------------------------------------ auth */

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const twoFactors = pgTable(
  "two_factors",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [index("two_factors_user_idx").on(t.userId), index("two_factors_secret_idx").on(t.secret)],
);

/* ----------------------------------------------------------- preferences */

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  country: text("country").notNull().default("NZ"),
  currency: text("currency").notNull().default("NZD"),
  locale: text("locale").notNull().default("en-NZ"),
  timezone: text("timezone").notNull().default("Pacific/Auckland"),
  budgetMethod: text("budget_method", { enum: ["envelope", "flexible"] }).notNull().default("envelope"),
  budgetMode: text("budget_mode", { enum: ["guided", "manual"] }).notNull().default("guided"),
  /** First month of envelope budgeting (YYYY-MM); funds before it roll into it. */
  budgetStartMonth: text("budget_start_month"),
  incomeFrequency: text("income_frequency", { enum: ["weekly", "fortnightly", "monthly", "irregular"] }),
  safetyBuffer: money("safety_buffer").notNull().default(0),
  lowBalanceThreshold: money("low_balance_threshold").notNull().default(0),
  priorities: jsonb("priorities").$type<string[]>().notNull().default([]),
  aiEnabled: boolean("ai_enabled").notNull().default(true),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  checklistDismissedAt: timestamp("checklist_dismissed_at", { withTimezone: true }),
  /** Batch email-channel notifications into one daily email instead of sending each immediately. */
  emailDigest: boolean("email_digest").notNull().default(false),
  /** Local date (YYYY-MM-DD) of the last digest sent, so each day gets at most one. */
  lastDigestOn: text("last_digest_on"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* -------------------------------------------------------------- accounts */

export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "cash",
  "credit_card",
  "loan",
  "investment",
  "other_asset",
  "other_liability",
] as const;

export const bankConnections = pgTable(
  "bank_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["pending", "active", "expired", "error", "revoked"] })
      .notNull()
      .default("pending"),
    /** AES-256-GCM encrypted provider tokens; never sent to the client. */
    encryptedCredentials: text("encrypted_credentials"),
    consentExpiresAt: timestamp("consent_expires_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    failureCount: integer("failure_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    syncCursor: text("sync_cursor"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("bank_connections_user_idx").on(t.userId)],
);

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    currency: text("currency").notNull().default("NZD"),
    institution: text("institution"),
    /** Last 4 digits only, for recognition. Full account numbers are never stored. */
    mask: text("mask"),
    spendable: boolean("spendable").notNull().default(false),
    includeInNetWorth: boolean("include_in_net_worth").notNull().default(true),
    onBudget: boolean("on_budget").notNull().default(true),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    connectionId: uuid("connection_id").references(() => bankConnections.id, { onDelete: "set null" }),
    externalAccountId: text("external_account_id"),
    isSample: boolean("is_sample").notNull().default(false),
    lastReconciledAt: timestamp("last_reconciled_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("financial_accounts_user_idx").on(t.userId),
    check("financial_accounts_mask_chk", sql`${t.mask} IS NULL OR ${t.mask} ~ '^[0-9]{2,4}$'`),
    check(
      "financial_accounts_type_chk",
      sql`${t.type} IN ('checking','savings','cash','credit_card','loan','investment','other_asset','other_liability')`,
    ),
    check("financial_accounts_currency_chk", sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/* ------------------------------------------------------------ categories */

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    group: text("group", { enum: ["income", "expense"] }).notNull(),
    /** Template key ("groceries") for categories created from defaults. */
    systemKey: text("system_key"),
    parentId: uuid("parent_id"),
    icon: text("icon"),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    rollover: boolean("rollover").notNull().default(true),
    /** Default % used before a flexible-budget warning (basis points). */
    alertThresholdBps: integer("alert_threshold_bps").notNull().default(8500),
    alertsEnabled: boolean("alerts_enabled").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("categories_user_idx").on(t.userId),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: "categories_parent_fk" }).onDelete("set null"),
    check("categories_group_chk", sql`${t.group} IN ('income','expense')`),
    uniqueIndex("categories_user_name_active_uq")
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
  ],
);

export const merchantRules = pgTable(
  "merchant_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pattern: text("pattern").notNull(),
    merchantName: text("merchant_name"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("merchant_rules_user_pattern_uq").on(t.userId, t.pattern)],
);

/* ------------------------------------------------------------- recurring */

export const recurringRules = pgTable(
  "recurring_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["income", "bill", "subscription", "transfer", "debt_payment"] }).notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "cascade" }),
    /** Destination for transfers / debt payments. */
    toAccountId: uuid("to_account_id").references(() => financialAccounts.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    /** Signed from `accountId`'s point of view (bills negative, income positive). */
    amount: money("amount").notNull(),
    amountVaries: boolean("amount_varies").notNull().default(false),
    frequency: text("frequency", { enum: ["weekly", "fortnightly", "monthly", "quarterly", "yearly", "custom"] }).notNull(),
    interval: integer("interval"),
    unit: text("unit", { enum: ["day", "week", "month", "year"] }),
    anchorDate: day("anchor_date").notNull(),
    endDate: day("end_date"),
    status: text("status", { enum: ["active", "paused", "ended"] }).notNull().default("active"),
    merchantKey: text("merchant_key"),
    autoMatch: boolean("auto_match").notNull().default(true),
    source: text("source", { enum: ["manual", "detected", "onboarding"] }).notNull().default("manual"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("recurring_rules_user_idx").on(t.userId),
    check("recurring_rules_amount_nonzero", sql`${t.amount} <> 0`),
    check("recurring_rules_transfer_target", sql`(${t.kind} NOT IN ('transfer','debt_payment')) OR ${t.toAccountId} IS NOT NULL`),
  ],
);

/** Detected patterns the user dismissed, so they aren't suggested again. */
export const recurringSuggestionDismissals = pgTable(
  "recurring_suggestion_dismissals",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    merchantKey: text("merchant_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.merchantKey] })],
);

/* ---------------------------------------------------------- transactions */

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["csv", "provider"] }).notNull(),
    fileName: text("file_name"),
    fileHash: text("file_hash"),
    status: text("status", { enum: ["completed", "failed", "undone"] }).notNull(),
    rowCount: integer("row_count").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    mapping: jsonb("mapping"),
    createdAt: createdAt(),
  },
  (t) => [index("import_batches_user_idx").on(t.userId, t.createdAt)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "no action" }),
    date: day("date").notNull(),
    time: text("time"),
    /** Signed minor units in the account's currency. */
    amount: money("amount").notNull(),
    currency: text("currency").notNull(),
    /** Foreign-currency purchases: the amount as charged by the merchant. */
    originalAmount: money("original_amount"),
    originalCurrency: text("original_currency"),
    merchant: text("merchant").notNull(),
    merchantKey: text("merchant_key").notNull(),
    description: text("description"),
    notes: text("notes"),
    kind: text("kind", { enum: ["standard", "transfer", "adjustment"] }).notNull().default("standard"),
    status: text("status", { enum: ["pending", "cleared", "reconciled"] }).notNull().default("cleared"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "no action" }),
    isSplit: boolean("is_split").notNull().default(false),
    /** Both legs of a transfer share this id. */
    transferGroupId: uuid("transfer_group_id"),
    recurringRuleId: uuid("recurring_rule_id").references(() => recurringRules.id, { onDelete: "set null" }),
    /** The scheduled occurrence date this transaction satisfies. */
    recurringOccurrence: day("recurring_occurrence"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    fingerprint: text("fingerprint"),
    tags: text("tags").array().notNull().default(sql`ARRAY[]::text[]`),
    reviewed: boolean("reviewed").notNull().default(false),
    isSample: boolean("is_sample").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("transactions_user_date_idx").on(t.userId, t.date),
    index("transactions_account_date_idx").on(t.accountId, t.date),
    index("transactions_user_category_idx").on(t.userId, t.categoryId),
    index("transactions_transfer_idx").on(t.transferGroupId),
    index("transactions_merchant_idx").on(t.userId, t.merchantKey),
    index("transactions_recurring_idx").on(t.recurringRuleId),
    uniqueIndex("transactions_account_fingerprint_uq").on(t.accountId, t.fingerprint).where(sql`${t.fingerprint} IS NOT NULL`),
    uniqueIndex("transactions_account_external_uq").on(t.accountId, t.externalId).where(sql`${t.externalId} IS NOT NULL`),
    check("transactions_kind_chk", sql`${t.kind} IN ('standard','transfer','adjustment')`),
    check("transactions_status_chk", sql`${t.status} IN ('pending','cleared','reconciled')`),
    check("transactions_split_no_category", sql`NOT ${t.isSplit} OR ${t.categoryId} IS NULL`),
    check("transactions_transfer_group", sql`(${t.kind} = 'transfer') = (${t.transferGroupId} IS NOT NULL)`),
    check("transactions_time_fmt", sql`${t.time} IS NULL OR ${t.time} ~ '^[0-2][0-9]:[0-5][0-9]$'`),
  ],
);

export const transactionSplits = pgTable(
  "transaction_splits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "no action" }),
    amount: money("amount").notNull(),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("transaction_splits_txn_idx").on(t.transactionId), check("transaction_splits_nonzero", sql`${t.amount} <> 0`)],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_txn_idx").on(t.transactionId)],
);

/* ---------------------------------------------------------------- budget */

export const budgetPeriods = pgTable(
  "budget_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Calendar month "YYYY-MM". */
    month: text("month").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("budget_periods_user_month_uq").on(t.userId, t.month),
    check("budget_periods_month_fmt", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  ],
);

export const budgetAllocations = pgTable(
  "budget_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => budgetPeriods.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    /** Envelope: money assigned this month. Flexible: the monthly limit. */
    assigned: money("assigned").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("budget_allocations_period_category_uq").on(t.periodId, t.categoryId), index("budget_allocations_user_idx").on(t.userId)],
);

/* ----------------------------------------------------------------- goals */

export const savingsGoals = pgTable(
  "savings_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", {
      enum: ["emergency_fund", "car", "holiday", "laptop", "house_deposit", "education", "major_purchase", "custom"],
    })
      .notNull()
      .default("custom"),
    targetAmount: money("target_amount").notNull(),
    targetDate: day("target_date"),
    priority: integer("priority").notNull().default(2),
    cadence: text("cadence", { enum: ["weekly", "fortnightly", "monthly"] }).notNull().default("monthly"),
    plannedContribution: money("planned_contribution"),
    linkedAccountId: uuid("linked_account_id").references(() => financialAccounts.id, { onDelete: "set null" }),
    status: text("status", { enum: ["active", "paused", "completed", "archived"] }).notNull().default("active"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("savings_goals_user_idx").on(t.userId), check("savings_goals_target_positive", sql`${t.targetAmount} > 0`)],
);

export const goalContributions = pgTable(
  "goal_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: day("date").notNull(),
    /** Positive = set aside, negative = withdrawn from the goal. */
    amount: money("amount").notNull(),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("goal_contributions_goal_idx").on(t.goalId), check("goal_contributions_nonzero", sql`${t.amount} <> 0`)],
);

/* ------------------------------------------------------------------ debt */

export const debts = pgTable(
  "debts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The liability account whose balance is the debt balance. */
    accountId: uuid("account_id")
      .notNull()
      .unique()
      .references(() => financialAccounts.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["credit_card", "personal_loan", "student_loan", "vehicle", "mortgage", "other"] }).notNull(),
    lender: text("lender"),
    aprBps: integer("apr_bps").notNull().default(0),
    /** True when the rate is the user's estimate rather than lender-confirmed. */
    aprIsEstimate: boolean("apr_is_estimate").notNull().default(false),
    minimumPayment: money("minimum_payment").notNull().default(0),
    dueDay: integer("due_day"),
    originalPrincipal: money("original_principal"),
    /** Last balance confirmed by a lender statement, with its date. */
    confirmedBalance: money("confirmed_balance"),
    confirmedBalanceDate: day("confirmed_balance_date"),
    rateChanges: jsonb("rate_changes").$type<{ fromMonth: number; aprBps: number }[]>().notNull().default([]),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("debts_user_idx").on(t.userId),
    check("debts_apr_range", sql`${t.aprBps} BETWEEN 0 AND 20000`),
    check("debts_due_day", sql`${t.dueDay} IS NULL OR ${t.dueDay} BETWEEN 1 AND 31`),
  ],
);

/** Payments recorded against a debt (each linked to the transaction that paid it). */
export const debtPayments = pgTable(
  "debt_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    debtId: uuid("debt_id")
      .notNull()
      .references(() => debts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .unique()
      .references(() => transactions.id, { onDelete: "cascade" }),
    date: day("date").notNull(),
    amount: money("amount").notNull(),
    /** Optional lender-confirmed breakdown. */
    principalPortion: money("principal_portion"),
    interestPortion: money("interest_portion"),
    createdAt: createdAt(),
  },
  (t) => [index("debt_payments_debt_idx").on(t.debtId, t.date)],
);

/* --------------------------------------------------------- notifications */

export const NOTIFICATION_TYPES = [
  "budget_approaching",
  "budget_exceeded",
  "bill_upcoming",
  "low_balance",
  "unusual_transaction",
  "goal_milestone",
  "income_missing",
  "duplicate_charge",
  "recurring_changed",
] as const;

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
    severity: text("severity", { enum: ["info", "warning", "positive"] }).notNull().default("info"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    /** Same subject + period → one notification. */
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    deliveredVia: text("delivered_via").array().notNull().default(sql`ARRAY['in_app']::text[]`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("notifications_user_dedupe_uq").on(t.userId, t.dedupeKey), index("notifications_user_created_idx").on(t.userId, t.createdAt)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: NOTIFICATION_TYPES }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Type-specific threshold: bps for budget alerts, cents for balances, days for bills. */
    threshold: bigint("threshold", { mode: "number" }),
    channels: text("channels").array().notNull().default(sql`ARRAY['in_app']::text[]`),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

export const insightDismissals = pgTable(
  "insight_dismissals",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    insightKey: text("insight_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.insightKey] })],
);

/* ----------------------------------------------------------------- audit */

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    /** Field-level changes; never contains credentials or tokens. */
    changes: jsonb("changes"),
    source: text("source", { enum: ["user", "import", "assistant", "system", "provider"] }).notNull().default("user"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_entity_idx").on(t.userId, t.entityType, t.entityId), index("audit_events_user_created_idx").on(t.userId, t.createdAt)],
);
