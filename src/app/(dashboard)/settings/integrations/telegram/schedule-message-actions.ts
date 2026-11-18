"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { checked, integrationInput, integrationScope } from "@/lib/integrations/settings";

/**
 * Сообщения о задачах и графике в Telegram — по заведению: куда и когда
 * отправлять список задач на день и напоминание сдать график.
 * Хранятся в schedule_task_settings (миграция 345), отправляет их
 * cron приложения. Права — как у остальной страницы: право на интеграции.
 */
export type ScheduleMessageSettings = {
  venue_id: string;
  venue_name: string;
  chat_id: string | null;
  daily_days: number[];
  daily_time: string;
  reminder_chat_ids: string[];
  schedule_open_day: number;
  schedule_deadline_day: number;
  schedule_time: string;
};

type Row = Omit<ScheduleMessageSettings, "venue_name">;
const DEFAULTS: Omit<Row, "venue_id"> = {
  chat_id: null,
  daily_days: [1, 2, 3, 4, 5, 6, 7],
  daily_time: "12:00",
  reminder_chat_ids: [],
  schedule_open_day: 1,
  schedule_deadline_day: 3,
  schedule_time: "14:00",
};
const hhmm = (t: string) => t.slice(0, 5);

export async function readScheduleMessages(): Promise<ScheduleMessageSettings[]> {
  const s = await integrationScope();
  const venues = checked(await s.db.from<{ id: string; name: string }[]>("venues").select("id,name")
    .eq("account_id", s.accountId).is("archived_at", null).order("name")) ?? [];
  if (!venues.length) return [];
  const rows = checked(await s.db.from<Row[]>("schedule_task_settings")
    .select("venue_id,chat_id,daily_days,daily_time,reminder_chat_ids,schedule_open_day,schedule_deadline_day,schedule_time")
    .eq("account_id", s.accountId).in("venue_id", venues.map(v => v.id))) ?? [];
  const byVenue = new Map(rows.map(r => [r.venue_id, r]));
  return venues.map(v => {
    const r = byVenue.get(v.id);
    return {
      ...DEFAULTS,
      ...r,
      venue_id: v.id,
      venue_name: v.name,
      daily_time: hhmm(r?.daily_time ?? DEFAULTS.daily_time),
      schedule_time: hhmm(r?.schedule_time ?? DEFAULTS.schedule_time),
    };
  });
}

const day = z.number().int().min(1).max(7);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Укажите время");
const schema = z.object({
  venue_id: z.string().uuid(),
  chat_id: z.string().regex(/^-?\d{1,20}$/).nullable(),
  daily_days: z.array(day).min(1, "Выберите хотя бы один день").max(7),
  daily_time: time,
  reminder_chat_ids: z.array(z.string().regex(/^-?\d{1,20}$/)).max(30),
  schedule_open_day: day,
  schedule_deadline_day: day,
  schedule_time: time,
}).refine(v => v.schedule_open_day !== v.schedule_deadline_day, "Начало сбора и последний день должны быть разными днями");

export async function saveScheduleMessages(input: unknown) {
  const s = await integrationScope();
  const value = integrationInput(schema, input);
  const venue = checked(await s.db.from<{ id: string }>("venues").select("id")
    .eq("account_id", s.accountId).eq("id", value.venue_id).is("archived_at", null).maybeSingle());
  if (!venue) throw new Error("Заведение недоступно");
  // Только чаты из списка «Чаты» этой организации.
  const wanted = [...new Set([...(value.chat_id ? [value.chat_id] : []), ...value.reminder_chat_ids])];
  if (wanted.length) {
    const known = checked(await s.db.from<{ chat_id: string }[]>("telegram_chats").select("chat_id")
      .eq("account_id", s.accountId).is("archived_at", null).in("chat_id", wanted)) ?? [];
    if (known.length !== wanted.length) throw new Error("Выбран чат, которого нет в списке чатов");
  }
  checked(await s.db.from("schedule_task_settings").upsert({
    venue_id: value.venue_id,
    account_id: s.accountId,
    chat_id: value.chat_id,
    daily_days: [...new Set(value.daily_days)].sort((a, b) => a - b),
    daily_time: value.daily_time,
    reminder_chat_ids: [...new Set(value.reminder_chat_ids)],
    schedule_open_day: value.schedule_open_day,
    schedule_deadline_day: value.schedule_deadline_day,
    schedule_time: value.schedule_time,
  }, { onConflict: "venue_id" }));
  revalidatePath("/settings/integrations/telegram");
}
