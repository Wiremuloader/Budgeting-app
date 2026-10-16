import { AppShell } from "@/components/shell/app-shell";
import { requireContext } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { listAccounts } from "@/server/services/accounts";
import { listCategories } from "@/server/services/categories";
import { unreadCount } from "@/server/services/notifications";
import type { PickerData } from "@/components/transactions/types";
import { SampleBanner } from "@/components/sample-banner";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, today, currency } = await requireContext();
  const db = await getDb();
  const [accounts, categories, unread] = await Promise.all([listAccounts(db, user.id), listCategories(db, user.id), unreadCount(db, user.id)]);
  const pickers: PickerData = {
    today,
    currency,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, onBudget: a.onBudget })),
    categories: categories.map((c) => ({ id: c.id, name: c.name, group: c.group, parentId: c.parentId, systemKey: c.systemKey })),
  };
  return (
    <AppShell user={{ name: user.name, email: user.email }} pickers={pickers} unread={unread}>
      {accounts.some((a) => a.isSample) && <SampleBanner />}
      {children}
    </AppShell>
  );
}
