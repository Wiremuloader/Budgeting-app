export interface PickerAccount {
  id: string;
  name: string;
  type: string;
  currency: string;
  onBudget: boolean;
}

export interface PickerCategory {
  id: string;
  name: string;
  group: "income" | "expense";
  parentId: string | null;
  systemKey: string | null;
}

export interface PickerData {
  today: string;
  currency: string;
  accounts: PickerAccount[];
  categories: PickerCategory[];
}

/** Shape the transaction form needs to edit an existing transaction. */
export interface EditableTransaction {
  id: string;
  accountId: string;
  date: string;
  time: string | null;
  amount: number;
  merchant: string;
  notes: string | null;
  categoryId: string | null;
  status: "pending" | "cleared" | "reconciled";
  tags: string[];
  kind: "standard" | "transfer" | "adjustment";
  splits: { categoryId: string; amount: number; notes: string | null }[];
  transferCounterpart: { accountId: string; accountName: string } | null;
  updatedAt: string;
}
