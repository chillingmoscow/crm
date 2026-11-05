import "server-only";
import type { LooseDb } from "@/lib/supabase/loose";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { chatsForRole, type ChatRow } from "@/lib/integrations/telegram-membership";
import { buildInviteMessage, MESSAGE_MARKER, type InviteLink } from "./chat-invites-message";

type Journal = { chat_id: string; result: string; detail: string | null };

/**
 * Creates one-time invite links for the chats of the role and posts one message with
 * buttons to the invitations chat. Idempotent per (account, eventKey): links already
 * created are reused, and a message already sent is not sent again.
 * Throws when something is not confirmed, so the caller's job is retried.
 */
export async function sendChatInvites(db: LooseDb, { accountId, userId, roleId, name, eventKey }: {
  accountId: string; userId: string; roleId: string | null; name: string; eventKey: string;
}) {
  const bot = await loadTelegramBot(db, accountId);
  if (!bot) throw new Error("Настройте Telegram-бота для приглашений в чаты");
  if (!bot.invitesChatId) throw new Error("Укажите чат для приглашений в настройках Telegram");

  const journal = await db.from<Journal[]>("staff_telegram_actions").select("chat_id,result,detail")
    .eq("account_id", accountId).eq("event_key", eventKey);
  if (journal.error) throw new Error(journal.error.message);
  const prior = new Map((journal.data ?? []).map(r => [r.chat_id, r]));
  if (prior.get(MESSAGE_MARKER)?.result === "invited") return;

  const record = async (chatId: string, result: "invited" | "error", detail: string | null) => {
    const r = await db.from("staff_telegram_actions").upsert(
      { account_id: accountId, user_id: userId, kind: "invite", event_key: eventKey, chat_id: chatId, result, detail },
      { onConflict: "account_id,event_key,chat_id" });
    if (r.error) throw new Error(r.error.message);
  };

  const chatsRes = await db.from<ChatRow[]>("telegram_chats").select("chat_id,title,invite,role_ids,archived_at")
    .eq("account_id", accountId).is("archived_at", null).order("title");
  if (chatsRes.error) throw new Error(chatsRes.error.message);
  const chats = chatsForRole(chatsRes.data ?? [], roleId);

  let roleName: string | null = null;
  if (roleId) {
    const role = await db.from<{ name: string }>("roles").select("name").eq("id", roleId).maybeSingle();
    if (role.error) throw new Error(role.error.message);
    roleName = role.data?.name ?? null;
  }

  const links: InviteLink[] = [];
  const failures: string[] = [];
  for (const chat of chats) {
    const title = chat.title || chat.chat_id;
    const existing = prior.get(chat.chat_id);
    if (existing?.result === "invited" && existing.detail) { links.push({ title, url: existing.detail }); continue; }
    try {
      const res = await bot.createChatInviteLink(chat.chat_id, name);
      const url = res.result?.invite_link;
      if (!res.ok || !url) throw new Error(res.description ?? "Telegram не создал ссылку");
      await record(chat.chat_id, "invited", url);
      links.push({ title, url });
    } catch (e) {
      const detail = e instanceof Error ? e.message.slice(0, 300) : "Ошибка Telegram";
      await record(chat.chat_id, "error", detail).catch(() => undefined);
      failures.push(`${title}: ${detail}`);
    }
  }
  // Nothing is posted until every link exists, so the employee never gets a partial set silently.
  if (failures.length) throw new Error(`Не удалось создать приглашения: ${failures.join("; ")}`);

  const message = buildInviteMessage(name, roleName, links);
  const sent = await bot.sendMessage(bot.invitesChatId, message.text, message.buttons);
  if (!sent.ok) throw new Error(sent.description ?? "Telegram не подтвердил отправку приглашений");
  await record(MESSAGE_MARKER, "invited", null);
}
