"use client";
import { useEffect, useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { candidateError } from "@/lib/candidates/errors";
import { CHAT_ID_HINT } from "./chat-id-hint";
import { TelegramChats } from "./telegram-chats";
import { Undelivered } from "./undelivered";
import { ScheduleMessages } from "./schedule-messages";
import type { ScheduleMessageSettings } from "./schedule-message-actions";
import type { ChatRoleOption, TelegramChatRow } from "./chat-actions";
import type { UndeliveredItem } from "./delivery-actions";
import { unwrapAction } from "@/lib/actions/result";
import { readFinesChat, readTelegramSettings, saveFinesChat, saveOrganizationTelegram, type FinesChatSettings, type TelegramSettingsView } from "./actions";
import { IntegrationLayout, IntegrationNotice, IntegrationSection, IntegrationStatus } from "../_components/integration-layout";

type TelegramView = TelegramSettingsView;
type Panel = null | "bot" | "candidates" | "hired" | "fines";

const enabledAt = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const chatName = (title: string | null | undefined, id: string | null | undefined) => title || (id ? `Чат ${id}` : null);

export function TelegramSettings({ initial, editable, chats, roles, fines: initialFines, undelivered, schedule }: {
  initial: TelegramView; editable: boolean; chats: TelegramChatRow[]; roles: ChatRoleOption[]; fines: FinesChatSettings | null;
  undelivered: UndeliveredItem[]; schedule: ScheduleMessageSettings[];
}) {
  const [saved, setSaved] = useState(initial), [fines, setFines] = useState(initialFines), [panel, setPanel] = useState<Panel>(null);
  useEffect(() => {
    let active = true;
    if (initial) void readTelegramSettings(true).then(unwrapAction).then(value => { if (active && value) setSaved(current => current === initial ? value : current); }).catch(() => {});
    if (initialFines?.chat_id) void readFinesChat(true).then(unwrapAction).then(value => { if (active && value) setFines(value); }).catch(() => {});
    return () => { active = false; };
  }, [initial, initialFines]);

  const hiredChat = chatName(saved?.default_chat_title, saved?.default_chat_id);
  const rows: { key: Exclude<Panel, null | "bot">; title: string; value: string | null; off?: boolean; canEdit: boolean }[] = [
    { key: "candidates", title: "Новая анкета", canEdit: editable, value: saved?.candidate_chat_id ? chatName(saved.candidate_chat_title, saved.candidate_chat_id) : hiredChat },
    { key: "hired", title: "Приём сотрудника", canEdit: editable, value: hiredChat },
    ...(fines ? [{ key: "fines" as const, title: "Штрафы и премии", canEdit: true, value: fines.notify_from ? chatName(fines.title, fines.chat_id) : null, off: !fines.notify_from }] : []),
  ];

  return <IntegrationLayout provider="telegram" title="Telegram"
    status={<IntegrationStatus tone={!saved ? "neutral" : undelivered.length ? "warning" : "success"}>{!saved ? "Не настроено" : undelivered.length ? "Требует внимания" : "Работает"}</IntegrationStatus>}
    context={saved ? (saved.bot_username ? `@${saved.bot_username}` : "Бот организации") : "Бот для уведомлений и чатов сотрудников"}
    actions={saved && editable ? <Button variant="outline" size="sm" onClick={() => setPanel("bot")}>Сменить бота</Button> : null}>
    {!saved ? <IntegrationSection title="Бот не подключён" description="Создайте бота в @BotFather, добавьте его в рабочий чат и вставьте сюда токен"
      actions={editable ? <Button size="sm" onClick={() => setPanel("bot")}><Plus className="size-4" />Подключить бота</Button> : null}>
      {!editable ? <IntegrationNotice>Подключить бота может владелец организации</IntegrationNotice> : null}
    </IntegrationSection> : <>
      <Undelivered initial={undelivered} />
      <IntegrationSection title="Уведомления" description="Какие события и в какой чат отправляет бот">
        <ul className="divide-y">{rows.map(row => <li key={row.key} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{row.title}</p>
            <p className={row.value ? "truncate text-[13px]" : "text-[13px] text-muted-foreground"}>{row.value ?? (row.off ? "Выключено" : "Чат не выбран")}</p></div>
          {row.canEdit ? <Button variant="outline" size="sm" className="shrink-0" onClick={() => setPanel(row.key)}><Pencil className="size-4" />Изменить</Button> : null}
        </li>)}</ul>
        {!editable ? <IntegrationNotice>Чаты для анкет и приёма меняет владелец организации</IntegrationNotice> : null}
      </IntegrationSection>
      <ScheduleMessages settings={schedule} chats={chats} />
      <TelegramChats chats={chats} roles={roles} />
    </>}
    <SettingsPanel panel={panel} saved={saved} fines={fines} onClose={() => setPanel(null)} onSaved={setSaved} onFinesSaved={setFines} />
  </IntegrationLayout>;
}

function ChatIdField({ label, value, onChange, disabled, error }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean; error?: string }) {
  return <Field label={label} required hint={CHAT_ID_HINT} error={error}>
    {control => <Input {...control} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder="-1001234567890" autoComplete="off" />}
  </Field>;
}

const PANEL_TITLE: Record<Exclude<Panel, null>, string> = { bot: "Бот Telegram", candidates: "Новая анкета", hired: "Приём сотрудника", fines: "Штрафы и премии" };

function SettingsPanel({ panel, saved, fines, onClose, onSaved, onFinesSaved }: {
  panel: Panel; saved: TelegramView; fines: FinesChatSettings | null; onClose: () => void; onSaved: (v: TelegramView) => void; onFinesSaved: (v: FinesChatSettings) => void;
}) {
  const [token, setToken] = useState(""), [chat, setChat] = useState(""), [same, setSame] = useState(true), [enabled, setEnabled] = useState(false);
  const [error, setError] = useState(""), [busy, start] = useTransition();
  useEffect(() => {
    if (!panel) return;
    setError(""); setToken("");
    setChat(panel === "candidates" ? saved?.candidate_chat_id ?? "" : panel === "fines" ? fines?.chat_id ?? "" : saved?.default_chat_id ?? "");
    setSame(!saved?.candidate_chat_id); setEnabled(!!fines?.notify_from);
  }, [panel, saved, fines]);

  const submit = () => start(async () => {
    setError("");
    try {
      if (panel === "fines") {
        const next = unwrapAction(await saveFinesChat({ chat_id: chat, enabled }));
        if (next) onFinesSaved(next);
      } else {
        onSaved(unwrapAction(await saveOrganizationTelegram({
          token: token || undefined,
          chat_id: panel === "candidates" ? saved?.default_chat_id ?? "" : chat,
          candidate_chat_id: panel === "candidates" ? (same ? "" : chat) : saved?.candidate_chat_id ?? "",
        })));
      }
      toast.success("Сохранено"); onClose();
    } catch (e) { setError(candidateError(e, "Не удалось сохранить")); }
  });

  const needsChat = panel === "bot" ? !saved : panel === "candidates" ? !same : panel === "fines" ? enabled : true;
  const disabled = busy || (needsChat && !chat.trim()) || (panel === "bot" && !token.trim());
  return <EditDrawer open={!!panel} onOpenChange={o => { if (!o && !busy) onClose(); }} title={panel ? PANEL_TITLE[panel] : ""}
    description={panel === "bot" ? "Токен выдаёт @BotFather. После смены бота добавьте нового в те же чаты" : panel === "fines" ? "Штрафы, премии и предупреждения из журнала зарплаты" : undefined}
    footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Отмена</Button><Button disabled={disabled} onClick={submit}>{busy ? "Проверяем…" : "Сохранить"}</Button></>}>
    <form className="flex flex-col gap-5" onSubmit={e => { e.preventDefault(); if (!disabled) submit(); }}>
      {panel === "bot" ? <>
        <Field label="Токен бота" required>
          {control => <Input {...control} type="password" autoComplete="new-password" value={token} disabled={busy} onChange={e => setToken(e.target.value)} placeholder="123456789:AA…" />}
        </Field>
        {!saved ? <ChatIdField label="Чат для уведомлений" value={chat} onChange={setChat} disabled={busy} /> : null}
      </> : null}
      {panel === "hired" ? <ChatIdField label="ID чата" value={chat} onChange={setChat} disabled={busy} /> : null}
      {panel === "candidates" ? <>
        <div className="flex items-center justify-between gap-4"><Label htmlFor="tg-same">В тот же чат, что и приём сотрудника</Label><Switch id="tg-same" checked={same} disabled={busy} onCheckedChange={setSame} /></div>
        {!same ? <ChatIdField label="ID чата" value={chat} onChange={setChat} disabled={busy} /> : null}
      </> : null}
      {panel === "fines" ? <>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4"><Label htmlFor="tg-fines">Отправлять в чат</Label><Switch id="tg-fines" checked={enabled} disabled={busy} onCheckedChange={setEnabled} /></div>
          <p className="text-xs text-muted-foreground">{fines?.notify_from ? `Включено ${enabledAt(fines.notify_from)} (МСК). ` : ""}Записи, созданные до включения, не отправляются</p>
        </div>
        {enabled ? <ChatIdField label="ID чата" value={chat} onChange={setChat} disabled={busy} /> : null}
      </> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
    </form>
  </EditDrawer>;
}
