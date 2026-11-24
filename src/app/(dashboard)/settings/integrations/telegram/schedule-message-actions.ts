"use server";
import { z } from "zod";
import { actionResult } from "@/lib/actions/result";
import { revalidatePath } from "next/cache";
import { checked, integrationInput, integrationScope } from "@/lib/integrations/settings";
import { writeAuditEvent } from "@/lib/audit/write";

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

async function saveScheduleMessagesImpl(input: unknown) {
  const s = await integrationScope();
  const value = integrationInput(schema, input);
  const venue = checked(await s.db.from<{ id: string; name: string }>("venues").select("id,name")
    .eq("account_id", s.accountId).eq("id", value.venue_id).is("archived_at", null).maybeSingle());
  if (!venue) throw new Error("Заведение недоступно");
  // Только чаты из списка «Чаты» этой организации.
  const wanted = [...new Set([...(value.chat_id ? [value.chat_id] : []), ...value.reminder_chat_ids])];
  if (wanted.length) {
    const known = checked(await s.db.from<{ chat_id: string }[]>("telegram_chats").select("chat_id")
      .eq("account_id", s.accountId).is("archived_at", null).in("chat_id", wanted)) ?? [];
    if (known.length !== wanted.length) throw new Error("Выбран чат, которого нет в списке чатов");
  }
  const previous = checked(await s.db.from<Row>("schedule_task_settings")
    .select("venue_id,chat_id,daily_days,daily_time,reminder_chat_ids,schedule_open_day,schedule_deadline_day,schedule_time")
    .eq("account_id", s.accountId).eq("venue_id", value.venue_id).maybeSingle());
  const next: Row = {
    venue_id: value.venue_id,
    chat_id: value.chat_id,
    daily_days: [...new Set(value.daily_days)].sort((a, b) => a - b),
    daily_time: value.daily_time,
    reminder_chat_ids: [...new Set(value.reminder_chat_ids)],
    schedule_open_day: value.schedule_open_day,
    schedule_deadline_day: value.schedule_deadline_day,
    schedule_time: value.schedule_time,
  };
  checked(await s.db.from("schedule_task_settings").upsert({
    ...next,
    account_id: s.accountId,
  }, { onConflict: "venue_id" }));

  const before: Row = {
    ...DEFAULTS,
    ...previous,
    venue_id: value.venue_id,
    daily_time: hhmm(previous?.daily_time ?? DEFAULTS.daily_time),
    schedule_time: hhmm(previous?.schedule_time ?? DEFAULTS.schedule_time),
  };
  const changes = await messageChanges(s.db, s.accountId, before, next);
  if (changes.length > 0) {
    await writeAuditEvent({
      accountId: s.accountId,
      venueId: value.venue_id,
      userId: s.user.id,
      actionCode: "schedule.messages.updated",
      entityType: "venue",
      entityId: value.venue_id,
      details: { venue_name: venue.name, changes },
    });
  }
  revalidatePath("/settings/integrations/telegram");
}

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const weekday = (d: number) => WEEKDAYS[d - 1] ?? String(d);

/** Изменения для журнала — уже в словах: дни недели и названия чатов. */
async function messageChanges(
  db: Awaited<ReturnType<typeof integrationScope>>["db"],
  accountId: string,
  before: Row,
  after: Row,
) {
  const ids = [...new Set([
    before.chat_id, after.chat_id, ...before.reminder_chat_ids, ...after.reminder_chat_ids,
  ].filter((id): id is string => !!id))];
  const chats = ids.length
    ? checked(await db.from<{ chat_id: string; title: string }[]>("telegram_chats")
      .select("chat_id,title").eq("account_id", accountId).in("chat_id", ids)) ?? []
    : [];
  const title = new Map(chats.map((c) => [c.chat_id, c.title || c.chat_id]));
  const chatList = (list: string[]) => list.map((id) => title.get(id) ?? id).join(", ") || null;
  const view = (r: Row): Record<string, string | null> => ({
    chat_id: r.chat_id ? (title.get(r.chat_id) ?? r.chat_id) : null,
    daily_days: r.daily_days.map(weekday).join(", "),
    daily_time: r.daily_time,
    reminder_chat_ids: chatList(r.reminder_chat_ids),
    schedule_open_day: weekday(r.schedule_open_day),
    schedule_deadline_day: weekday(r.schedule_deadline_day),
    schedule_time: r.schedule_time,
  });
  const old = view(before);
  const now = view(after);
  return Object.keys(now)
    .filter((field) => old[field] !== now[field])
    .map((field) => ({ field, old: old[field], new: now[field] }));
}

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js
// заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function saveScheduleMessages(input: unknown) {
  return actionResult(() => saveScheduleMessagesImpl(input), "Не удалось сохранить сообщения");
}
