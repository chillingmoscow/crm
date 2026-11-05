// Pure builder for the chat-invitations message (no I/O, testable).

export type InviteLink = { title: string; url: string };
export type InviteMessage = { text: string; buttons?: Array<Array<{ text: string; url: string }>> };

/** Journal chat_id of the marker row meaning "the invitations message was sent". */
export const MESSAGE_MARKER = "*message*";

export function buildInviteMessage(name: string, roleName: string | null, links: InviteLink[]): InviteMessage {
  const position = roleName?.trim() || "без должности";
  if (!links.length) return { text: `Для должности ${position} нет чатов с приглашениями (${name})` };
  return {
    text: `Приглашения для ${name} (${position}). Перешлите сотруднику; Telegram даёт вступать в 2–3 чата в минуту.`,
    buttons: links.map(l => [{ text: l.title, url: l.url }]),
  };
}
