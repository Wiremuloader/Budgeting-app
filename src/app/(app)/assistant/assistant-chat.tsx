"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUp, Bot, Calculator, Check, ShieldCheck, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Alert, Badge, Button, Card, Textarea } from "@/components/ui/primitives";
import { askAssistantAction } from "@/server/actions/settings";
import { applyAllocationsAction } from "@/server/actions/finance";
import type { AssistantReply } from "@/server/ai/assistant";
import { formatMoney } from "@/domain/money";
import { formatMonthKey } from "@/domain/dates";

interface Msg {
  role: "user" | "assistant";
  content: string;
  reply?: AssistantReply;
}

const PROMPTS = [
  "Can I afford to spend $150 this weekend?",
  "Why did I spend more this month?",
  "What are my five largest expense categories?",
  "How much should I set aside before payday?",
  "Which subscriptions cost the most?",
  "What would happen if I cut takeaway by $40 a week?",
  "How much do I need to save each fortnight to reach my Japan trip goal?",
  "Compare my last three months of spending",
];

const TOOL_LABELS: Record<string, string> = {
  get_balances: "Read account balances",
  get_spending_summary: "Summarised income and spending",
  compare_months: "Compared months",
  get_safe_to_spend: "Calculated safe-to-spend",
  check_affordability: "Checked affordability",
  get_upcoming_bills: "Listed upcoming bills",
  get_subscriptions: "Listed subscriptions",
  get_budget_status: "Read your budget",
  get_goals: "Read savings goals",
  simulate_goal_contribution: "Simulated a goal contribution",
  simulate_spending_change: "Simulated a spending change",
  get_cash_flow_forecast: "Ran the cash-flow forecast",
  get_debt_payoff: "Projected debt payoff",
  search_transactions: "Searched transactions",
  propose_budget_change: "Prepared a budget change for your approval",
};

/** Minimal, safe markdown: paragraphs, bullet lists and **bold**. Text is never injected as HTML. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>));
  return (
    <div className="space-y-2.5">
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ""))}</li>)}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-line">
            {inline(b)}
          </p>
        );
      })}
    </div>
  );
}

export function AssistantChat({ name, currency, aiEnabled, aiConfigured }: { name: string; currency: string; aiEnabled: boolean; aiConfigured: boolean }) {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const endRef = React.useRef<HTMLDivElement>(null);
  const live = aiEnabled && aiConfigured;

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    const r = await askAssistantAction({ messages: next.map((m) => ({ role: m.role, content: m.content })) });
    setLoading(false);
    if (!r.ok) {
      setMessages((m) => [...m, { role: "assistant", content: r.error }]);
      return;
    }
    setMessages((m) => [...m, { role: "assistant", content: r.data.answer, reply: r.data }]);
  }

  return (
    <>
      <PageHeader
        title="Assistant"
        description="Ask about your money in plain language. Every figure comes from Ledger’s own calculations."
        actions={<Badge tone={live ? "accent" : "outline"}>{live ? "AI assistant" : "Direct answers mode"}</Badge>}
      />

      {!live && (
        <Alert tone="info" className="mb-4" icon={<Calculator />}>
          {!aiEnabled ? (
            <>AI processing is turned off in <Link href="/settings?tab=privacy" className="underline">Settings</Link>. </>
          ) : (
            <>No AI provider is configured on this server. </>
          )}
          You can still ask common questions — Ledger answers them directly from its calculation engine.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card className="flex min-h-[60dvh] flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-5" aria-live="polite" aria-busy={loading}>
            {messages.length === 0 && (
              <div className="py-6 text-center">
                <span className="mx-auto grid size-11 place-items-center rounded-full bg-accent-soft text-accent"><Sparkles className="size-5" /></span>
                <p className="mt-3 text-lg font-semibold">Kia ora {name}, what would you like to know?</p>
                <div className="mx-auto mt-5 grid max-w-2xl gap-2 sm:grid-cols-2">
                  {PROMPTS.map((p) => (
                    <button key={p} onClick={() => send(p)} className="rounded-lg border border-border px-3 py-2.5 text-left text-[13px] text-text-2 transition-colors hover:border-accent hover:bg-accent-soft/40">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
                <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", m.role === "user" ? "bg-surface-3" : "bg-accent-soft text-accent")} aria-hidden>
                  {m.role === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
                </span>
                <div className={cn("max-w-[85%] text-sm leading-relaxed", m.role === "user" ? "rounded-2xl rounded-tr-sm bg-surface-2 px-4 py-2.5" : "min-w-0 flex-1")}>
                  <span className="sr-only">{m.role === "user" ? "You said:" : "Assistant:"}</span>
                  {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
                  {m.reply && <ReplyMeta reply={m.reply} currency={currency} />}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent"><Bot className="size-4" /></span>
                <p className="flex items-center gap-1 text-sm text-muted">
                  Working it out
                  <span className="inline-flex gap-0.5">
                    <span className="size-1 animate-bounce rounded-full bg-muted" />
                    <span className="size-1 animate-bounce rounded-full bg-muted [animation-delay:120ms]" />
                    <span className="size-1 animate-bounce rounded-full bg-muted [animation-delay:240ms]" />
                  </span>
                </p>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="flex items-end gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <label htmlFor="ask" className="sr-only">Ask a question</label>
            <Textarea
              id="ask"
              rows={1}
              value={input}
              maxLength={4000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder="e.g. How much have I spent on groceries this month?"
              className="max-h-40 min-h-10 resize-none"
            />
            <Button type="submit" variant="primary" size="icon" aria-label="Send" disabled={!input.trim() || loading}>
              <ArrowUp />
            </Button>
          </form>
        </Card>

        <aside className="space-y-4 text-[13px] text-muted">
          <Card className="p-4">
            <p className="flex items-center gap-2 font-medium text-text"><ShieldCheck className="size-4 text-accent" /> How this works</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-4">
              <li>The assistant can only <em>read</em> your data through a fixed set of calculation tools. It can’t move money or change anything.</li>
              <li>Budget changes it suggests appear as a card you must approve.</li>
              <li>Figures come from Ledger’s engine, not the AI’s own arithmetic.</li>
              {live && <li>When AI is on, your question and the tool results it needs (totals, category names, merchant names) are sent to Anthropic to write the answer. Account numbers and passwords are never sent.</li>}
              <li>General budgeting guidance only — not financial advice. For investments, tax or lending decisions, talk to a licensed financial adviser.</li>
            </ul>
            <Link href="/settings?tab=privacy" className="mt-3 inline-block text-accent hover:underline">AI settings</Link>
          </Card>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setMessages([])}>Start a new conversation</Button>
          )}
        </aside>
      </div>
    </>
  );
}

function ReplyMeta({ reply, currency }: { reply: AssistantReply; currency: string }) {
  const router = useRouter();
  const [applied, setApplied] = React.useState<Set<string>>(new Set());
  return (
    <div className="mt-3 space-y-3">
      {reply.notice && <p className="text-xs text-muted">{reply.notice}</p>}
      {reply.proposals.map((p) => {
        const key = `${p.categoryId}:${p.month}`;
        return (
          <div key={key} className="rounded-lg border border-accent/40 bg-accent-soft/40 p-3">
            <p className="text-[13px] font-medium">Suggested change — needs your approval</p>
            <p className="mt-1 text-[13px]">
              Set <strong>{p.categoryName}</strong> for {formatMonthKey(p.month)} from {formatMoney(p.currentAmount, currency)} to <strong>{formatMoney(p.newAmount, currency)}</strong>.
            </p>
            <p className="mt-1 text-xs text-muted">{p.reason}</p>
            <Button
              size="sm"
              variant="primary"
              className="mt-2"
              disabled={applied.has(key)}
              onClick={async () => {
                const r = await applyAllocationsAction({ month: p.month, allocations: [{ categoryId: p.categoryId, amount: p.newAmount }], source: "assistant" });
                if (!r.ok) return toast.error(r.error);
                setApplied((s) => new Set(s).add(key));
                toast.success("Budget updated");
                router.refresh();
              }}
            >
              {applied.has(key) ? <><Check /> Applied</> : "Apply change"}
            </Button>
          </div>
        );
      })}
      {reply.tools.length > 0 && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer select-none">How I worked this out ({reply.tools.length} calculation{reply.tools.length > 1 ? "s" : ""})</summary>
          <ul className="mt-1.5 space-y-0.5">
            {reply.tools.map((t, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {t.ok ? <Check className="size-3 text-positive" /> : <span className="text-negative">✕</span>}
                {TOOL_LABELS[t.name] ?? t.name}
                <span className="text-muted">— {t.summary}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
