"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { checked, integrationInput, integrationScope } from "@/lib/integrations/settings";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";

export type TelegramChatRow = {
  id: string; chat_id: string; title: string; invite: boolean; role_ids: string[]; archived_at: string | null;
};
export type ChatRoleOption = { id: string; label: string };
export type ChatCheck = { tone: "success" | "warning"; message: string };

const columns = "id,chat_id,title,invite,role_ids,archived_at";
const chatSchema = z.object({
  title: z.string().trim().min(1, "Укажите название чата").max(200),
  chat_id: z.string().trim().regex(/^-?\d+$/, "ID чата — число, например -1001234567890"),
  invite: z.boolean(),
  role_ids: z.array(z.string().uuid()).max(200),
});

export async function readTelegramChats() {
  const s = await integrationScope();
  const chats = checked(await s.db.from<TelegramChatRow[]>("telegram_chats").select(columns)
    .eq("account_id", s.accountId).order("title")) ?? [];
  const venues = checked(await s.db.from<{ id: string; name: string; archived_at: string | null }[]>("venues").select("id,name,archived_at")
    .eq("account_id", s.accountId)) ?? [];
  const venueById = new Map(venues.map(v => [v.id, v]));
  const roles = venues.length ? checked(await s.db.from<{ id: string; name: string; venue_id: string; archived_at: string | null }[]>("roles")
    .select("id,name,venue_id,archived_at").in("venue_id", venues.map(v => v.id)).order("name")) ?? [] : [];
  const used = new Set(chats.flatMap(c => c.role_ids));
  const many = venues.filter(v => !v.archived_at).length > 1;
  // Archived roles (or roles of archived venues) stay visible only where a chat still refers to them, so they can be removed.
  const options: ChatRoleOption[] = roles.flatMap(r => {
    const v = venueById.get(r.venue_id), gone = !!r.archived_at || !!v?.archived_at;
    if (gone && !used.has(r.id)) return [];
    return [{ id: r.id, label: `${r.name}${many && v ? ` · ${v.name}` : ""}${gone ? " · в архиве" : ""}` }];
  });
  return { chats, roles: options };
}

async function validRoles(s: Awaited<ReturnType<typeof integrationScope>>, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return unique;
  const venues = checked(await s.db.from<{ id: string }[]>("venues").select("id").eq("account_id", s.accountId)) ?? [];
  const roles = venues.length ? checked(await s.db.from<{ id: string }[]>("roles").select("id")
    .in("id", unique).in("venue_id", venues.map(v => v.id))) ?? [] : [];
  if (roles.length !== unique.length) throw new Error("Выбрана недоступная должность");
  return unique;
}

export async function saveTelegramChat(input: unknown, id?: string) {
  const s = await integrationScope();
  const value = integrationInput(chatSchema, input);
  const role_ids = await validRoles(s, value.role_ids);
  const dup = checked(await s.db.from<{ id: string }[]>("telegram_chats").select("id")
    .eq("account_id", s.accountId).eq("chat_id", value.chat_id)) ?? [];
  if (dup.some(r => r.id !== id)) throw new Error("Чат с таким ID уже добавлен");
  const row = { title: value.title, chat_id: value.chat_id, invite: value.invite, role_ids };
  if (id) {
    const updated = checked(await s.db.from<{ id: string }[]>("telegram_chats").update({ ...row, updated_at: new Date().toISOString() })
      .eq("account_id", s.accountId).eq("id", id).select("id")) ?? [];
    if (!updated.length) throw new Error("Чат не найден");
  }
  else checked(await s.db.from("telegram_chats").insert({ ...row, account_id: s.accountId }));
  revalidatePath("/settings/integrations/telegram");
}

export async function setTelegramChatArchived(id: string, archived: boolean) {
  const s = await integrationScope();
  integrationInput(z.string().uuid(), id);
  const updated = checked(await s.db.from<{ id: string }[]>("telegram_chats").update({
    archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  }).eq("account_id", s.accountId).eq("id", id).select("id")) ?? [];
  if (!updated.length) throw new Error("Чат не найден");
  revalidatePath("/settings/integrations/telegram");
}

/** Checks that the bot is an administrator of the chat with the rights to invite and remove people. */
export async function checkTelegramChat(id: string): Promise<ChatCheck> {
  const s = await integrationScope();
  integrationInput(z.string().uuid(), id);
  const chat = checked(await s.db.from<{ chat_id: string }>("telegram_chats").select("chat_id")
    .eq("account_id", s.accountId).eq("id", id).maybeSingle());
  if (!chat) throw new Error("Чат не найден");
  const bot = await loadTelegramBot(s.db, s.accountId);
  if (!bot) return { tone: "warning", message: "Бот Telegram не подключён" };
  let res;
  try { res = await bot.getOwnMembership(chat.chat_id); } catch { return { tone: "warning", message: "Telegram не ответил, попробуйте позже" }; }
  if (!res.ok || !res.result) return { tone: "warning", message: "Бот не видит этот чат: добавьте его в чат и проверьте ID" };
  const m = res.result;
  if (m.status === "creator") return { tone: "success", message: "Бот может приглашать и исключать" };
  if (m.status !== "administrator") return { tone: "warning", message: "Бот не администратор чата" };
  const missing = [m.can_invite_users ? null : "приглашать", m.can_restrict_members ? null : "исключать"].filter(Boolean);
  return missing.length
    ? { tone: "warning", message: `Администратор, но без права ${missing.join(" и ")}` }
    : { tone: "success", message: "Бот может приглашать и исключать" };
}
