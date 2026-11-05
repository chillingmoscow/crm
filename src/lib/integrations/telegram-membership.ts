// Pure Telegram decisions: who is in a chat, which chats a role gets, and
// whether a removal is proven. No I/O, so it can be tested without the app.

export type MemberStatus = "member" | "absent" | "unknown";

type GetChatMemberResponse = {
  ok: boolean;
  result?: { status?: string; is_member?: boolean };
  description?: string;
};

/** Maps a Bot API getChatMember answer. Anything not proven stays "unknown". */
export function classifyChatMember(apiResult: GetChatMemberResponse): MemberStatus {
  if (!apiResult.ok || !apiResult.result) return "unknown";
  const { status, is_member } = apiResult.result;
  switch (status) {
    case "creator":
    case "administrator":
    case "member":
      return "member";
    case "left":
    case "kicked":
      return "absent";
    case "restricted":
      // A restricted user may still be in the chat; is_member says which.
      if (is_member === true) return "member";
      if (is_member === false) return "absent";
      return "unknown";
    default:
      return "unknown";
  }
}

export type ChatRow = {
  chat_id: string;
  title: string;
  invite: boolean;
  role_ids: string[];
  archived_at: string | null;
};

/** Chats to invite a person with the given role to; empty role_ids means every role. */
export function chatsForRole(chats: ChatRow[], roleId: string | null): ChatRow[] {
  return chats.filter(c =>
    c.invite && !c.archived_at && (c.role_ids.length === 0 || (roleId !== null && c.role_ids.includes(roleId))));
}

/** A dismissal is complete only when every chat ended removed or already absent. */
export function removalComplete(results: Array<"removed" | "absent" | "unconfirmed" | "error">): boolean {
  return results.every(r => r === "removed" || r === "absent");
}
