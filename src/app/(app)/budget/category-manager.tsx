"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Input, Select } from "@/components/ui/primitives";
import { Switch } from "@/components/ui/overlay";
import { archiveCategoryAction, createCategoryAction, reorderCategoriesAction, updateCategoryAction } from "@/server/actions/finance";

export interface ManagedCategory {
  id: string;
  name: string;
  group: "income" | "expense";
  archived: boolean;
  rollover: boolean;
  parentId: string | null;
  alertThresholdBps: number;
}

export function CategoryManager({ categories }: { categories: ManagedCategory[] }) {
  const router = useRouter();
  const [group, setGroup] = React.useState<"expense" | "income">("expense");
  const [newName, setNewName] = React.useState("");
  const [newParent, setNewParent] = React.useState("");
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);
  const list = categories.filter((c) => c.group === group && (showArchived || !c.archived));
  const active = list.filter((c) => !c.archived);

  async function act<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>, msg?: string) {
    const r = await p;
    if (!r.ok) {
      toast.error(r.error);
      return false;
    }
    if (msg) toast.success(msg);
    router.refresh();
    return true;
  }

  async function moveBy(id: string, delta: number) {
    const ids = active.map((c) => c.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const others = categories.filter((c) => c.group !== group || c.archived).map((c) => c.id);
    await act(reorderCategoriesAction({ ids: [...ids, ...others] }));
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Category group" className="inline-flex rounded-lg bg-surface-2 p-0.5 text-[13px]">
          {(["expense", "income"] as const).map((g) => (
            <button key={g} role="radio" aria-checked={group === g} onClick={() => setGroup(g)} className={cn("rounded-md px-3 py-1.5 font-medium", group === g ? "bg-surface shadow-card" : "text-muted")}>
              {g === "expense" ? "Spending" : "Income"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          <Switch checked={showArchived} onCheckedChange={setShowArchived} label="Show archived" /> Show archived
        </label>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newName.trim()) return;
          if (await act(createCategoryAction({ name: newName, group, parentId: newParent || null }), `Added “${newName.trim()}”`)) {
            setNewName("");
            setNewParent("");
          }
        }}
      >
        <Input aria-label="New category name" placeholder="New category name" value={newName} onChange={(e) => setNewName(e.target.value)} className="min-w-40 flex-1" maxLength={60} />
        <Select aria-label="Parent category" value={newParent} onChange={(e) => setNewParent(e.target.value)} className="w-auto">
          <option value="">Top level</option>
          {active
            .filter((c) => !c.parentId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                Inside {c.name}
              </option>
            ))}
        </Select>
        <Button type="submit" variant="primary" disabled={!newName.trim()}>
          <Plus /> Add
        </Button>
      </form>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {list.map((c) => {
          const idx = active.findIndex((a) => a.id === c.id);
          return (
            <li key={c.id} className={cn("flex flex-wrap items-center gap-2 px-3 py-2", c.archived && "opacity-60")}>
              {editing === c.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await act(updateCategoryAction({ id: c.id, name: editName }))) setEditing(null);
                  }}
                >
                  <Input aria-label={`Rename ${c.name}`} value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus className="h-8" maxLength={60} />
                  <Button type="submit" size="icon-sm" variant="primary" aria-label="Save name">
                    <Check />
                  </Button>
                </form>
              ) : (
                <span className={cn("flex-1 truncate text-sm", c.parentId && "pl-4 text-text-2")}>
                  {c.parentId && "↳ "}
                  {c.name}
                  {c.archived && (
                    <Badge tone="outline" className="ml-2">
                      Archived
                    </Badge>
                  )}
                </span>
              )}
              {group === "expense" && !c.archived && (
                <label className="flex items-center gap-1.5 text-[12px] text-muted" title="Carry unspent money into next month (envelope budgeting)">
                  <Switch checked={c.rollover} onCheckedChange={(v) => act(updateCategoryAction({ id: c.id, rollover: v }))} label={`Roll over ${c.name}`} />
                  Rollover
                </label>
              )}
              {!c.archived && (
                <>
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${c.name} up`} disabled={idx <= 0} onClick={() => moveBy(c.id, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${c.name} down`} disabled={idx === active.length - 1} onClick={() => moveBy(c.id, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Rename ${c.name}`}
                    onClick={() => {
                      setEditing(c.id);
                      setEditName(c.name);
                    }}
                  >
                    <Pencil />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={c.archived ? `Restore ${c.name}` : `Archive ${c.name}`}
                onClick={() => act(archiveCategoryAction({ id: c.id, archived: !c.archived }), c.archived ? "Restored" : "Archived — past transactions keep this category")}
              >
                {c.archived ? <ArchiveRestore /> : <Archive />}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
