import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { TOOLS, toolByName, type BudgetProposal, type ToolContext } from "./tools";
import { offlineAnswer } from "./fallback";
import { log, errorFields } from "../log";

/**
 * Assistant orchestration.
 *
 *   question → model chooses validated read-only tools → tools call the same
 *   services as the UI → model explains the returned figures.
 *
 * The model never sees raw database rows or identifiers beyond what tools return,
 * never performs authoritative arithmetic (tools return formatted results), and has
 * no tool that changes data. Budget changes come back as proposals that the user
 * confirms in the UI through an authorised server action.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ToolTrace {
  name: string;
  input: unknown;
  summary: string;
  ok: boolean;
}

export interface AssistantReply {
  answer: string;
  tools: ToolTrace[];
  proposals: BudgetProposal[];
  mode: "ai" | "direct";
  notice?: string;
}

const MAX_TOOL_ROUNDS = 6;

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function systemPrompt(ctx: ToolContext): string {
  return [
    "You are Ledger's budgeting assistant. You help one user understand their own money using the tools provided.",
    `Today is ${ctx.today} (${ctx.prefs.timezone}). The user's main currency is ${ctx.prefs.currency}.`,
    "",
    "How to answer:",
    "- Get every figure from a tool. Never estimate, invent or recompute balances, totals or dates yourself; quote the formatted values the tools return. If a needed figure isn't available from a tool, say so.",
    "- Say which period and assumptions a figure is based on. Label projections and forecasts as estimates.",
    "- Keep facts (recorded transactions), estimates (forecasts, projections) and suggestions clearly separate.",
    "- Don't assume income that isn't recorded or scheduled. Don't fabricate transactions.",
    "- You cannot change the user's data. To suggest a budget change, call propose_budget_change; the user must confirm it themselves.",
    "- Give general budgeting guidance only. You are not a licensed financial adviser: don't recommend specific investments, tax positions or regulated financial products — suggest a qualified adviser for those.",
    "- Be concise and plain-spoken. Use short paragraphs or a brief list; no tables unless comparing several items.",
  ].join("\n");
}

function toolDefinitions(): Anthropic.Tool[] {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool.InputSchema };
  });
}

async function runTool(ctx: ToolContext, block: Anthropic.ToolUseBlock, traces: ToolTrace[], proposals: BudgetProposal[]): Promise<Anthropic.ToolResultBlockParam> {
  const tool = toolByName(block.name);
  if (!tool) {
    traces.push({ name: block.name, input: block.input, summary: "Unknown tool", ok: false });
    return { type: "tool_result", tool_use_id: block.id, content: "Unknown tool", is_error: true };
  }
  const parsed = tool.input.safeParse(block.input);
  if (!parsed.success) {
    traces.push({ name: block.name, input: block.input, summary: "Invalid input", ok: false });
    return { type: "tool_result", tool_use_id: block.id, content: `Invalid input: ${parsed.error.message}`, is_error: true };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await tool.run(ctx, parsed.data as any);
    traces.push({ name: block.name, input: parsed.data, summary: out.summary, ok: true });
    if (out.proposal) proposals.push(out.proposal);
    return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(out.result) };
  } catch (e) {
    log.warn("assistant.tool_failed", { tool: block.name, ...errorFields(e) });
    traces.push({ name: block.name, input: parsed.data, summary: "Tool failed", ok: false });
    return { type: "tool_result", tool_use_id: block.id, content: `The tool failed: ${(e as Error).message}`, is_error: true };
  }
}

export async function askAssistant(ctx: ToolContext, history: ChatTurn[]): Promise<AssistantReply> {
  const question = history.filter((h) => h.role === "user").at(-1)?.content ?? "";
  if (!aiConfigured()) {
    return offlineAnswer(ctx, question, "AI isn't configured on this server, so this answer comes directly from Ledger's calculations.");
  }

  const client = new Anthropic();
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
  const tools = toolDefinitions();
  const traces: ToolTrace[] = [];
  const proposals: BudgetProposal[] = [];
  const messages: Anthropic.Beta.BetaMessageParam[] = history.slice(-12).map((h) => ({ role: h.role, content: h.content }));

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: [{ type: "text", text: systemPrompt(ctx), cache_control: { type: "ephemeral" } }],
        tools: tools as Anthropic.Beta.BetaTool[],
        messages,
        output_config: { effort: "medium" },
        // Server-side fallback: if a request is declined by a safety classifier, it's retried on a suitable model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });

      if (response.stop_reason === "refusal") {
        return { answer: "I can't help with that request. I can answer questions about your budget, spending, bills, goals and debts.", tools: traces, proposals, mode: "ai" };
      }
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      if (response.stop_reason !== "tool_use") {
        return { answer: text || "I couldn't produce an answer. Please try rephrasing.", tools: traces, proposals, mode: "ai" };
      }
      if (round === MAX_TOOL_ROUNDS) break;
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      messages.push({ role: "assistant", content: response.content });
      const results = await Promise.all(uses.map((u) => runTool(ctx, u as unknown as Anthropic.ToolUseBlock, traces, proposals)));
      messages.push({ role: "user", content: results });
    }
    return { answer: "That question needed more steps than I can take at once. Try asking something narrower.", tools: traces, proposals, mode: "ai" };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) log.warn("assistant.rate_limited");
    else if (e instanceof Anthropic.APIError) log.error("assistant.api_error", { status: e.status });
    else log.error("assistant.failed", errorFields(e));
    return offlineAnswer(ctx, question, "The AI service is unavailable right now, so this answer comes directly from Ledger's calculations.");
  }
}
