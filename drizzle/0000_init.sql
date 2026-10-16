CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"changes" jsonb,
	"source" text DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"encrypted_credentials" text,
	"consent_expires_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"sync_cursor" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"assigned" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"month" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_periods_month_fmt" CHECK ("budget_periods"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"group" text NOT NULL,
	"system_key" text,
	"parent_id" uuid,
	"icon" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"rollover" boolean DEFAULT true NOT NULL,
	"alert_threshold_bps" integer DEFAULT 8500 NOT NULL,
	"alerts_enabled" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_group_chk" CHECK ("categories"."group" IN ('income','expense'))
);
--> statement-breakpoint
CREATE TABLE "debt_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"debt_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" bigint NOT NULL,
	"principal_portion" bigint,
	"interest_portion" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debt_payments_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"lender" text,
	"apr_bps" integer DEFAULT 0 NOT NULL,
	"apr_is_estimate" boolean DEFAULT false NOT NULL,
	"minimum_payment" bigint DEFAULT 0 NOT NULL,
	"due_day" integer,
	"original_principal" bigint,
	"confirmed_balance" bigint,
	"confirmed_balance_date" date,
	"rate_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debts_account_id_unique" UNIQUE("account_id"),
	CONSTRAINT "debts_apr_range" CHECK ("debts"."apr_bps" BETWEEN 0 AND 20000),
	CONSTRAINT "debts_due_day" CHECK ("debts"."due_day" IS NULL OR "debts"."due_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE TABLE "financial_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" text DEFAULT 'NZD' NOT NULL,
	"institution" text,
	"mask" text,
	"spendable" boolean DEFAULT false NOT NULL,
	"include_in_net_worth" boolean DEFAULT true NOT NULL,
	"on_budget" boolean DEFAULT true NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"connection_id" uuid,
	"external_account_id" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"last_reconciled_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "financial_accounts_mask_chk" CHECK ("financial_accounts"."mask" IS NULL OR "financial_accounts"."mask" ~ '^[0-9]{2,4}$'),
	CONSTRAINT "financial_accounts_type_chk" CHECK ("financial_accounts"."type" IN ('checking','savings','cash','credit_card','loan','investment','other_asset','other_liability')),
	CONSTRAINT "financial_accounts_currency_chk" CHECK ("financial_accounts"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "goal_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"amount" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_contributions_nonzero" CHECK ("goal_contributions"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"source" text NOT NULL,
	"file_name" text,
	"file_hash" text,
	"status" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"mapping" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight_dismissals" (
	"user_id" text NOT NULL,
	"insight_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insight_dismissals_user_id_insight_key_pk" PRIMARY KEY("user_id","insight_key")
);
--> statement-breakpoint
CREATE TABLE "merchant_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pattern" text NOT NULL,
	"merchant_name" text,
	"category_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"threshold" bigint,
	"channels" text[] DEFAULT ARRAY['in_app']::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_type_pk" PRIMARY KEY("user_id","type")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"href" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"delivered_via" text[] DEFAULT ARRAY['in_app']::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"account_id" uuid NOT NULL,
	"to_account_id" uuid,
	"category_id" uuid,
	"amount" bigint NOT NULL,
	"amount_varies" boolean DEFAULT false NOT NULL,
	"frequency" text NOT NULL,
	"interval" integer,
	"unit" text,
	"anchor_date" date NOT NULL,
	"end_date" date,
	"status" text DEFAULT 'active' NOT NULL,
	"merchant_key" text,
	"auto_match" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_amount_nonzero" CHECK ("recurring_rules"."amount" <> 0),
	CONSTRAINT "recurring_rules_transfer_target" CHECK (("recurring_rules"."kind" NOT IN ('transfer','debt_payment')) OR "recurring_rules"."to_account_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "recurring_suggestion_dismissals" (
	"user_id" text NOT NULL,
	"merchant_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_suggestion_dismissals_user_id_merchant_key_pk" PRIMARY KEY("user_id","merchant_key")
);
--> statement-breakpoint
CREATE TABLE "savings_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"target_amount" bigint NOT NULL,
	"target_date" date,
	"priority" integer DEFAULT 2 NOT NULL,
	"cadence" text DEFAULT 'monthly' NOT NULL,
	"planned_contribution" bigint,
	"linked_account_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "savings_goals_target_positive" CHECK ("savings_goals"."target_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "transaction_splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "transaction_splits_nonzero" CHECK ("transaction_splits"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"time" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"original_amount" bigint,
	"original_currency" text,
	"merchant" text NOT NULL,
	"merchant_key" text NOT NULL,
	"description" text,
	"notes" text,
	"kind" text DEFAULT 'standard' NOT NULL,
	"status" text DEFAULT 'cleared' NOT NULL,
	"category_id" uuid,
	"is_split" boolean DEFAULT false NOT NULL,
	"transfer_group_id" uuid,
	"recurring_rule_id" uuid,
	"recurring_occurrence" date,
	"import_batch_id" uuid,
	"external_id" text,
	"fingerprint" text,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_kind_chk" CHECK ("transactions"."kind" IN ('standard','transfer','adjustment')),
	CONSTRAINT "transactions_status_chk" CHECK ("transactions"."status" IN ('pending','cleared','reconciled')),
	CONSTRAINT "transactions_split_no_category" CHECK (NOT "transactions"."is_split" OR "transactions"."category_id" IS NULL),
	CONSTRAINT "transactions_transfer_group" CHECK (("transactions"."kind" = 'transfer') = ("transactions"."transfer_group_id" IS NOT NULL)),
	CONSTRAINT "transactions_time_fmt" CHECK ("transactions"."time" IS NULL OR "transactions"."time" ~ '^[0-2][0-9]:[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "two_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"country" text DEFAULT 'NZ' NOT NULL,
	"currency" text DEFAULT 'NZD' NOT NULL,
	"locale" text DEFAULT 'en-NZ' NOT NULL,
	"timezone" text DEFAULT 'Pacific/Auckland' NOT NULL,
	"budget_method" text DEFAULT 'envelope' NOT NULL,
	"budget_mode" text DEFAULT 'guided' NOT NULL,
	"budget_start_month" text,
	"income_frequency" text,
	"safety_buffer" bigint DEFAULT 0 NOT NULL,
	"low_balance_threshold" bigint DEFAULT 0 NOT NULL,
	"priorities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"onboarding_completed_at" timestamp with time zone,
	"checklist_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_period_id_budget_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."budget_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debt_payments" ADD CONSTRAINT "debt_payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_savings_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."savings_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_dismissals" ADD CONSTRAINT "insight_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_rules" ADD CONSTRAINT "merchant_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_to_account_id_financial_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_suggestion_dismissals" ADD CONSTRAINT "recurring_suggestion_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "savings_goals" ADD CONSTRAINT "savings_goals_linked_account_id_financial_accounts_id_fk" FOREIGN KEY ("linked_account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_financial_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_rule_id_recurring_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_txn_idx" ON "attachments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("user_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_events_user_created_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bank_connections_user_idx" ON "bank_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_allocations_period_category_uq" ON "budget_allocations" USING btree ("period_id","category_id");--> statement-breakpoint
CREATE INDEX "budget_allocations_user_idx" ON "budget_allocations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_periods_user_month_uq" ON "budget_periods" USING btree ("user_id","month");--> statement-breakpoint
CREATE INDEX "categories_user_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_active_uq" ON "categories" USING btree ("user_id",lower("name")) WHERE "categories"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "debt_payments_debt_idx" ON "debt_payments" USING btree ("debt_id","date");--> statement-breakpoint
CREATE INDEX "debts_user_idx" ON "debts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "financial_accounts_user_idx" ON "financial_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "goal_contributions_goal_idx" ON "goal_contributions" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "import_batches_user_idx" ON "import_batches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_rules_user_pattern_uq" ON "merchant_rules" USING btree ("user_id","pattern");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "recurring_rules_user_idx" ON "recurring_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "savings_goals_user_idx" ON "savings_goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transaction_splits_txn_idx" ON "transaction_splits" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "transactions_account_date_idx" ON "transactions" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "transactions_user_category_idx" ON "transactions" USING btree ("user_id","category_id");--> statement-breakpoint
CREATE INDEX "transactions_transfer_idx" ON "transactions" USING btree ("transfer_group_id");--> statement-breakpoint
CREATE INDEX "transactions_merchant_idx" ON "transactions" USING btree ("user_id","merchant_key");--> statement-breakpoint
CREATE INDEX "transactions_recurring_idx" ON "transactions" USING btree ("recurring_rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_fingerprint_uq" ON "transactions" USING btree ("account_id","fingerprint") WHERE "transactions"."fingerprint" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_external_uq" ON "transactions" USING btree ("account_id","external_id") WHERE "transactions"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "two_factors_user_idx" ON "two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");