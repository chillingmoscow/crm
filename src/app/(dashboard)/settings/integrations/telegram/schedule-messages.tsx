"use client";
import { useState, useTransition } from "react";
import { BellRing, ListChecks, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimePicker } from "@/components/ui/time-picker";
import { OptionSelect } from "@/components/ui/option-select";
import { MultiOptionPicker } from "@/components/shared/multi-option-picker";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { candidateError } from "@/lib/candidates/errors";
import {
  WEEKDAY_SHORT,
  dailyScheduleLabel,
  reminderScheduleLabel,
  weekdayName,
} from "@/lib/schedule/task-message-schedule";
import { IntegrationNotice, IntegrationSection } from "../_components/integration-layout";
import { saveScheduleMessages, type ScheduleMessageSettings } from "./schedule-message-actions";
import type { TelegramChatRow } from "./chat-actions";

type Draft = ScheduleMessageSettings & { daily: boolean; reminder: boolean };
const WEEK = [1, 2, 3, 4, 5, 6, 7];
const dayOptions = WEEK.map((d) => ({ value: String(d), label: weekdayName(d) }));

/**
 * «Интеграции → Telegram» → «График и задачи»: по строке на заведение —
 * куда и когда отправлять список задач на день и напоминание сдать график.
 */
export function ScheduleMessages({ settings, chats }: { settings: ScheduleMessageSettings[]; chats: TelegramChatRow[] }) {
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(""), [busy, start] = useTransition();
  const live = chats.filter((c) => !c.archived_at);
  const title = new Map(chats.map((c) => [c.chat_id, c.title]));
  const chatName = (id: string) => title.get(id) ?? `чат ${id}`;
  const many = settings.length > 1;
  const close = () => { setDraft(null); setError(""); };

  const row = (s: ScheduleMessageSettings) => {
    const lines = [
      {
        icon: ListChecks,
        name: "Список задач на день",
        value: s.chat_id ? `${chatName(s.chat_id)} · ${dailyScheduleLabel(s.daily_days, s.daily_time)}` : "Не отправляется",
      },
      {
        icon: BellRing,
        name: "Напоминание сдать график",
        value: s.reminder_chat_ids.length
          ? `${s.reminder_chat_ids.map(chatName).join(", ")} · ${reminderScheduleLabel(s.schedule_open_day, s.schedule_deadline_day, s.schedule_time)}`
          : "Не отправляется",
      },
    ];
    return <div key={s.venue_id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-3">
        {many ? <p className="text-sm font-medium">{s.venue_name}</p> : null}
        {lines.map((l) => <div key={l.name} className="flex items-start gap-3">
          <l.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0"><p className="text-sm">{l.name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{l.value}</p></div>
        </div>)}
      </div>
      <Button variant="outline" size="sm" className="shrink-0 self-start" onClick={() => setDraft({ ...s, daily: !!s.chat_id, reminder: s.reminder_chat_ids.length > 0 })}>
        <Pencil className="size-4" />Изменить
      </Button>
    </div>;
  };

  const dailyLabel = draft ? dailyScheduleLabel(draft.daily_days, draft.daily_time) : null;
  const reminderLabel = draft ? reminderScheduleLabel(draft.schedule_open_day, draft.schedule_deadline_day, draft.schedule_time) : null;
  const problem = !draft ? null
    : draft.daily && !draft.chat_id ? "Выберите чат для списка задач"
    : draft.daily && !dailyLabel ? "Выберите хотя бы один день"
    : draft.reminder && !draft.reminder_chat_ids.length ? "Выберите чаты для напоминания"
    : draft.reminder && !reminderLabel ? "Начало сбора и последний день должны быть разными днями"
    : null;
  const toggleDay = (d: number) => draft && setDraft({
    ...draft,
    daily_days: draft.daily_days.includes(d) ? draft.daily_days.filter((x) => x !== d) : [...draft.daily_days, d].sort((a, b) => a - b),
  });

  return <>
    <IntegrationSection title="График и задачи" description="Список задач на день и напоминание сдать пожелания к графику. Время по часам заведения">
      {settings.length ? <div className="divide-y">{settings.map(row)}</div> : <IntegrationNotice>Заведений пока нет</IntegrationNotice>}
      {!live.length ? <IntegrationNotice>Чтобы выбрать чат, сначала добавьте его в «Чаты сотрудников» ниже</IntegrationNotice> : null}
    </IntegrationSection>
    <EditDrawer open={!!draft} onOpenChange={(o) => { if (!o && !busy) close(); }}
      title={many && draft ? `График и задачи · ${draft.venue_name}` : "График и задачи"} description="Время по часам заведения"
      footer={<>
        <Button variant="outline" disabled={busy} onClick={close}>Отмена</Button>
        <Button disabled={busy || !!problem} onClick={() => start(async () => {
              if (!draft) return; setError("");
              try {
                await saveScheduleMessages({
                  venue_id: draft.venue_id,
                  chat_id: draft.daily ? draft.chat_id : null,
                  daily_days: draft.daily_days.length ? draft.daily_days : WEEK,
                  daily_time: draft.daily_time,
                  reminder_chat_ids: draft.reminder ? draft.reminder_chat_ids : [],
                  schedule_open_day: draft.schedule_open_day,
                  schedule_deadline_day: draft.schedule_deadline_day === draft.schedule_open_day && !draft.reminder ? (draft.schedule_open_day % 7) + 1 : draft.schedule_deadline_day,
                  schedule_time: draft.schedule_time,
                });
                toast.success("Сообщения сохранены");
                close();
              } catch (e) { setError(candidateError(e, "Не удалось сохранить сообщения")); }
            })}>{busy ? "Сохраняем…" : "Сохранить"}</Button>
      </>}>
      {draft ? <>
        <DrawerSection title="Список задач на день" actions={<Switch id="daily-on" aria-label="Отправлять список задач" checked={draft.daily} disabled={busy} onCheckedChange={(v) => setDraft({ ...draft, daily: v })} />}>
          {draft.daily ? <>
            <div className="grid gap-2"><Label htmlFor="daily-chat">Чат</Label>
              <OptionSelect id="daily-chat" value={draft.chat_id ?? ""} disabled={busy || !live.length}
                placeholder={live.length ? "Выберите чат" : "Нет чатов"} onValueChange={(v) => setDraft({ ...draft, chat_id: v || null })}
                options={live.map((c) => ({ value: c.chat_id, label: c.title }))} /></div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <div className="grid gap-2"><Label id="daily-days-label">Дни</Label>
                <div role="group" aria-labelledby="daily-days-label" className="flex flex-wrap gap-x-2 gap-y-2 sm:gap-1">
                  {WEEK.map((d) => {
                    const on = draft.daily_days.includes(d);
                    return <Button key={d} type="button" size="sm" variant={on ? "default" : "outline"} aria-pressed={on} disabled={busy}
                      onClick={() => toggleDay(d)} className="touch-target h-8 min-w-9 px-2 text-xs">{WEEKDAY_SHORT[d - 1]}</Button>;
                  })}
                </div></div>
              <div className="grid gap-2"><Label htmlFor="daily-time">Время</Label>
                <TimePicker id="daily-time" clearable={false} value={draft.daily_time} disabled={busy} onChange={(v) => setDraft({ ...draft, daily_time: v })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">{dailyLabel ? `${dailyLabel}, если на этот день есть задачи` : "Выберите хотя бы один день"}</p>
          </> : null}
        </DrawerSection>
        <DrawerSection title="Напоминание сдать график" actions={<Switch id="reminder-on" aria-label="Отправлять напоминание" checked={draft.reminder} disabled={busy} onCheckedChange={(v) => setDraft({ ...draft, reminder: v })} />}>
          {draft.reminder ? <>
            <div className="grid gap-2"><Label htmlFor="reminder-chats">Чаты</Label>
              <MultiOptionPicker id="reminder-chats" label="Чаты" disabled={busy || !live.length} placeholder={live.length ? "Выберите чаты" : "Нет чатов"}
                options={live.map((c) => ({ id: c.chat_id, label: c.title }))} selectedIds={draft.reminder_chat_ids}
                onChange={(ids) => setDraft({ ...draft, reminder_chat_ids: ids })} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2"><Label htmlFor="reminder-open">Начать сбор</Label>
                <OptionSelect id="reminder-open" value={String(draft.schedule_open_day)} disabled={busy}
                  onValueChange={(v) => setDraft({ ...draft, schedule_open_day: Number(v) })} options={dayOptions} /></div>
              <div className="grid gap-2"><Label htmlFor="reminder-deadline">Последний день</Label>
                <OptionSelect id="reminder-deadline" value={String(draft.schedule_deadline_day)} disabled={busy}
                  onValueChange={(v) => setDraft({ ...draft, schedule_deadline_day: Number(v) })} options={dayOptions} /></div>
            </div>
            <div className="grid gap-2 sm:w-1/2 sm:pr-2"><Label htmlFor="reminder-time">Время</Label>
              <TimePicker id="reminder-time" clearable={false} value={draft.schedule_time} disabled={busy} onChange={(v) => setDraft({ ...draft, schedule_time: v })} /></div>
            <p className="text-xs text-muted-foreground">{reminderLabel ?? "Начало сбора и последний день должны быть разными днями"}</p>
          </> : null}
        </DrawerSection>
        {problem && (draft.daily || draft.reminder) ? <p className="text-xs text-amber-700 dark:text-amber-400">{problem}</p> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      </> : null}
    </EditDrawer>
  </>;
}
