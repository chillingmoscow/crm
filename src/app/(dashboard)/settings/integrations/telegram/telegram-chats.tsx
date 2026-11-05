"use client";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, MessagesSquare, Pencil, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MultiOptionPicker } from "@/components/shared/multi-option-picker";
import { candidateError } from "@/lib/candidates/errors";
import { cn } from "@/lib/utils";
import { IntegrationNotice, IntegrationSection } from "../_components/integration-layout";
import { checkTelegramChat, saveTelegramChat, setTelegramChatArchived, type ChatCheck, type ChatRoleOption, type TelegramChatRow } from "./chat-actions";

type Draft = { id?: string; title: string; chat_id: string; invite: boolean; role_ids: string[] };
const empty: Draft = { title: "", chat_id: "", invite: true, role_ids: [] };

export function TelegramChats({ chats, roles, connected }: { chats: TelegramChatRow[]; roles: ChatRoleOption[]; connected: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(""), [busy, start] = useTransition();
  const [checks, setChecks] = useState<Record<string, ChatCheck>>({}), [showArchive, setShowArchive] = useState(false);
  const live = chats.filter(c => !c.archived_at), archived = chats.filter(c => c.archived_at);
  const roleName = new Map(roles.map(r => [r.id, r.label]));
  const rolesText = (c: TelegramChatRow) => !c.invite ? "Не приглашаем" : c.role_ids.length ? c.role_ids.map(id => roleName.get(id) ?? "Архивная должность").join(", ") : "Все должности";
  const close = () => { setDraft(null); setError(""); };
  const run = (fn: () => Promise<void>) => start(async () => { try { await fn(); } catch (e) { toast.error(candidateError(e, "Не удалось выполнить действие")); } });
  const row = (c: TelegramChatRow) => <div key={c.id} className={cn("flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between", c.archived_at && "opacity-70")}>
    <div className="min-w-0 space-y-1">
      <p className="truncate text-sm font-medium">{c.title}</p>
      <p className="break-all text-xs text-muted-foreground">ID {c.chat_id}</p>
      <p className="text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">{c.invite ? "Приглашать при приёме" : "Не приглашать при приёме"}</span> · {rolesText(c)}</p>
      {checks[c.id] ? <p role="status" className={cn("text-xs", checks[c.id].tone === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{checks[c.id].message}</p> : null}
    </div>
    <div className="flex shrink-0 flex-wrap gap-2">
      {!c.archived_at ? <>
        {connected ? <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { const r = await checkTelegramChat(c.id); setChecks(v => ({ ...v, [c.id]: r })); })}><ShieldCheck className="mr-2 size-4" />Проверить</Button> : null}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setDraft({ id: c.id, title: c.title, chat_id: c.chat_id, invite: c.invite, role_ids: c.role_ids })}><Pencil className="mr-2 size-4" />Изменить</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await setTelegramChatArchived(c.id, true); toast.success("Чат в архиве"); })}><Archive className="mr-2 size-4" />В архив</Button>
      </> : <Button variant="outline" size="sm" disabled={busy} onClick={() => run(async () => { await setTelegramChatArchived(c.id, false); toast.success("Чат восстановлен"); })}><ArchiveRestore className="mr-2 size-4" />Восстановить</Button>}
    </div>
  </div>;
  return <>
    <IntegrationSection title="Чаты" description="Чаты, в которые приглашают принятых сотрудников и из которых исключают уволенных. Бот должен быть администратором чата с правом приглашать и блокировать участников."
      actions={<Button size="sm" onClick={() => setDraft(empty)}><Plus className="mr-2 size-4" />Добавить чат</Button>}>
      {live.length ? <div className="divide-y">{live.map(row)}</div>
        : <div className="flex flex-col items-center gap-2 py-6 text-center"><MessagesSquare className="size-8 text-muted-foreground" /><p className="text-sm font-medium">Чатов пока нет</p><IntegrationNotice>Добавьте чаты сотрудников, чтобы после приёма приходили ссылки-приглашения, а при увольнении сотрудник исключался автоматически.</IntegrationNotice></div>}
      {archived.length ? <div className="space-y-3 border-t pt-4">
        <Button variant="ghost" size="sm" onClick={() => setShowArchive(v => !v)}>{showArchive ? "Скрыть архив" : `Архив (${archived.length})`}</Button>
        {showArchive ? <div className="divide-y">{archived.map(row)}</div> : null}
      </div> : null}
    </IntegrationSection>
    <Dialog open={!!draft} onOpenChange={o => { if (!o && !busy) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{draft?.id ? "Изменить чат" : "Добавить чат"}</DialogTitle><DialogDescription>Бот должен быть добавлен в чат как администратор.</DialogDescription></DialogHeader>
        {draft ? <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="chat-title">Название</Label><Input id="chat-title" value={draft.title} disabled={busy} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Например, Общий чат бара" /></div>
          <div className="space-y-2"><Label htmlFor="chat-id">ID чата</Label><Input id="chat-id" inputMode="text" autoCapitalize="off" autoCorrect="off" value={draft.chat_id} disabled={busy} onChange={e => setDraft({ ...draft, chat_id: e.target.value })} placeholder="-100…" /></div>
          <div className="flex items-center justify-between gap-4"><Label htmlFor="chat-invite">Приглашать при приёме</Label><Switch id="chat-invite" checked={draft.invite} disabled={busy} onCheckedChange={v => setDraft({ ...draft, invite: v })} /></div>
          {draft.invite ? <div className="space-y-2"><Label htmlFor="chat-roles">Должности</Label>
            <MultiOptionPicker id="chat-roles" label="Должности" options={roles} selectedIds={draft.role_ids} disabled={busy} placeholder="Все должности" onChange={ids => setDraft({ ...draft, role_ids: ids })} />
            <IntegrationNotice>Если не выбрано ни одной, чат подходит для всех должностей.</IntegrationNotice></div> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div> : null}
        <DialogFooter className="gap-2 sm:gap-0"><Button variant="outline" disabled={busy} onClick={close}>Отмена</Button>
          <Button disabled={busy || !draft?.title.trim() || !draft?.chat_id.trim()} onClick={() => start(async () => {
            if (!draft) return; setError("");
            try { await saveTelegramChat({ title: draft.title, chat_id: draft.chat_id, invite: draft.invite, role_ids: draft.invite ? draft.role_ids : [] }, draft.id); toast.success("Чат сохранён"); close(); }
            catch (e) { setError(candidateError(e, "Не удалось сохранить чат")); }
          })}>{busy ? "Сохраняем…" : "Сохранить"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
