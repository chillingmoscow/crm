import "server-only";
import { decryptSecret } from "@/lib/integrations/crypto";
import type { LooseDb } from "@/lib/supabase/loose";
import {
  readTelegramResponse,
  type TelegramApiResult,
} from "./telegram-response";
export type { TelegramApiResult } from "./telegram-response";
import { fetchTelegram } from "./telegram-transport";

// Bot API client for one organization. The token lives only inside this closure:
// it is never returned, logged or put into error messages (fetch errors may carry the URL).
// Network failures throw TelegramNetworkError: a failed connection is retried first
// (the request never left), anything after the connection is reported as "may have arrived".

export type TelegramButton = { text: string; url: string };
type Settings = {
  secret: { encrypted: string; iv: string; tag: string };
  default_chat_id: string | null;
  candidate_chat_id: string | null;
};

export type TelegramBot = {
  /** Management chat for reports (`default_chat_id`). */
  reportsChatId: string | null;
  /** Chat where invitations are posted (`candidate_chat_id`, falls back to reports chat). */
  invitesChatId: string | null;
  getChatMember: (
    chatId: string,
    userId: number,
  ) => Promise<TelegramApiResult<{ status?: string; is_member?: boolean }>>;
  banChatMember: (
    chatId: string,
    userId: number,
  ) => Promise<TelegramApiResult<boolean>>;
  /** The bot's own membership in a chat: status and the rights needed to invite and remove people. */
  getOwnMembership: (
    chatId: string,
  ) => Promise<
    TelegramApiResult<{
      status?: string;
      can_invite_users?: boolean;
      can_restrict_members?: boolean;
    }>
  >;
  unbanChatMember: (
    chatId: string,
    userId: number,
  ) => Promise<TelegramApiResult<boolean>>;
  createChatInviteLink: (
    chatId: string,
    name: string,
  ) => Promise<TelegramApiResult<{ invite_link?: string }>>;
  sendMessage: (
    chatId: string,
    text: string,
    buttons?: TelegramButton[][],
    options?: { html?: boolean },
  ) => Promise<TelegramApiResult<{ message_id?: number }>>;
  /** Photo by URL with an HTML caption (Telegram limits the caption to 1024 characters). */
  sendPhoto: (
    chatId: string,
    photoUrl: string,
    caption: string,
  ) => Promise<TelegramApiResult<{ message_id?: number }>>;
  /**
   * Uploads PNG files: one becomes a photo, several an album (Telegram allows 2–10 per album).
   * The HTML caption goes on the first photo.
   */
  sendPhotoFiles: (
    chatId: string,
    photos: { data: ArrayBuffer; name: string }[],
    caption: string,
  ) => Promise<TelegramApiResult<{ message_id?: number } | { message_id?: number }[]>>;
};

/** Loads the organization's bot; null when Telegram is not configured for the account. */
export async function loadTelegramBot(
  db: LooseDb,
  accountId: string,
): Promise<TelegramBot | null> {
  const row = await db
    .from<Settings>("organization_telegram_settings")
    .select("secret,default_chat_id,candidate_chat_id")
    .eq("account_id", accountId)
    .maybeSingle();
  if (row.error) throw new Error(row.error.message);
  if (!row.data?.secret) return null;
  const token = decryptSecret(row.data.secret);
  const call = async <T>(
    method: string,
    payload: Record<string, unknown>,
  ): Promise<TelegramApiResult<T>> => {
    const response = await fetchTelegram(() =>
      fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(12000),
      }),
    );
    return readTelegramResponse<T>(response);
  };
  const upload = async <T>(method: string, form: FormData): Promise<TelegramApiResult<T>> => {
    const response = await fetchTelegram(() =>
      fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(30000),
      }),
    );
    return readTelegramResponse<T>(response);
  };
  return {
    reportsChatId: row.data.default_chat_id,
    invitesChatId: row.data.candidate_chat_id || row.data.default_chat_id,
    getChatMember: (chatId, userId) =>
      call("getChatMember", { chat_id: chatId, user_id: userId }),
    getOwnMembership: (chatId) =>
      call("getChatMember", {
        chat_id: chatId,
        user_id: Number(token.split(":")[0]),
      }),
    banChatMember: (chatId, userId) =>
      call("banChatMember", {
        chat_id: chatId,
        user_id: userId,
        revoke_messages: false,
      }),
    unbanChatMember: (chatId, userId) =>
      call("unbanChatMember", {
        chat_id: chatId,
        user_id: userId,
        only_if_banned: true,
      }),
    // Telegram limits the link name to 32 characters.
    createChatInviteLink: (chatId, name) =>
      call("createChatInviteLink", {
        chat_id: chatId,
        member_limit: 1,
        name: name.slice(0, 32),
      }),
    sendMessage: (chatId, text, buttons, options) =>
      call("sendMessage", {
        chat_id: chatId,
        text,
        link_preview_options: { is_disabled: true },
        ...(options?.html ? { parse_mode: "HTML" } : {}),
        ...(buttons?.length
          ? { reply_markup: { inline_keyboard: buttons } }
          : {}),
      }),
    sendPhoto: (chatId, photoUrl, caption) =>
      call("sendPhoto", {
        chat_id: chatId,
        photo: photoUrl,
        caption,
        parse_mode: "HTML",
      }),
    sendPhotoFiles: async (chatId, photos, caption) => {
      if (!photos.length || photos.length > 10) throw new Error("Можно отправить от 1 до 10 картинок");
      const form = new FormData();
      form.set("chat_id", chatId);
      const file = (p: { data: ArrayBuffer; name: string }) => new Blob([p.data], { type: "image/png" });
      if (photos.length === 1) {
        form.set("photo", file(photos[0]), photos[0].name);
        form.set("caption", caption);
        form.set("parse_mode", "HTML");
        return upload("sendPhoto", form);
      }
      photos.forEach((p, i) => form.set(`photo${i}`, file(p), p.name));
      form.set(
        "media",
        JSON.stringify(
          photos.map((_, i) => ({
            type: "photo",
            media: `attach://photo${i}`,
            ...(i === 0 ? { caption, parse_mode: "HTML" } : {}),
          })),
        ),
      );
      return upload("sendMediaGroup", form);
    },
  };
}
