"use client";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { candidateError } from "@/lib/candidates/errors";
import { cn } from "@/lib/utils";
import { TelegramChats } from "./telegram-chats";
import { Undelivered } from "./undelivered";
import type { ChatRoleOption, TelegramChatRow } from "./chat-actions";
import type { UndeliveredItem } from "./delivery-actions";
import { readFinesChat, readTelegramSettings, saveFinesChat, saveOrganizationTelegram, type FinesChatSettings } from "./actions";
import { IntegrationLayout, IntegrationNotice, IntegrationSection, IntegrationStatus } from "../_components/integration-layout";

type TelegramView = Awaited<ReturnType<typeof readTelegramSettings>>;
type Panel = null | "bot" | "candidates" | "hired" | "fines";

const enabledAt = (iso: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const chatName = (title: string | null | undefined, id: string | null | undefined) => title || (id ? `Чат ${id}` : null);

export function TelegramSettings({ initial, editable, chats, roles, fines: initialFines, undelivered }: {
  initial: TelegramView; editable: boolean; chats: TelegramChatRow[]; roles: ChatRoleOption[]; fines: FinesChatSettings | null; undelivered: UndeliveredItem[];
}) {
  const [saved, setSaved] = useState(initial), [fines, setFines] = useState(initialFines), [panel, setPanel] = useState<Panel>(null);
  useEffect(() => {
    let active = true;
    if (initial) void readTelegramSettings(true).then(value => { if (active && value) setSaved(current => current === initial ? value : current); }).catch(() => {});
    if (initialFines?.chat_id) void readFinesChat(true).then(value => { if (active && value) setFines(value); }).catch(() => {});
    return () => { active = false; };
  }, [initial, initialFines]);

  const hiredChat = chatName(saved?.default_chat_title, saved?.default_chat_id);
  const rows: { key: Exclude<Panel, null | "bot">; title: string; hint: string; value: string | null; off?: boolean; canEdit: boolean }[] = [
    { key: "candidates", title: "Новая анкета", hint: "Анкета с сайта и ссылка на кандидата", canEdit: editable,
      value: saved?.candidate_chat_id ? chatName(saved.candidate_chat_title, saved.candidate_chat_id) : hiredChat },
    { key: "hired", title: "Приём сотрудника", hint: "Кого приняли и на какую должность", canEdit: editable, value: hiredChat },
    ...(fines ? [{ key: "fines" as const, title: "Штрафы и премии", hint: "Записи из журнала зарплаты", canEdit: true,
      value: fines.notify_from ? chatName(fines.title, fines.chat_id) : null, off: !fines.notify_from }] : []),
  ];

  return <IntegrationLayout provider="telegram" title="Telegram"
    description={saved ? `Бот ${saved.bot_username ? `@${saved.bot_username}` : "организации"} отправляет уведомления и приглашает сотрудников в чаты.` : "Бот организации для уведомлений и чатов сотрудников."}
    status={<IntegrationStatus tone={!saved ? "neutral" : undelivered.length ? "warning" : "success"}>{!saved ? "Не настроено" : undelivered.length ? "Требует внимания" : "Работает"}</IntegrationStatus>}
    actions={saved && editable ? <Button variant="outline" onClick={() => setPanel("bot")}>Сменить бота</Button> : null}>
    {!saved ? <IntegrationSection title="Бот не подключён" description="Создайте бота в @BotFather, добавьте его в рабочий чат и вставьте сюда токен.">
      {editable ? <div><Button onClick={() => setPanel("bot")}>Подключить бота</Button></div> : <IntegrationNotice>Подключить бота может владелец организации.</IntegrationNotice>}
    </IntegrationSection> : <div className="space-y-5">
      <Undelivered initial={undelivered} />
      <IntegrationSection title="Уведомления" description="Какие события и в какой чат отправляет бот.">
        <ul className="divide-y">{rows.map(row => <li key={row.key} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{row.title}</p>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">{row.hint}</p>
            <p className={cn("truncate text-xs sm:hidden", !row.value && "text-muted-foreground")}>{row.value ?? (row.off ? "Выключено" : "Не выбран")}</p></div>
          <p className={cn("hidden truncate text-right text-sm sm:block sm:max-w-[45%]", !row.value && "text-muted-foreground")}>{row.value ?? (row.off ? "Выключено" : "Не выбран")}</p>
          {row.canEdit ? <Button variant="ghost" size="sm" className="shrink-0 text-brand hover:text-brand" onClick={() => setPanel(row.key)}>Изменить</Button> : null}
        </li>)}</ul>
        {!editable ? <IntegrationNotice>Чаты для анкет и приёма меняет владелец организации.</IntegrationNotice> : null}
      </IntegrationSection>
      <TelegramChats chats={chats} roles={roles} />
    </div>}
    <SettingsPanel panel={panel} saved={saved} fines={fines} onClose={() => setPanel(null)} onSaved={setSaved} onFinesSaved={setFines} />
  </IntegrationLayout>;
}

function ChatIdField({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder="-1001234567890" inputMode="text" autoComplete="off" />
    <p className="text-xs text-muted-foreground">Откройте чат в web.telegram.org — ID в адресе после #. Бот должен быть в этом чате.</p>
  </div>;
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
        const next = await saveFinesChat({ chat_id: chat, enabled });
        if (next) onFinesSaved(next);
      } else {
        const next = await saveOrganizationTelegram({
          token: token || undefined,
          chat_id: panel === "candidates" ? saved?.default_chat_id ?? "" : chat,
          candidate_chat_id: panel === "candidates" ? (same ? "" : chat) : saved?.candidate_chat_id ?? "",
        });
        onSaved(next);
      }
      toast.success("Сохранено"); onClose();
    } catch (e) { setError(candidateError(e, "Не удалось сохранить")); }
  });

  const needsChat = panel === "bot" ? !saved : panel === "candidates" ? !same : panel === "fines" ? enabled : true;
  const disabled = busy || (needsChat && !chat.trim()) || (panel === "bot" && !token.trim());
  return <EditDrawer open={!!panel} onOpenChange={o => { if (!o && !busy) onClose(); }} title={panel ? PANEL_TITLE[panel] : ""}
    description={panel === "bot" ? "Токен выдаёт @BotFather. После смены бота добавьте нового в те же чаты." : panel === "fines" ? "Штрафы, премии и предупреждения из журнала зарплаты." : undefined}
    footer={<><Button variant="outline" disabled={busy} onClick={onClose}>Отмена</Button><Button disabled={disabled} onClick={submit}>{busy ? "Проверяем…" : "Сохранить"}</Button></>}>
    <div className="space-y-5">
      {panel === "bot" ? <>
        <div className="space-y-1.5"><Label htmlFor="tg-token">Токен бота</Label>
          <Input id="tg-token" type="password" autoComplete="new-password" value={token} disabled={busy} onChange={e => setToken(e.target.value)} placeholder="123456789:AA…" /></div>
        {!saved ? <ChatIdField id="tg-chat" label="Чат для уведомлений" value={chat} onChange={setChat} disabled={busy} /> : null}
      </> : null}
      {panel === "hired" ? <ChatIdField id="tg-chat" label="ID чата" value={chat} onChange={setChat} disabled={busy} /> : null}
      {panel === "candidates" ? <>
        <label className="flex items-center justify-between gap-4 text-sm font-medium">В тот же чат, что и приём сотрудников<Switch checked={same} disabled={busy} onCheckedChange={setSame} /></label>
        {!same ? <ChatIdField id="tg-chat" label="ID чата" value={chat} onChange={setChat} disabled={busy} /> : null}
      </> : null}
      {panel === "fines" ? <>
        <div className="space-y-1.5">
          <label className="flex items-center justify-between gap-4 text-sm font-medium">Отправлять в чат<Switch checked={enabled} disabled={busy} onCheckedChange={setEnabled} /></label>
          <p className="text-xs text-muted-foreground">{fines?.notify_from ? `Включено ${enabledAt(fines.notify_from)} (МСК). ` : ""}Записи, созданные до включения, не отправляются.</p>
        </div>
        {enabled ? <ChatIdField id="tg-chat" label="ID чата" value={chat} onChange={setChat} disabled={busy} /> : null}
      </> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  </EditDrawer>;
}
