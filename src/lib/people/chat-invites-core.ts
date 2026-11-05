import type { LooseDb } from "../supabase/loose.ts";
import type { TelegramBot } from "../integrations/telegram-bot.ts";
import { chatsForRole, type ChatRow } from "../integrations/telegram-membership.ts";
import { buildInviteMessage, MESSAGE_MARKER, type InviteLink } from "./chat-invites-message.ts";

type Journal = { chat_id: string; result: string; detail: string | null };

/**
 * Creates one-time invite links for the chats of the role and posts one message with
 * buttons to the invitations chat. Idempotent per (account, eventKey): links already
 * created are reused, and a message already sent is not sent again.
 * Throws when something is not confirmed, so the caller's job is retried.
 */
export async function runChatInvites(db: LooseDb, bot: TelegramBot | null, { accountId, userId, roleId, name, eventKey, allowPartial }: {
  accountId: string; userId: string; roleId: string | null; name: string; eventKey: string;
  /** Send the links that succeeded (and list the failed chats) instead of retrying. */
  allowPartial: boolean;
}) {
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
    // roles carry no account_id: a role is system-wide (venue_id null) or belongs to a venue of some account.
    const role = await db.from<{ name: string; venue_id: string | null }>("roles").select("name,venue_id").eq("id", roleId).maybeSingle();
    if (role.error) throw new Error(role.error.message);
    let inAccount = !!role.data;
    if (role.data?.venue_id) {
      const venue = await db.from<{ id: string }>("venues").select("id").eq("id", role.data.venue_id).eq("account_id", accountId).maybeSingle();
      if (venue.error) throw new Error(venue.error.message);
      inAccount = !!venue.data;
    }
    roleName = inAccount ? role.data?.name ?? null : null;
  }

  const links: InviteLink[] = [];
  const failures: Array<{ title: string; detail: string }> = [];
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
      failures.push({ title, detail });
    }
  }
  // Early attempts retry on a transient blip; later ones send what exists and name the failed chats.
  if (failures.length && !allowPartial)
    throw new Error(`Не удалось создать приглашения: ${failures.map(f => `${f.title}: ${f.detail}`).join("; ")}`);

  const message = buildInviteMessage(name, roleName, links, failures.map(f => f.title));
  const sent = await bot.sendMessage(bot.invitesChatId, message.text, message.buttons);
  if (!sent.ok) throw new Error(sent.description ?? "Telegram не подтвердил отправку приглашений");
  await record(MESSAGE_MARKER, "invited", null);
}
