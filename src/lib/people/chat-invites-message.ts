// Pure builder for the chat-invitations message (no I/O, testable).

export type InviteLink = { title: string; url: string };
export type InviteMessage = { text: string; buttons?: Array<Array<{ text: string; url: string }>> };

/** Journal chat_id of the marker row meaning "the invitations message was sent". */
export const MESSAGE_MARKER = "*message*";

/** Shown when the bot could not lift chat bans: the employee card has no Telegram ID. */
export const NO_UNBAN_HINT =
  "Telegram ID в карточке не указан. Если ссылка пишет, что срок действия истёк, сотрудник заблокирован в чате: укажите Telegram ID и отправьте приглашения заново — бот снимет блокировку.";

export function buildInviteMessage(
  name: string,
  roleName: string | null,
  links: InviteLink[],
  failedChats: string[] = [],
  { unbanned = true }: { unbanned?: boolean } = {},
): InviteMessage {
  const position = roleName?.trim() || "без должности";
  const failed = failedChats.length ? `\nНе удалось создать приглашение: ${failedChats.join(", ")}` : "";
  if (!links.length && !failedChats.length) return { text: `Для должности ${position} нет чатов с приглашениями (${name})` };
  const hint = links.length && !unbanned ? `\n\n${NO_UNBAN_HINT}` : "";
  return {
    text: `Приглашения для ${name} (${position}). Перешлите сотруднику; Telegram даёт вступать в 2–3 чата в минуту.${failed}${hint}`,
    ...(links.length ? { buttons: links.map(l => [{ text: l.title, url: l.url }]) } : {}),
  };
}
