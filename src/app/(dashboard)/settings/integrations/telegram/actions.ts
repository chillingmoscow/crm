"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { encryptSecret, decryptSecret } from "@/lib/integrations/crypto";
import { checked, integrationInput, integrationScope } from "@/lib/integrations/settings";
type SavedTelegram = {
  secret: { encrypted: string; iv: string; tag: string };
  bot_username: string | null;
  default_chat_id: string | null;
  candidate_chat_id: string | null;
  default_chat_title: string | null;
  candidate_chat_title: string | null;
};
async function chatTitle(token: string, id: string) {
  const response = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: id }), cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error("Бот не имеет доступа к выбранному чату");
  return String(body.result.title || [body.result.first_name, body.result.last_name].filter(Boolean).join(" ") || body.result.username || `Чат ${id}`).slice(0, 500);
}
export async function readTelegramSettings(resolveTitles = false) {
  const s = await integrationScope();
  const row = checked(await s.db.from<SavedTelegram>("organization_telegram_settings")
    .select("secret,bot_username,default_chat_id,candidate_chat_id,default_chat_title,candidate_chat_title").eq("account_id", s.accountId).maybeSingle());
  if (!row) return null;
  let defaultTitle = row.default_chat_title, candidateTitle = row.candidate_chat_title;
  if (resolveTitles && ((!defaultTitle && row.default_chat_id) || (!candidateTitle && row.candidate_chat_id))) {
    try {
      const token = decryptSecret(row.secret);
      const ids = [...new Set([!defaultTitle ? row.default_chat_id : null, !candidateTitle ? row.candidate_chat_id : null].filter((id): id is string => !!id))];
      const titles = new Map(await Promise.all(ids.map(async id => [id, await chatTitle(token, id).catch(() => null)] as const)));
      defaultTitle ||= titles.get(row.default_chat_id ?? "") ?? null;
      candidateTitle ||= titles.get(row.candidate_chat_id ?? "") ?? null;
    } catch { /* Saved connection remains visible if Telegram is unavailable. */ }
  }
  return { bot_username: row.bot_username, default_chat_id: row.default_chat_id, candidate_chat_id: row.candidate_chat_id,
    default_chat_title: defaultTitle, candidate_chat_title: candidateTitle };
}
export async function saveOrganizationTelegram(input: unknown) {
  const s = await integrationScope(true);
  const value = integrationInput(z.object({ token: z.string().trim().max(300).optional(), chat_id: z.string().trim().regex(/^-?\d+$/, "Укажите ID чата"),
    candidate_chat_id: z.string().trim().regex(/^-?\d+$/, "Укажите ID чата новых анкет").or(z.literal("")) }), input);
  const old = checked(await s.db.from<SavedTelegram>("organization_telegram_settings").select("secret").eq("account_id", s.accountId).maybeSingle());
  const token = value.token || (old ? decryptSecret(old.secret) : "");
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("Введите токен Telegram-бота");
  let username: string;
  const titles = new Map<string, string>();
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const body = await response.json();
    if (!response.ok || !body.ok || !body.result?.is_bot) throw new Error();
    username = String(body.result.username);
    for (const id of new Set([value.chat_id, value.candidate_chat_id].filter(Boolean))) titles.set(id, await chatTitle(token, id));
  } catch { throw new Error("Не удалось проверить бота и чаты. Проверьте токен и добавление бота в оба чата."); }
  checked(await s.db.from("organization_telegram_settings").upsert({ account_id: s.accountId,
    secret: value.token ? encryptSecret(token) : old!.secret, bot_username: username,
    default_chat_id: value.chat_id, candidate_chat_id: value.candidate_chat_id || null,
    default_chat_title: titles.get(value.chat_id), candidate_chat_title: titles.get(value.candidate_chat_id) ?? null,
    verified_at: new Date().toISOString(), updated_at: new Date().toISOString(), updated_by: s.user.id }, { onConflict: "account_id" }));
  revalidatePath("/settings/integrations", "layout");
  return { bot_username: username, default_chat_id: value.chat_id, candidate_chat_id: value.candidate_chat_id || null,
    default_chat_title: titles.get(value.chat_id)!, candidate_chat_title: titles.get(value.candidate_chat_id) ?? null };
}
