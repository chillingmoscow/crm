"use server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import {
  loadScheduleImage,
  scheduleImageRequest,
  scheduleImageScope,
  type ScheduleImageRequest,
} from "@/lib/schedule/schedule-image-data";
import { renderScheduleImagePng } from "@/lib/schedule/schedule-image-render";
import { scheduleImageCaption, scheduleImageFileName } from "@/lib/schedule/schedule-image";
import { actionErrorMessage } from "@/lib/actions/result";

/**
 * Картинка расписания в Telegram. Сама картинка — `GET /api/schedule/image`,
 * здесь — что показать в диалоге (части картинки, чаты) и отправка ботом
 * организации в чат из «Интеграции → Telegram → Чаты».
 */
export type ScheduleImageChat = { chatId: string; title: string };
export type ScheduleImageSetup = {
  parts: { fileName: string }[];
  /** На неделе нет опубликованных смен с сотрудником: отправлять и скачивать нечего. */
  empty: boolean;
  canSend: boolean;
  /** Почему отправить нельзя: нет бота, нет чатов. */
  telegram: { state: "ready" | "no_bot" | "no_chats"; chats: ScheduleImageChat[]; suggestedChatId: string | null };
};

const EMPTY_MESSAGE = "На этой неделе нет опубликованных смен";
const isEmpty = (image: { parts: { rows: unknown[] }[] }) => image.parts.every((p) => !p.rows.length);
const message = (e: unknown, fallback: string) =>
  e instanceof z.ZodError ? "Некорректная неделя" : actionErrorMessage(e, fallback);

async function telegramTargets(accountId: string, venueId: string) {
  // Чаты и бот — служебные таблицы интеграции, читаются сервисным ключом
  // после проверки прав; наружу уходят только название и ID чата.
  const admin = asLooseDb(createAdminClient());
  const [settings, chats, venue] = await Promise.all([
    admin.from<{ account_id: string }>("organization_telegram_settings").select("account_id")
      .eq("account_id", accountId).not("secret", "is", null).maybeSingle(),
    admin.from<{ chat_id: string; title: string }[]>("telegram_chats").select("chat_id,title")
      .eq("account_id", accountId).is("archived_at", null).order("title"),
    admin.from<{ chat_id: string | null }>("schedule_task_settings").select("chat_id")
      .eq("account_id", accountId).eq("venue_id", venueId).maybeSingle(),
  ]);
  for (const r of [settings, chats, venue]) if (r.error) throw new Error("Не удалось загрузить настройки Telegram");
  const list = (chats.data ?? []).map((c) => ({ chatId: c.chat_id, title: c.title }));
  return {
    bot: !!settings.data,
    chats: list,
    // Чат задач заведения — скорее всего общий чат команды.
    suggestedChatId: list.find((c) => c.chatId === venue.data?.chat_id)?.chatId ?? list[0]?.chatId ?? null,
  };
}

export async function scheduleImageSetup(
  request: ScheduleImageRequest,
): Promise<ScheduleImageSetup | { error: string }> {
  try {
    const scope = await scheduleImageScope();
    const [image, targets] = await Promise.all([
      loadScheduleImage(scope, request),
      scope.canSend ? telegramTargets(scope.accountId, scope.venueId) : null,
    ]);
    return {
      parts: image.parts.map((_, i) => ({ fileName: scheduleImageFileName(image, i) })),
      empty: isEmpty(image),
      canSend: scope.canSend,
      telegram: {
        state: !targets?.bot ? "no_bot" : !targets.chats.length ? "no_chats" : "ready",
        chats: targets?.chats ?? [],
        suggestedChatId: targets?.suggestedChatId ?? null,
      },
    };
  } catch (e) {
    return { error: message(e, "Не удалось подготовить картинку") };
  }
}

export async function sendScheduleImage(
  input: ScheduleImageRequest & { chatId: string },
): Promise<{ sent: number } | { error: string; uncertain?: boolean }> {
  try {
    const request = scheduleImageRequest.parse(input);
    const chatId = z.string().regex(/^-?\d{1,20}$/).parse(input.chatId);
    const scope = await scheduleImageScope();
    if (!scope.canSend) return { error: "Отправить расписание в чат может тот, у кого есть право публиковать смены" };
    const targets = await telegramTargets(scope.accountId, scope.venueId);
    if (!targets.bot) return { error: "Бот Telegram не подключён" };
    // Только чаты из списка организации: произвольный ID сюда не пройдёт.
    if (!targets.chats.some((c) => c.chatId === chatId)) return { error: "Чат не найден в настройках Telegram" };
    const bot = await loadTelegramBot(asLooseDb(createAdminClient()), scope.accountId);
    if (!bot) return { error: "Бот Telegram не подключён" };
    const image = await loadScheduleImage(scope, request);
    if (isEmpty(image)) return { error: EMPTY_MESSAGE };
    if (image.parts.length > 10) return { error: "Слишком много картинок для одного сообщения: выберите подразделение в фильтре" };
    const photos = await Promise.all(
      image.parts.map(async (_, i) => ({ data: await renderScheduleImagePng(image, i), name: scheduleImageFileName(image, i) })),
    );
    const result = await bot.sendPhotoFiles(chatId, photos, scheduleImageCaption(image));
    if (result.ok) return { sent: photos.length };
    if (result.uncertain)
      return { error: "Telegram не подтвердил отправку. Проверьте чат, прежде чем отправлять ещё раз", uncertain: true };
    return { error: telegramError(result.description) };
  } catch (e) {
    return { error: message(e, "Не удалось отправить расписание") };
  }
}

function telegramError(description: string | undefined) {
  const text = description ?? "";
  if (/chat not found/i.test(text)) return "Бот не видит этот чат: добавьте его в чат и проверьте ID в настройках";
  if (/not enough rights|have no rights|CHAT_SEND_PHOTOS_FORBIDDEN/i.test(text)) return "У бота нет права отправлять фото в этот чат";
  if (/bot was kicked|bot is not a member/i.test(text)) return "Бота удалили из чата: добавьте его снова";
  return "Telegram не принял картинку. Попробуйте ещё раз";
}
