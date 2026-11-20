"use client";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MultiOptionPicker } from "@/components/shared/multi-option-picker";
import { candidateError } from "@/lib/candidates/errors";
import { cn } from "@/lib/utils";
import { IntegrationNotice, IntegrationSection } from "../_components/integration-layout";
import { checkTelegramChat, saveTelegramChat, setTelegramChatArchived, type ChatCheck, type ChatRoleOption, type TelegramChatRow } from "./chat-actions";

type Draft = { id?: string; title: string; chat_id: string; invite: boolean; role_ids: string[] };
const empty: Draft = { title: "", chat_id: "", invite: true, role_ids: [] };

export function TelegramChats({ chats, roles }: { chats: TelegramChatRow[]; roles: ChatRoleOption[] }) {
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(""), [busy, start] = useTransition();
  const [checks, setChecks] = useState<Record<string, ChatCheck>>({}), [showArchive, setShowArchive] = useState(false);
  const live = chats.filter(c => !c.archived_at), archived = chats.filter(c => c.archived_at);
  const roleName = new Map(roles.map(r => [r.id, r.label]));
  const rolesText = (c: TelegramChatRow) => !c.invite ? "Не приглашаем" : c.role_ids.length ? c.role_ids.map(id => roleName.get(id) ?? "Архивная должность").join(", ") : "Все должности";
  const close = () => { setDraft(null); setError(""); };
  const run = (fn: () => Promise<void>) => start(async () => { try { await fn(); } catch (e) { toast.error(candidateError(e, "Не удалось выполнить действие")); } });
  const check = (c: TelegramChatRow) => run(async () => { const r = await checkTelegramChat(c.id); setChecks(v => ({ ...v, [c.id]: r })); });

  const row = (c: TelegramChatRow) => <li key={c.id} className={cn("flex items-center gap-3 py-3 first:pt-0 last:pb-0", c.archived_at && "opacity-60")}>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{c.title}</p>
      <p className="truncate text-xs text-muted-foreground">{rolesText(c)}</p>
      {checks[c.id] ? <p role="status" className={cn("mt-0.5 text-xs", checks[c.id].tone === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{checks[c.id].message}</p> : null}
    </div>
    {c.archived_at ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(async () => { await setTelegramChatArchived(c.id, false); toast.success("Чат восстановлен"); })}><ArchiveRestore className="mr-2 size-4" />Восстановить</Button>
      : <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Действия с чатом ${c.title}`} disabled={busy}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => check(c)}><ShieldCheck className="mr-2 size-4" />Проверить права бота</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDraft({ id: c.id, title: c.title, chat_id: c.chat_id, invite: c.invite, role_ids: c.role_ids })}><Pencil className="mr-2 size-4" />Изменить</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => run(async () => { await setTelegramChatArchived(c.id, true); toast.success("Чат в архиве"); })}><Archive className="mr-2 size-4" />В архив</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>}
  </li>;

  return <>
    <IntegrationSection title="Чаты сотрудников" description="Принятых приглашаем, уволенных исключаем."
      actions={<Button variant="outline" size="sm" onClick={() => setDraft(empty)}><Plus className="mr-2 size-4" />Добавить чат</Button>}>
      {live.length ? <ul className="divide-y">{live.map(row)}</ul> : <IntegrationNotice>Чатов пока нет.</IntegrationNotice>}
      {archived.length ? <div className="space-y-3 border-t pt-3">
        <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground" onClick={() => setShowArchive(v => !v)}>{showArchive ? "Скрыть архив" : `Архив · ${archived.length}`}</button>
        {showArchive ? <ul className="divide-y">{archived.map(row)}</ul> : null}
      </div> : null}
    </IntegrationSection>
    <EditDrawer open={!!draft} onOpenChange={o => { if (!o && !busy) close(); }} title={draft?.id ? "Изменить чат" : "Новый чат"} description="Сначала добавьте бота в чат администратором с правом приглашать и блокировать участников."
      footer={<><Button variant="outline" disabled={busy} onClick={close}>Отмена</Button>
        <Button disabled={busy || !draft?.title.trim() || !draft?.chat_id.trim()} onClick={() => start(async () => {
          if (!draft) return; setError("");
          try { await saveTelegramChat({ title: draft.title, chat_id: draft.chat_id, invite: draft.invite, role_ids: draft.invite ? draft.role_ids : [] }, draft.id); toast.success("Чат сохранён"); close(); }
          catch (e) { setError(candidateError(e, "Не удалось сохранить чат")); }
        })}>{busy ? "Сохраняем…" : draft?.id ? "Сохранить" : "Добавить чат"}</Button></>}>
      {draft ? <>
        <DrawerSection title="Чат">
          <div className="space-y-1.5"><Label htmlFor="chat-title">Название</Label><Input id="chat-title" value={draft.title} disabled={busy} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Общий чат бара" /></div>
          <div className="space-y-1.5"><Label htmlFor="chat-id">ID чата</Label><Input id="chat-id" autoCapitalize="off" autoCorrect="off" autoComplete="off" value={draft.chat_id} disabled={busy} onChange={e => setDraft({ ...draft, chat_id: e.target.value })} placeholder="-1001234567890" />
            <p className="text-xs text-muted-foreground">Откройте чат в web.telegram.org — ID в адресе после #.</p></div>
        </DrawerSection>
        <DrawerSection title="Кого приглашать">
          <label className="flex items-center justify-between gap-4 text-sm font-medium">Приглашать при приёме<Switch checked={draft.invite} disabled={busy} onCheckedChange={v => setDraft({ ...draft, invite: v })} /></label>
          {draft.invite ? <div className="space-y-1.5"><Label htmlFor="chat-roles">Должности</Label>
            <MultiOptionPicker id="chat-roles" label="Должности" options={roles} selectedIds={draft.role_ids} disabled={busy} placeholder="Все должности" onChange={ids => setDraft({ ...draft, role_ids: ids })} />
            <p className="text-xs text-muted-foreground">Не выбрано — приглашаем все должности.</p></div> : null}
        </DrawerSection>
        {error ? <p role="alert" className="mt-4 text-xs text-destructive">{error}</p> : null}
      </> : null}
    </EditDrawer>
  </>;
}
