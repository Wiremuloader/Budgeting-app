"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { EmptyState, buttonStyles } from "@/components/ui/primitives";
import { TransactionForm } from "./transaction-form";
import type { EditableTransaction, PickerData } from "./types";
import Link from "next/link";
import { Landmark } from "lucide-react";

interface QuickAddState {
  open: (opts?: { edit?: EditableTransaction; accountId?: string }) => void;
  pickers: PickerData;
}

const Ctx = React.createContext<QuickAddState | null>(null);

export function useQuickAdd() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error("useQuickAdd outside provider");
  return c;
}

export function QuickAddProvider({ pickers, children }: { pickers: PickerData; children: React.ReactNode }) {
  const [state, setState] = React.useState<{ open: boolean; edit?: EditableTransaction; accountId?: string; key: number }>({ open: false, key: 0 });
  const value = React.useMemo<QuickAddState>(
    () => ({ pickers, open: (opts) => setState((s) => ({ open: true, edit: opts?.edit, accountId: opts?.accountId, key: s.key + 1 })) }),
    [pickers],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={state.open} onOpenChange={(o) => setState((s) => ({ ...s, open: o }))}>
        <DialogContent title={state.edit ? "Edit transaction" : "Add transaction"} description={state.edit ? undefined : "Record money in, out, or between your accounts."}>
          {pickers.accounts.length === 0 ? (
            <EmptyState
              icon={<Landmark />}
              title="Add an account first"
              action={
                <Link href="/accounts?new=1" className={buttonStyles({ variant: "primary" })} onClick={() => setState((s) => ({ ...s, open: false }))}>
                  Add account
                </Link>
              }
            >
              Transactions belong to an account, like your everyday bank account or a credit card.
            </EmptyState>
          ) : (
            <TransactionForm key={state.key} pickers={pickers} initial={state.edit} defaultAccountId={state.accountId} onDone={() => setState((s) => ({ ...s, open: false }))} />
          )}
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}
