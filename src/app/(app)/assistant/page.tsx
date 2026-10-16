import type { Metadata } from "next";
import { requireContext } from "@/server/auth/session";
import { aiConfigured } from "@/server/ai/assistant";
import { AssistantChat } from "./assistant-chat";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const { user, prefs, currency } = await requireContext();
  return <AssistantChat name={user.name.split(" ")[0]} currency={currency} aiEnabled={prefs.aiEnabled} aiConfigured={aiConfigured()} />;
}
