import type { LooseDb } from "../supabase/loose.ts";
import type { TelegramBot } from "../integrations/telegram-bot.ts";
import { MESSAGE_MARKER } from "./chat-invites-message.ts";

type IssuedLink = { id: string; chat_id: string; detail: string | null };

/**
 * Отзывает ссылки-приглашения в Telegram-чаты, выданные сотруднику раньше
 * (найм, добавление, восстановление), и убирает их из журнала: по старым
 * кнопкам больше нельзя вступить, а в карточке видны только новые ссылки.
 * Ссылку, которую Telegram не отозвал (чат удалён, бот больше не админ), тоже
 * убираем — она одноразовая, и вернуть её некуда; такие считаем в `failed`.
 * Строки-отметки «сообщение отправлено» остаются: повтор старого задания
 * ничего не пришлёт заново.
 */
export async function revokeStaffChatInvites(
  db: LooseDb,
  bot: Pick<TelegramBot, "revokeChatInviteLink">,
  accountId: string,
  userId: string,
): Promise<{ revoked: number; failed: number }> {
  const issued = await db
    .from<IssuedLink[]>("staff_telegram_actions")
    .select("id,chat_id,detail")
    .eq("account_id", accountId)
    .eq("user_id", userId)
    .eq("kind", "invite")
    .eq("result", "invited");
  if (issued.error) throw new Error(issued.error.message);
  const links = (issued.data ?? []).filter((row) => row.chat_id !== MESSAGE_MARKER);
  let revoked = 0;
  let failed = 0;
  for (const link of links) {
    let ok = false;
    if (link.detail?.startsWith("https://t.me/")) {
      try {
        ok = (await bot.revokeChatInviteLink(link.chat_id, link.detail)).ok;
      } catch {
        ok = false;
      }
    }
    if (ok) revoked += 1;
    else failed += 1;
  }
  if (links.length) {
    const removed = await db
      .from("staff_telegram_actions")
      .delete()
      .eq("account_id", accountId)
      .in("id", links.map((link) => link.id));
    if (removed.error) throw new Error(removed.error.message);
  }
  return { revoked, failed };
}
