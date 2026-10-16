import "server-only";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, type Database } from "../db";
import { requireContext } from "../auth/session";
import { ServiceError } from "../services/common";
import { log, errorFields } from "../log";
import { unstable_rethrow } from "next/navigation";
import { rateLimit } from "../rate-limit";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type ActionContext = Awaited<ReturnType<typeof requireContext>> & { db: Database };

/**
 * Wrapper for every server action:
 *   1. authenticate (requireContext redirects when signed out),
 *   2. validate input with zod (never trust the client),
 *   3. run the service with the authenticated user's id,
 *   4. revalidate affected pages,
 *   5. turn expected errors into messages; log unexpected ones without user data.
 */
export async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (ctx: ActionContext, data: z.infer<S>) => Promise<T>,
  opts: { revalidate?: string[]; limit?: { key: string; max: number; windowMs: number } } = {},
): Promise<ActionResult<T>> {
  try {
    const ctx = await requireContext();
    if (opts.limit) {
      const r = rateLimit(`${opts.limit.key}:${ctx.user.id}`, opts.limit.max, opts.limit.windowMs);
      if (!r.ok) return { ok: false, error: `Too many requests. Try again in ${r.retryAfterSeconds}s.` };
    }
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".") || "_"] ??= issue.message;
      return { ok: false, error: Object.values(fieldErrors)[0] ?? "Invalid input", fieldErrors };
    }
    const db = await getDb();
    const data = await fn({ ...ctx, db }, parsed.data);
    for (const p of opts.revalidate ?? ["layout"]) {
      if (p === "layout") revalidatePath("/", "layout");
      else revalidatePath(p);
    }
    return { ok: true, data };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ServiceError) return { ok: false, error: e.message };
    log.error("action.failed", errorFields(e));
    return { ok: false, error: "Something went wrong. Your data hasn't been changed — please try again." };
  }
}

/* Shared zod pieces */
export const zId = z.uuid();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
export const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month");
export const zCents = z.number().int().refine(Number.isSafeInteger, "Amount out of range");
