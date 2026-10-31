type DestinationSettings = { default_chat_id: string | null; candidate_chat_id: string | null };
/** Clearing an override selects the organization chat, never a stale legacy chat. */
export function telegramDestination(kind: "notify" | "hired", organization: DestinationSettings | null, legacyChat: string | null) {
  if (kind === "hired") return organization?.default_chat_id || legacyChat;
  return organization ? organization.candidate_chat_id || organization.default_chat_id : legacyChat;
}
