"use client";
import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { DrawerSection } from "@/components/ui/drawer-blocks";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MultiOptionPicker } from "@/components/shared/multi-option-picker";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProfileSectionAddButton } from "@/components/shared/profile-section";
import { candidateError } from "@/lib/candidates/errors";
import { cn } from "@/lib/utils";
import { IntegrationNotice, IntegrationSection } from "../_components/integration-layout";
import { CHAT_ID_HINT } from "./chat-id-hint";
import { unwrapAction } from "@/lib/actions/result";
import { checkTelegramChat, saveTelegramChat, setTelegramChatArchived, type ChatCheck, type ChatRoleOption, type TelegramChatRow } from "./chat-actions";

type Draft = { id?: string; title: string; chat_id: string; invite: boolean; role_ids: string[] };
const empty: Draft = { title: "", chat_id: "", invite: true, role_ids: [] };

export function TelegramChats({ chats, roles }: { chats: TelegramChatRow[]; roles: ChatRoleOption[] }) {
  const [draft, setDraft] = useState<Draft | null>(null), [error, setError] = useState(""), [busy, start] = useTransition();
  const [checks, setChecks] = useState<Record<string, ChatCheck>>({}), [showArchive, setShowArchive] = useState(false);
  const [archiving, setArchiving] = useState<TelegramChatRow | null>(null), [archiveError, setArchiveError] = useState("");
  const live = chats.filter(c => !c.archived_at), archived = chats.filter(c => c.archived_at);
  const roleName = new Map(roles.map(r => [r.id, r.label]));
  const rolesText = (c: TelegramChatRow) => !c.invite ? "Не приглашаем" : c.role_ids.length ? c.role_ids.map(id => roleName.get(id) ?? "Архивная должность").join(", ") : "Все должности";
  const close = () => { setDraft(null); setError(""); };
  const run = (fn: () => Promise<void>) => start(async () => { try { await fn(); } catch (e) { toast.error(candidateError(e, "Не удалось выполнить действие")); } });
  const check = (c: TelegramChatRow) => run(async () => { const r = unwrapAction(await checkTelegramChat(c.id)); setChecks(v => ({ ...v, [c.id]: r })); });

  const row = (c: TelegramChatRow) => <li key={c.id} className={cn("flex items-center gap-3 py-3 first:pt-0 last:pb-0", c.archived_at && "opacity-60")}>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{c.title}</p>
      <p className="truncate text-xs text-muted-foreground">{rolesText(c)}</p>
      {checks[c.id] ? <p role="status" className={cn("mt-0.5 text-xs", checks[c.id].tone === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>{checks[c.id].message}</p> : null}
    </div>
    {c.archived_at ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(async () => { unwrapAction(await setTelegramChatArchived(c.id, false)); toast.success("Чат восстановлен"); })}><ArchiveRestore className="size-4" />Восстановить</Button>
      : <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Действия с чатом ${c.title}`} disabled={busy}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => check(c)}><ShieldCheck className="mr-2 size-4" />Проверить права бота</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDraft({ id: c.id, title: c.title, chat_id: c.chat_id, invite: c.invite, role_ids: c.role_ids })}><Pencil className="mr-2 size-4" />Изменить</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { setArchiveError(""); setArchiving(c); }}><Archive className="mr-2 size-4" />В архив</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>}
  </li>;

  return <>
    <IntegrationSection title="Чаты сотрудников" description="Принятых приглашаем, уволенных исключаем"
      actions={<ProfileSectionAddButton onClick={() => setDraft(empty)}>Добавить чат</ProfileSectionAddButton>}>
      {live.length ? <ul className="divide-y">{live.map(row)}</ul> : <IntegrationNotice>Чатов пока нет</IntegrationNotice>}
      {archived.length ? <div className="space-y-3 border-t pt-3">
        <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground" onClick={() => setShowArchive(v => !v)}>{showArchive ? "Скрыть архив" : `Архив · ${archived.length}`}</button>
        {showArchive ? <ul className="divide-y">{archived.map(row)}</ul> : null}
      </div> : null}
    </IntegrationSection>
    <EditDrawer open={!!draft} onOpenChange={o => { if (!o && !busy) close(); }} title={draft?.id ? `Чат «${draft.title || "без названия"}»` : "Новый чат"} description="Бот должен быть администратором чата с правом приглашать и блокировать участников"
      footer={<><Button variant="outline" disabled={busy} onClick={close}>Отмена</Button>
        <Button disabled={busy || !draft?.title.trim() || !draft?.chat_id.trim()} onClick={() => start(async () => {
          if (!draft) return; setError("");
          try { unwrapAction(await saveTelegramChat({ title: draft.title, chat_id: draft.chat_id, invite: draft.invite, role_ids: draft.invite ? draft.role_ids : [] }, draft.id)); toast.success("Чат сохранён"); close(); }
          catch (e) { setError(candidateError(e, "Не удалось сохранить чат")); }
        })}>{busy ? "Сохраняем…" : draft?.id ? "Сохранить" : "Добавить чат"}</Button></>}>
      {draft ? <>
        <DrawerSection title="Чат">
          <Field label="Название" required>{control => <Input {...control} value={draft.title} disabled={busy} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Общий чат бара" />}</Field>
          <Field label="ID чата" required hint={CHAT_ID_HINT}>{control => <Input {...control} autoCapitalize="off" autoCorrect="off" autoComplete="off" value={draft.chat_id} disabled={busy} onChange={e => setDraft({ ...draft, chat_id: e.target.value })} placeholder="-1001234567890" />}</Field>
        </DrawerSection>
        <DrawerSection title="Кого приглашать">
          <div className="flex items-center justify-between gap-4"><Label htmlFor="chat-invite">Приглашать при приёме</Label><Switch id="chat-invite" checked={draft.invite} disabled={busy} onCheckedChange={v => setDraft({ ...draft, invite: v })} /></div>
          {draft.invite ? <Field id="chat-roles" label="Должности" hint="Не выбрано: приглашаем все должности">
            {() => <MultiOptionPicker id="chat-roles" label="Должности" options={roles} selectedIds={draft.role_ids} disabled={busy} placeholder="Все должности" onChange={ids => setDraft({ ...draft, role_ids: ids })} />}
          </Field> : null}
        </DrawerSection>
        {error ? <p role="alert" className="mt-4 text-xs text-destructive">{error}</p> : null}
      </> : null}
    </EditDrawer>
    <ConfirmDialog open={!!archiving} onOpenChange={o => { if (!o) setArchiving(null); }} busy={busy} error={archiveError || undefined}
      title={`Убрать чат «${archiving?.title ?? ""}» в архив?`} confirmLabel="Убрать в архив" pendingLabel="Убираем…"
      description="Это не удаление: сам чат в Telegram не меняется. Новых сотрудников в него больше не приглашаем, уволенных из него не исключаем. Чат останется в блоке «Архив» внизу списка, его можно восстановить"
      onConfirm={() => start(async () => {
        if (!archiving) return; setArchiveError("");
        try { unwrapAction(await setTelegramChatArchived(archiving.id, true)); toast.success("Чат в архиве"); setArchiving(null); }
        catch (e) { setArchiveError(candidateError(e, "Не удалось убрать чат в архив")); }
      })} />
  </>;
}
