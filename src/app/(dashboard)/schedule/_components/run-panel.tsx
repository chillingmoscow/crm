"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditDrawer } from "@/components/ui/edit-drawer";
import { complete } from "@/lib/schedule/utils";
import { cn } from "@/lib/utils";
import type { Answer, ChecklistRun, ScheduleData } from "@/lib/schedule/types";
import {
  scheduleCommand,
  uploadEvidence,
  evidenceUrl,
  scheduleHistory,
} from "../actions";
import { toast } from "sonner";
const statusText = {
  in_progress: "В процессе",
  submitted: "Ожидает проверки",
  returned: "На доработке",
  approved: "Утверждено",
};
export function RunPanel({
  run,
  data,
  onClose,
  onUpdated,
}: {
  run: ChecklistRun;
  data: ScheduleData;
  onClose: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [answers, setAnswers] = useState(run.answers);
  const [status, setStatus] = useState(run.status);
  const [comment, setComment] = useState(run.review_comment);
  const [notes, setNotes] = useState<Record<string, string>>(
    run.review_notes ?? {},
  );
  const [saveState, setSaveState] = useState("Все изменения сохранены");
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<
    Awaited<ReturnType<typeof scheduleHistory>>
  >([]);
  const current = useRef(run.answers);
  const version = useRef(run.version);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const dirty = useRef(false);
  const mounted = useRef(true);
  const editable =
    run.user_id === data.userId && ["in_progress", "returned"].includes(status);
  const review =
    data.permissions.includes("schedule.review") && status === "submitted";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, []);
  useEffect(() => {
    let alive = true;
    scheduleHistory(run.id)
      .then((h) => {
        if (alive) setHistory(h);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [run.id, status]);
  useEffect(() => {
    let alive = true;
    const paths = Object.values(answers).filter(
      (a): a is string => typeof a === "string" && a.startsWith(run.id + "/"),
    );
    Promise.all(
      paths.map(async (p) => {
        const r = await evidenceUrl(p);
        return [p, r.url] as const;
      }),
    )
      .then((entries) => {
        if (alive)
          setUrls(
            Object.fromEntries(
              entries.filter((e): e is readonly [string, string] => !!e[1]),
            ),
          );
      })
      .catch(() => {
        if (alive) toast.error("Не удалось загрузить фотографии");
      });
    return () => {
      alive = false;
    };
  }, [answers, run.id]);
  const persist = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const snapshot = { ...current.current };
    queue.current = queue.current
      .then(async () => {
        if (mounted.current) setSaveState("Сохранение…");
        const r = await scheduleCommand("run.save", {
          id: run.id,
          version: version.current,
          answers: snapshot,
        });
        if (r.error) {
          if (mounted.current) setSaveState("Не сохранено: " + r.error);
          return false;
        }
        version.current++;
        if (JSON.stringify(current.current) === JSON.stringify(snapshot))
          dirty.current = false;
        if (mounted.current)
          setSaveState(
            dirty.current
              ? "Есть несохранённые изменения"
              : "Все изменения сохранены",
          );
        return true;
      })
      .catch(() => {
        if (mounted.current)
          setSaveState("Не сохранено. Проверьте соединение и повторите.");
        return false;
      });
    return queue.current;
  };
  const change = (id: string, value: Answer) => {
    current.current = { ...current.current, [id]: value };
    setAnswers(current.current);
    dirty.current = true;
    setSaveState("Есть несохранённые изменения");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(), 600);
  };
  const close = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!dirty.current || (await persist())) {
        await onUpdated();
        onClose();
      }
    } catch {
      toast.error("Не удалось обновить данные. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };
  const action = async (name: string) => {
    setBusy(true);
    try {
      if (name === "run.submit" && dirty.current && !(await persist())) {
        setBusy(false);
        return;
      }
      await queue.current;
      const r = await scheduleCommand(name, {
        id: run.id,
        version: version.current,
        answers: current.current,
        comment,
        notes: Object.fromEntries(
          Object.entries(notes).filter(([, v]) => v.trim()),
        ),
      });
      if (r.error) toast.error(r.error);
      else {
        version.current++;
        setStatus(
          name === "run.submit"
            ? "submitted"
            : name === "run.approve"
              ? "approved"
              : "returned",
        );
        toast.success(
          name === "run.submit"
            ? "Отправлено на проверку"
            : name === "run.approve"
              ? "Выполнение утверждено"
              : "Возвращено на доработку",
        );
        await onUpdated();
      }
    } catch {
      toast.error("Не удалось выполнить действие. Проверьте соединение.");
    } finally {
      setBusy(false);
    }
  };
  const items = run.snapshot.items;
  const required = items.filter((i) => i.required && i.kind !== "info");
  const done = items.filter(
    (i) => i.kind !== "info" && complete(i, answers[i.id]),
  ).length;
  const total = items.filter((i) => i.kind !== "info").length;
  return (
    <EditDrawer
      open
      onOpenChange={(o) => {
        if (!o) void close();
      }}
      title={run.snapshot.name}
      description={`${statusText[status]} · версия ${run.snapshot.version}`}
      footer={
        <>
          <span
            role="status"
            className="mr-auto text-xs text-muted-foreground max-w-[220px]"
          >
            {editable ? saveState : statusText[status]}
          </span>
          {editable ? (
            <>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void persist()}
              >
                Сохранить
              </Button>
              <Button
                disabled={
                  busy || required.some((i) => !complete(i, answers[i.id]))
                }
                onClick={() => void action("run.submit")}
              >
                Отправить
              </Button>
            </>
          ) : review ? (
            <>
              <Button
                variant="outline"
                disabled={
                  busy ||
                  (!comment.trim() &&
                    !Object.values(notes).some((v) => v.trim()))
                }
                onClick={() => void action("run.return")}
              >
                Вернуть
              </Button>
              <Button
                disabled={busy}
                onClick={() => void action("run.approve")}
              >
                Утвердить
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => void close()}>
              Закрыть
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>
            Выполнено {done} из {total}
          </span>
          <span>{total ? Math.round((done / total) * 100) : 100}%</span>
        </div>
        <progress
          className="w-full h-2 accent-brand"
          value={done}
          max={total || 1}
          aria-label="Выполнено пунктов"
        />
        <p className="text-xs text-muted-foreground">
          Начато{" "}
          {new Intl.DateTimeFormat("ru", {
            timeZone: data.timezone,
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(run.started_at))}{" "}
          · норма {run.snapshot.duration} мин
        </p>
      </div>
      {comment && status !== "submitted" && (
        <div className="rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium mb-1">Комментарий проверки</p>
          {comment}
        </div>
      )}
      {items.map((item, index) => (
        <div
          key={item.id}
          className={cn("space-y-2 border-b pb-5", item.parent_id && "ml-5")}
        >
          <div className="flex gap-2">
            <span className="text-xs text-muted-foreground pt-0.5">
              {index + 1}
            </span>
            <p className="text-sm font-medium">
              {item.title}
              {item.required && item.kind !== "info" && (
                <span className="text-muted-foreground"> *</span>
              )}
            </p>
          </div>
          {item.hint && (
            <p className="text-xs text-muted-foreground">{item.hint}</p>
          )}
          {item.kind === "check" && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!editable || busy}
                checked={answers[item.id] === true}
                onChange={(e) => change(item.id, e.target.checked)}
              />
              Выполнено
            </label>
          )}
          {item.kind === "info" && (
            <p className="text-xs text-muted-foreground">
              Информация, подтверждение не требуется
            </p>
          )}
          {item.kind === "text" && (
            <Textarea
              aria-label={item.title}
              disabled={!editable || busy}
              maxLength={item.max_length}
              value={String(answers[item.id] ?? "")}
              onChange={(e) => change(item.id, e.target.value)}
            />
          )}
          {item.kind === "number" && (
            <div className="flex items-center gap-2">
              <Input
                aria-label={item.title}
                disabled={!editable || busy}
                type="number"
                step="any"
                min={item.min ?? undefined}
                max={item.max ?? undefined}
                value={answers[item.id] == null ? "" : String(answers[item.id])}
                onChange={(e) =>
                  change(
                    item.id,
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
              <span className="text-sm">{item.unit}</span>
            </div>
          )}
          {item.kind === "photo" && (
            <>
              {typeof answers[item.id] === "string" &&
                urls[answers[item.id] as string] && (
                  <a
                    href={urls[answers[item.id] as string]}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                  >
                    <Image
                      unoptimized
                      width={440}
                      height={280}
                      className="rounded-lg w-full h-auto max-h-64 object-contain"
                      src={urls[answers[item.id] as string]}
                      alt={item.title}
                    />
                  </a>
                )}
              {editable && (
                <Input
                  aria-label={item.title}
                  disabled={busy}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setBusy(true);
                    try {
                      const f = new FormData();
                      f.set("file", file);
                      const r = await uploadEvidence(run.id, f);
                      if (r.error) toast.error(r.error);
                      else if (r.path) change(item.id, r.path);
                    } catch {
                      toast.error(
                        "Не удалось загрузить фотографию. Попробуйте ещё раз.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
              {!answers[item.id] && !editable && (
                <p className="text-xs text-muted-foreground">
                  Фотография не приложена
                </p>
              )}
            </>
          )}
          {notes[item.id] && status !== "submitted" && (
            <p className="text-xs rounded-md bg-muted p-2">
              Замечание: {notes[item.id]}
            </p>
          )}
          {review && (
            <Textarea
              aria-label={`Замечание к пункту ${index + 1}`}
              value={notes[item.id] ?? ""}
              maxLength={2000}
              placeholder="Замечание к пункту"
              onChange={(e) =>
                setNotes({ ...notes, [item.id]: e.target.value })
              }
            />
          )}
        </div>
      ))}
      {review && (
        <label className="grid gap-2 text-sm font-medium">
          Комментарий проверки
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Укажите, что нужно исправить при возврате"
            maxLength={5000}
          />
        </label>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">
          История выполнения
        </summary>
        <div className="grid gap-3 mt-3">
          {history.map((e) => (
            <div key={e.id}>
              <span>
                {(
                  {
                    "run.start": "Начато",
                    "run.submit": "Отправлено на проверку",
                    "run.approve": "Утверждено",
                    "run.return": "Возвращено на доработку",
                  } as Record<string, string>
                )[e.action] ?? e.action}
              </span>
              <p className="text-xs text-muted-foreground">
                {new Intl.DateTimeFormat("ru", {
                  timeZone: data.timezone,
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(new Date(e.created_at))}
              </p>
            </div>
          ))}
        </div>
      </details>
    </EditDrawer>
  );
}
