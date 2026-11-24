"use client";
import { useEffect, useState, useRef } from "react";
import { ChevronDown, Pencil, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatDayMonthTime } from "@/lib/format/date";
import { unwrapAction } from "@/lib/actions/result";
import { dayCommentCommand, loadDayDiscussion } from "../day-actions";
import type { DayComment, DayDiscussion } from "@/lib/sales/day-context";

const eventLabels: Record<string, string> = {
  created: "Создан",
  updated: "Изменён",
  deleted: "Удалён",
  restored: "Восстановлен",
  imported: "Перенесён из Glide",
  source_updated: "Обновлён из Glide",
};
export function DayDiscussionPanel(props: { venueId: string; date: string }) {
  return <Discussion key={`${props.venueId}:${props.date}`} {...props} />;
}
function Discussion({ venueId, date }: { venueId: string; date: string }) {
  const [data, setData] = useState<DayDiscussion | null>(null),
    [error, setError] = useState(""),
    [body, setBody] = useState(""),
    [editing, setEditing] = useState<DayComment | null>(null),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState<DayComment | null>(null),
    [historyOpen, setHistoryOpen] = useState<string | null>(null),
    [attempt, setAttempt] = useState(0);
  const request = useRef<{ body: string; key: string } | null>(null),
    live = useRef(true);
  useEffect(() => {
    live.current = true;
    let active = true;
    setData(null);
    setError("");
    setBody("");
    setEditing(null);
    request.current = null;
    const refresh = () =>
      loadDayDiscussion(venueId, date)
        .then(unwrapAction)
        .then((d) => {
          if (active) {
            setData(d);
            setError("");
          }
        })
        .catch(
          (e) =>
            active &&
            setError(
              e instanceof Error && /[А-Яа-яЁё]/.test(e.message)
                ? e.message
                : "Не удалось загрузить комментарии",
            ),
        );
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    return () => {
      active = false;
      live.current = false;
      clearInterval(timer);
    };
  }, [venueId, date, attempt]);
  const stamp = (value: string) =>
    formatDayMonthTime(value, new Date(), data?.timezone) ?? "";
  async function change(
    action: "create" | "edit" | "delete" | "restore",
    comment?: DayComment,
  ) {
    if (busy) return;
    setBusy(true);
    setError("");
    const draft = body.trim();
    if (action === "create" && request.current?.body !== draft)
      request.current = { body: draft, key: crypto.randomUUID() };
    try {
      const result = await dayCommentCommand(
        venueId,
        date,
        action,
        action === "create"
          ? { body: draft, request_key: request.current!.key }
          : {
              id: comment?.id,
              version: comment?.version,
              ...(action === "edit" ? { body: draft } : {}),
            },
      ).then(unwrapAction);
      if (live.current) {
        setData(result);
        setDeleting(null);
        if (action === "create" || action === "edit") {
          setBody("");
          setEditing(null);
          request.current = null;
        }
      }
    } catch (e) {
      if (live.current)
        setError(
          e instanceof Error ? e.message : "Не удалось сохранить комментарий",
        );
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      {error && (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">{error}</p>
          {!data && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAttempt((x) => x + 1)}
            >
              Повторить
            </Button>
          )}
        </div>
      )}
      {!data && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Загружаем обсуждение…
        </p>
      )}
      {data && (
        <>
          <ol className="divide-y">
            {data.comments.map((c) => (
              <li key={c.id} className="py-4 first:pt-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.author_name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <time dateTime={c.created_at}>{stamp(c.created_at)}</time>
                      {c.origin === "glide" ? " · из архива Glide" : ""}
                      {c.version > 1 && !c.deleted_at ? " · изменён" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!c.deleted_at &&
                      c.origin === "native" &&
                      c.author_id === data.currentUserId && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="touch-target size-8 text-muted-foreground"
                          disabled={busy}
                          aria-label="Изменить комментарий"
                          data-tip="Изменить"
                          onClick={() => {
                            setEditing(c);
                            setBody(c.body);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      )}
                    {(c.author_id === data.currentUserId || data.moderator) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="touch-target size-8 text-muted-foreground"
                        disabled={busy}
                        data-tip={c.deleted_at ? "Восстановить" : "Удалить"}
                        aria-label={
                          c.deleted_at
                            ? "Восстановить комментарий"
                            : "Удалить комментарий"
                        }
                        onClick={() =>
                          c.deleted_at
                            ? void change("restore", c)
                            : setDeleting(c)
                        }
                      >
                        {c.deleted_at ? (
                          <Undo2 className="size-4" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
                <p
                  className={`mt-3 whitespace-pre-wrap break-words text-sm leading-6 ${c.deleted_at ? "text-muted-foreground italic" : ""}`}
                >
                  {c.deleted_at ? "Комментарий удалён" : c.body}
                </p>
                <div className="mt-2 text-xs text-muted-foreground">
                  <button
                    type="button"
                    aria-expanded={historyOpen === c.id}
                    aria-controls={`comment-history-${c.id}`}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    onClick={() =>
                      setHistoryOpen(historyOpen === c.id ? null : c.id)
                    }
                  >
                    История
                    <ChevronDown
                      aria-hidden
                      className={`size-3.5 transition-transform ${historyOpen === c.id ? "rotate-180" : ""}`}
                    />
                  </button>
                  {historyOpen === c.id && (
                    <ol id={`comment-history-${c.id}`} className="mt-3 space-y-3 border-l pl-3">
                      <li><p>Создан · {c.author_name}</p><p className="mt-1">{stamp(c.created_at)}</p></li>
                      {data.history
                        .filter((h) => h.comment_id === c.id&&h.action!=="created")
                        .sort(
                          (a, b) =>
                            a.created_at.localeCompare(b.created_at) ||
                            a.id.localeCompare(b.id),
                        )
                        .map((h) => (
                          <li key={h.id}>
                            <p>
                              {eventLabels[h.action] ?? "Изменение"} ·{" "}
                              {h.actor_name}
                            </p>
                            <p className="mt-1">{stamp(h.created_at)}</p>
                            {h.action === "updated" &&
                              typeof (h.details.before as { body?: unknown })
                                ?.body === "string" && (
                                <p className="mt-1 whitespace-pre-wrap break-words line-through">
                                  {String(
                                    (h.details.before as { body: string }).body,
                                  )}
                                </p>
                              )}
                          </li>
                        ))}
                    </ol>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {!data.comments.length && (
            <p className="py-4 text-sm text-muted-foreground">
              Комментариев пока нет
            </p>
          )}
          <form
            className="space-y-3 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void change(editing ? "edit" : "create", editing ?? undefined);
            }}
          >
            <Field
              id={`day-comment-${date}`}
              label={editing ? "Изменить комментарий" : "Новый комментарий"}
            >
              {(control) => (
                <Textarea
                  {...control}
                  value={body}
                  disabled={busy}
                  maxLength={4000}
                  className="min-h-24"
                  placeholder="Что важно знать о смене"
                  onChange={(e) => setBody(e.target.value)}
                />
              )}
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Виден пользователям с доступом к продажам
              </span>
              <div className="flex gap-2">
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setEditing(null);
                      setBody("");
                    }}
                  >
                    Отмена
                  </Button>
                )}
                <Button
                  disabled={busy || !body.trim()}
                  type="submit"
                  className="min-w-28"
                >
                  {busy
                    ? "Сохраняем…"
                    : editing
                      ? "Сохранить"
                      : "Добавить комментарий"}
                </Button>
              </div>
            </div>
          </form>
        </>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(v) => !v && !busy && setDeleting(null)}
        title="Удалить комментарий?"
        description="Удаление останется в истории, комментарий можно будет восстановить"
        confirmLabel="Удалить комментарий"
        pendingLabel="Удаляем…"
        destructive
        busy={busy}
        error={deleting ? error || undefined : undefined}
        onConfirm={() => {
          if (deleting) void change("delete", deleting);
        }}
      />
    </div>
  );
}
