import type { TransactionFilters, TypeFilter } from "@/server/services/transactions";
import { isValidDate } from "@/domain/dates";
import { isUuid } from "@/server/services/common";
import { parseAmount } from "@/domain/money";

const TYPES: TypeFilter[] = ["income", "expense", "refund", "transfer", "adjustment", "uncategorised"];
const SORTS = ["date_desc", "date_asc", "amount_desc", "amount_asc", "merchant"] as const;

export function parseFilters(sp: Record<string, string | undefined>): TransactionFilters {
  const amt = (v?: string) => {
    if (!v) return undefined;
    try {
      return Math.abs(parseAmount(v));
    } catch {
      return undefined;
    }
  };
  return {
    q: sp.q?.slice(0, 80) || undefined,
    from: sp.from && isValidDate(sp.from) ? sp.from : undefined,
    to: sp.to && isValidDate(sp.to) ? sp.to : undefined,
    accountId: isUuid(sp.account) ? sp.account : undefined,
    categoryId: sp.category === "none" ? "none" : isUuid(sp.category) ? sp.category : undefined,
    type: TYPES.includes(sp.type as TypeFilter) ? (sp.type as TypeFilter) : undefined,
    status: sp.status === "pending" || sp.status === "cleared" || sp.status === "reconciled" ? sp.status : undefined,
    reviewed: sp.reviewed === "no" ? false : sp.reviewed === "yes" ? true : undefined,
    minAmount: amt(sp.min),
    maxAmount: amt(sp.max),
    tag: sp.tag?.slice(0, 32) || undefined,
    sort: SORTS.includes(sp.sort as (typeof SORTS)[number]) ? (sp.sort as (typeof SORTS)[number]) : "date_desc",
    page: Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1),
    pageSize: 50,
  };
}
