// Dismissal step: remove a person from every organization Telegram chat.
// I/O goes through an injected transport so the decisions are testable.
import { classifyChatMember } from "../integrations/telegram-membership.ts";

export type RemovalResult = "removed" | "absent" | "unconfirmed" | "error";
export type ChatOutcome = { chat_id: string; title: string; result: RemovalResult; detail: string | null };
type ApiResult = { ok: boolean; result?: { status?: string; is_member?: boolean }; description?: string };
export type TelegramRemovalTransport = {
  getChatMember: (chatId: string, userId: number) => Promise<ApiResult>;
  banChatMember: (chatId: string, userId: number) => Promise<{ ok: boolean; description?: string }>;
  unbanChatMember: (chatId: string, userId: number) => Promise<{ ok: boolean; description?: string }>;
  /** Journal write (idempotent upsert per chat). */
  record: (outcome: ChatOutcome) => Promise<void>;
  /** Lease heartbeat before each chat: proves the job is still ours before a ban. */
  save?: () => Promise<void>;
};
/** Journal chat_id for a step that could not reach any chat (nothing configured to iterate). */
export const ALL_CHATS = "*";
const FINAL: RemovalResult[] = ["removed", "absent"];

export const MISSING_TELEGRAM_ID = "Нет Telegram ID — заполните в карточке и нажмите «Повторить»";
export const INVALID_TELEGRAM_ID = "Некорректный Telegram ID — исправьте в карточке и нажмите «Повторить»";
export const NOT_UNBANNED = "Исключён, но не разблокирован — повтор";

/**
 * The Telegram step applies unless the organization has neither a bot nor any
 * active chat: then there is nothing to remove the person from. With chats
 * configured, a missing bot or Telegram ID stays "unconfirmed".
 */
export const telegramStepApplies = ({ configured, chats }: { configured: boolean; chats: unknown[] }) =>
  configured || chats.length > 0;

/** `retry`: an earlier attempt for this chat banned the person but did not confirm the unban. */
async function removeFromChat(chat: { chat_id: string; title: string }, userId: number, t: TelegramRemovalTransport, retry: boolean): Promise<ChatOutcome> {
  const outcome = (result: RemovalResult, detail: string | null = null) => ({ chat_id: chat.chat_id, title: chat.title, result, detail });
  // Unban lets the person rejoin later by a fresh invite; it does not re-add them.
  // Only a confirmed unban finalizes: otherwise we would leave a permanent, invisible ban.
  // Called only once our ban is confirmed (or left by our own earlier attempt): from here any
  // failure — non-ok or a thrown timeout — keeps the NOT_UNBANNED marker, so the retry unbans
  // instead of classifying the kicked person as "absent" and leaving a permanent ban.
  const unbanAndConfirm = async () => {
    try {
      const unban = await t.unbanChatMember(chat.chat_id, userId);
      if (!unban.ok) return outcome("error", NOT_UNBANNED);
      const after = await t.getChatMember(chat.chat_id, userId);
      if (after.result?.status === "kicked") return outcome("error", NOT_UNBANNED);
      if (classifyChatMember(after) !== "absent") return outcome("unconfirmed", "После исключения участник всё ещё в чате");
      return outcome("removed");
    } catch {
      return outcome("error", NOT_UNBANNED);
    }
  };
  try {
    const before = await t.getChatMember(chat.chat_id, userId);
    // A ban left by our own earlier attempt is finished here; a foreign ban is just "absent".
    if (retry && before.ok && before.result?.status === "kicked") return await unbanAndConfirm();
    const status = classifyChatMember(before);
    if (status === "absent") return outcome("absent");
    if (status === "unknown") return outcome("unconfirmed", before.description ?? "Telegram не подтвердил участие в чате");
    const ban = await t.banChatMember(chat.chat_id, userId);
    if (!ban.ok) return outcome("error", ban.description ?? "Telegram не исключил участника");
    return await unbanAndConfirm();
  } catch (error) {
    return outcome("error", error instanceof Error ? error.message.slice(0, 300) : "Ошибка Telegram");
  }
}

/**
 * Removes the person from each chat. Chats whose journal already says removed/absent
 * are not touched again. Without a bot or a valid Telegram ID nothing is proven, so the
 * result is "unconfirmed" — even with zero chats, the step must not pass silently. The
 * caller decides applicability first (`telegramStepApplies`: no bot and no chats → skipped)
 * and passes the ID snapshotted on the job, never the live profile.
 */
export async function removeFromTelegramChats({ configured, telegramId, chats, previous, transport }: {
  configured: boolean;
  telegramId: string | null;
  chats: Array<{ chat_id: string; title: string }>;
  previous: Array<{ chat_id: string; result: string; detail?: string | null }>;
  transport: TelegramRemovalTransport;
}): Promise<ChatOutcome[]> {
  const id = telegramId?.trim() ?? "";
  const userId = /^\d{1,15}$/.test(id) ? Number(id) : null;
  const blocked = !configured ? "Telegram не настроен"
    : !id ? MISSING_TELEGRAM_ID
    : userId === null ? INVALID_TELEGRAM_ID : null;
  const outcomes: ChatOutcome[] = [];
  if (blocked) {
    const targets = chats.length ? chats : [{ chat_id: ALL_CHATS, title: "Все чаты" }];
    for (const chat of targets) {
      const o: ChatOutcome = { chat_id: chat.chat_id, title: chat.title, result: "unconfirmed", detail: blocked };
      await transport.record(o);
      outcomes.push(o);
    }
    return outcomes;
  }
  const done = new Map(previous.filter(p => FINAL.includes(p.result as RemovalResult)).map(p => [p.chat_id, p.result as RemovalResult]));
  // Only our own unconfirmed unban justifies unbanning a "kicked" member; any other ban is foreign.
  const pending = new Set(previous.filter(p => !FINAL.includes(p.result as RemovalResult) && p.detail === NOT_UNBANNED).map(p => p.chat_id));
  for (const chat of chats) {
    const prior = done.get(chat.chat_id);
    if (prior) { outcomes.push({ chat_id: chat.chat_id, title: chat.title, result: prior, detail: null }); continue; }
    await transport.save?.();
    const o = await removeFromChat(chat, userId!, transport, pending.has(chat.chat_id));
    await transport.record(o);
    outcomes.push(o);
  }
  return outcomes;
}

const LABEL: Record<RemovalResult, string> = {
  removed: "исключён", absent: "уже не состоял", unconfirmed: "не подтверждено", error: "ошибка",
};
const line = (o: ChatOutcome) => `${o.title || o.chat_id} — ${LABEL[o.result]}`;

/** Chats without a final result, for the dismissal error text. */
export function unconfirmedChats(outcomes: ChatOutcome[]) {
  return outcomes.filter(o => !FINAL.includes(o.result)).map(line).join("; ");
}

/** Message for the organization reports chat once the dismissal is complete. */
export function terminationReport(name: string, outcomes: ChatOutcome[], writtenOff: number[], telegramId: string | null = null) {
  const bonus = writtenOff.reduce((a, b) => a + b, 0);
  return [
    `Сотрудник уволен: ${name}`,
    ...(telegramId ? [`Telegram ID: ${telegramId}`] : []),
    outcomes.length ? "Чаты:\n" + outcomes.map(o => "• " + line(o)).join("\n") : "Чаты: нет чатов организации",
    // Only dismissals started before the write-off was removed can carry an amount.
    ...(bonus > 0 ? [`Списано бонусов: ${bonus.toLocaleString("ru-RU")}`] : []),
  ].join("\n");
}
