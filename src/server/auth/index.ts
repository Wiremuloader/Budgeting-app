import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins/two-factor";
import { getDb, type Database } from "../db";
import { authAccounts, sessions, twoFactors, users, verifications } from "../db/schema";
import { emailConfigured, getMailer } from "../mail";
import { ensureUserBootstrap } from "../services/bootstrap";
import { log, errorFields } from "../log";

/**
 * Authentication is delegated to Better Auth (email + password with scrypt hashing,
 * database sessions in HttpOnly cookies, email verification, password reset,
 * TOTP two-factor with backup codes, session revocation, account deletion).
 * Ledger never implements its own password handling.
 */

function createAuth(db: Database) {
  const requireVerification = process.env.REQUIRE_EMAIL_VERIFICATION === "true";
  return betterAuth({
    appName: "Ledger",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: users, session: sessions, account: authAccounts, verification: verifications, twoFactor: twoFactors },
    }),
    advanced: {
      database: { generateId: () => crypto.randomUUID() },
      useSecureCookies: process.env.NODE_ENV === "production",
      cookiePrefix: "ledger",
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: requireVerification,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await getMailer().send({
          to: user.email,
          subject: "Reset your Ledger password",
          text: `Someone asked to reset the password for your Ledger account.\n\nReset it here (valid for 1 hour):\n${url}\n\nIf this wasn't you, you can ignore this email.`,
        });
      },
    },
    emailVerification: {
      // Only send when it can be delivered (or the dev console mailer is active) or verification is mandatory.
      sendOnSignUp: requireVerification || emailConfigured() || process.env.NODE_ENV !== "production",
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await getMailer().send({
          to: user.email,
          subject: "Verify your email for Ledger",
          text: `Welcome to Ledger.\n\nConfirm your email address:\n${url}\n\nThis link expires in 1 hour.`,
        });
      },
    },
    user: {
      deleteUser: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15, // sensitive actions (delete account) need a recent sign-in
    },
    rateLimit: {
      enabled: process.env.DISABLE_AUTH_RATE_LIMIT !== "true",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/request-password-reset": { window: 300, max: 3 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try {
              await ensureUserBootstrap(db, user.id);
            } catch (e) {
              log.error("auth.bootstrap_failed", errorFields(e));
            }
          },
        },
      },
    },
    plugins: [twoFactor({ issuer: "Ledger" }), nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const g = globalThis as unknown as { __ledgerAuth?: Promise<Auth> };

export function getAuth(): Promise<Auth> {
  g.__ledgerAuth ??= getDb().then(createAuth);
  return g.__ledgerAuth;
}

/** Test hook: build auth against a specific database. */
export function createAuthForTesting(db: Database): Auth {
  return createAuth(db);
}
