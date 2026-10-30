"use client";
import Image from "next/image";
import { useState, useTransition } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProfileSection } from "@/components/shared/profile-section";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { candidateError } from "@/lib/candidates/errors";
import type { Comment } from "@/lib/candidates/types";
import { commentCandidate, editCandidateComment } from "../actions";

export function CandidateComments({ candidateId, comments, viewerId, editable, onSaved }: {
  candidateId: string; comments: Comment[]; viewerId: string; editable: boolean; onSaved: () => Promise<void>;
}) {
  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Comment | null>(null);
  const [deleting, setDeleting] = useState<Comment | null>(null);
  const [body, setBody] = useState("");
  const [requestKey, setRequestKey] = useState("");
  const [busy, start] = useTransition();
  const close = () => { setComposing(false); setEditing(null); setBody(""); };
  const save = () => start(async () => {
    try {
      if (editing) await editCandidateComment(candidateId, editing.id, editing.revision, body);
      else await commentCandidate(candidateId, body, requestKey);
      await onSaved();
      close();
    } catch (error) { toast.error(candidateError(error, "Не удалось сохранить комментарий")); }
  });
  const editor = <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
    <Textarea autoFocus aria-label={editing ? "Изменить комментарий" : "Новый комментарий"} rows={3} maxLength={12000}
      value={body} onChange={(event) => setBody(event.target.value)} placeholder="Напишите комментарий…" disabled={busy} />
    <div className="flex gap-2">
      <Button type="submit" size="sm" disabled={busy || !body.trim()}>Сохранить</Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={close}>Отмена</Button>
    </div>
  </form>;
  return <>
    <ProfileSection title="Комментарии" actions={editable && <Button variant="ghost" size="sm" className="h-auto gap-1 p-0 text-brand hover:bg-transparent hover:text-brand/80"
      aria-label="Добавить комментарий" disabled={busy || composing || !!editing} onClick={() => { setBody(""); setRequestKey(crypto.randomUUID()); setComposing(true); }}>
      <Plus className="size-3.5" />Добавить
    </Button>}>
      {composing && editor}
      {comments.map((comment) => {
        const author = comment.author_name || "Пользователь CRM";
        return <article key={comment.id} className="flex min-w-0 gap-3 border-b pb-4 last:border-b-0 last:pb-0">
          {comment.author_avatar_url ? <Image unoptimized src={comment.author_avatar_url} alt={author} width={32} height={32} className="size-8 shrink-0 rounded-full object-cover" /> :
            <span aria-label={`Автор: ${author}`} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              {author.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
            </span>}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{author}</p>
                <p className="text-xs text-muted-foreground">{new Date(comment.created_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })}{comment.revision > 1 ? " · изменён" : ""}</p>
              </div>
              {editable && comment.author_id === viewerId && <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-7 shrink-0" disabled={busy || composing || !!editing} aria-label={`Действия с комментарием от ${author}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => { setEditing(comment); setBody(comment.body); }}><Pencil className="size-4" />Изменить</DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(comment)}><Trash2 className="size-4" />Удалить</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>}
            </div>
            {editing?.id === comment.id ? editor : <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>}
          </div>
        </article>;
      })}
      {!comments.length && !composing && <p className="text-sm text-muted-foreground">Комментариев пока нет.</p>}
    </ProfileSection>
    <AlertDialog open={!!deleting} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Удалить комментарий?</AlertDialogTitle><AlertDialogDescription>Комментарий исчезнет из анкеты. Действие сохранится в журнале.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Отмена</AlertDialogCancel>
          <AlertDialogAction disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={(event) => {
            event.preventDefault();
            if (!deleting) return;
            start(async () => {
              try { await editCandidateComment(candidateId, deleting.id, deleting.revision, null, true); await onSaved(); setDeleting(null); }
              catch (error) { toast.error(candidateError(error, "Не удалось удалить комментарий")); }
            });
          }}>Удалить</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
