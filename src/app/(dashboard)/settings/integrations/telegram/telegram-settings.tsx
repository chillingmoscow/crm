"use client";
import { useEffect, useState, useTransition } from "react";
import { MessageSquare, Pencil, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { candidateError } from "@/lib/candidates/errors";
import { readTelegramSettings, saveOrganizationTelegram } from "./actions";
import { IntegrationLayout, IntegrationSection, IntegrationStatus, IntegrationNotice } from "../_components/integration-layout";
type TelegramView = Awaited<ReturnType<typeof readTelegramSettings>>;
export function TelegramSettings({ initial, editable }: { initial: TelegramView; editable: boolean }) {
  const [saved, setSaved] = useState(initial), [editing, setEditing] = useState(!initial);
  const [token, setToken] = useState(""), [chat, setChat] = useState(initial?.default_chat_id ?? "");
  const [candidateChat, setCandidateChat] = useState(initial?.candidate_chat_id ?? ""), [sameChat, setSameChat] = useState(!initial?.candidate_chat_id);
  const [error, setError] = useState(""), [busy, start] = useTransition();
  useEffect(() => {
    let active = true;
    if (initial) void readTelegramSettings(true).then(value => { if (active && value) setSaved(current => current === initial ? value : current); }).catch(() => {});
    return () => { active = false; };
  }, [initial]);
  const reset = () => { setToken(""); setChat(saved?.default_chat_id ?? ""); setCandidateChat(saved?.candidate_chat_id ?? ""); setSameChat(!saved?.candidate_chat_id); setError(""); setEditing(false); };
  return <IntegrationLayout title="Telegram" description="Бот организации и чаты для уведомлений о кандидатах и новых сотрудниках."
    status={<IntegrationStatus tone={saved ? "success" : "neutral"}>{saved ? "Подключено" : "Не подключено"}</IntegrationStatus>}
    actions={saved && editable && !editing ? <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="mr-2 size-4" />Изменить</Button> : null}>
    <div className="max-w-3xl space-y-5">
      <IntegrationSection title="Бот уведомлений">
        {editing && editable ? <div className="space-y-2"><Label htmlFor="telegram-token">Токен бота</Label><Input id="telegram-token" type="password" autoComplete="new-password" value={token} disabled={busy} onChange={e => setToken(e.target.value)} placeholder={saved ? "Токен сохранён. Введите новый только для замены" : "Токен из BotFather"} /><IntegrationNotice>Добавьте бота в нужные чаты и разрешите ему отправлять сообщения.</IntegrationNotice></div>
          : <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-lg bg-muted"><MessageSquare className="size-5 text-muted-foreground" /></div><div><p className="text-sm font-medium">{saved?.bot_username ? `@${saved.bot_username}` : saved ? "Бот организации" : "Бот не подключён"}</p><p className="mt-1 text-xs text-muted-foreground">{saved ? "Токен сохранён и скрыт" : "Подключение доступно владельцу организации"}</p></div></div>}
      </IntegrationSection>
      <IntegrationSection title="Куда отправлять уведомления">
        {editing && editable ? <div className="space-y-5">
          <div className="space-y-2"><Label htmlFor="telegram-chat">Приём сотрудников · ID чата</Label><Input id="telegram-chat" value={chat} disabled={busy} onChange={e => setChat(e.target.value)} placeholder="-100…" /></div>
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={sameChat} disabled={busy} onCheckedChange={v => setSameChat(v === true)} className="mt-0.5" />Отправлять новые анкеты в этот же чат</label>
          {!sameChat ? <div className="space-y-2"><Label htmlFor="telegram-candidate-chat">Новые анкеты · ID чата</Label><Input id="telegram-candidate-chat" value={candidateChat} disabled={busy} onChange={e => setCandidateChat(e.target.value)} placeholder="-100…" /></div> : null}
        </div> : <div className="divide-y">
          {[{ title: "Новые анкеты", description: "Анкета с сайта и ссылка на кандидата", name: saved?.candidate_chat_title || (!saved?.candidate_chat_id ? saved?.default_chat_title : null), icon: MessageSquare },
            { title: "Приём сотрудников", description: "Сообщение о найме и ссылка на сотрудника", name: saved?.default_chat_title, icon: UserCheck }].map(row => <div key={row.title} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6"><div className="flex items-start gap-3"><row.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><p className="text-sm font-medium">{row.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{row.description}</p></div></div><p className="break-words pl-7 text-sm sm:max-w-[45%] sm:pl-0 sm:text-right">{row.name || (saved ? "Название чата пока недоступно" : "Не настроено")}</p></div>)}
        </div>}
      </IntegrationSection>
      {editing && editable ? <div className="space-y-3">{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<div className="flex gap-2"><Button size="sm" disabled={busy || !chat.trim() || (!sameChat && !candidateChat.trim()) || (!saved && !token.trim())} onClick={() => start(async () => {
        setError(""); try { const next = await saveOrganizationTelegram({ token: token || undefined, chat_id: chat, candidate_chat_id: sameChat ? "" : candidateChat }); setSaved(next); setToken(""); setEditing(false); toast.success("Telegram настроен"); }
        catch (e) { setError(candidateError(e, "Не удалось сохранить Telegram")); }
      })}>{busy ? "Проверяем…" : "Проверить и сохранить"}</Button>{saved ? <Button variant="outline" size="sm" disabled={busy} onClick={reset}>Отмена</Button> : null}</div></div> : null}
      {!editable ? <IntegrationNotice>Изменять подключение может владелец организации.</IntegrationNotice> : null}
    </div>
  </IntegrationLayout>;
}
