"use client";

import { useState } from "react";
import { BellRing, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { unwrapAction } from "@/lib/actions/result";
import { countRu } from "@/lib/format/plural";
import { kbRereadConfirmText } from "@/lib/knowledge/reading-copy";
import {
  dismissKbReread,
  remindKbUnread,
  requestKbReread,
} from "@/lib/knowledge/reading-actions";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Напоминали меньше суток назад — повторить пока нельзя (то же правило
 *  в базе, kb_remind_unread). */
export function remindedRecently(remindedAt: string | null, now = Date.now()): boolean {
  return remindedAt !== null && now - new Date(remindedAt).getTime() < DAY_MS;
}

const people = (n: number) => countRu(n, "человек", "человека", "человек");

/**
 * Действия руководителя с обязательной страницей: «Напомнить» тем, кто не
 * прочитал, и «Попросить перечитать» после правки. Одни и те же кнопки на
 * «Кто прочитал» и в «Обзоре» («Требует внимания»).
 */
export function KbReadingActions({
  pageId,
  title,
  remindCount,
  staleCount,
  viewerStale = false,
  changedAfterRead,
  remindedAt,
  showDismiss = false,
}: {
  pageId: string;
  title: string;
  /** Кому уйдёт напоминание: не прочитали или попросили перечитать,
   *  кроме самого руководителя. */
  remindCount: number;
  /** Скольких сбросит и уведомит «Попросить перечитать». */
  staleCount: number;
  /** Сам руководитель прочитал старую версию — его прочтение тоже сбросится. */
  viewerStale?: boolean;
  changedAfterRead: boolean;
  remindedAt: string | null;
  /** «Не нужно» рядом с «Попросить перечитать» (в «Обзоре»). */
  showDismiss?: boolean;
}) {
  const { confirm, dialog } = useConfirm();
  const [busy, setBusy] = useState<"remind" | "reread" | "dismiss" | null>(null);
  const name = `«${title.trim() || "Без названия"}»`;
  const cooldown = remindedRecently(remindedAt);

  async function run<T>(kind: "remind" | "reread" | "dismiss", action: () => Promise<T>, done: (value: T) => string) {
    setBusy(kind);
    try {
      // Экран обновит само действие (revalidatePath по разделу); лишний
      // router.refresh() перерисовывал его второй раз.
      toast.success(done(await action()));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const onRemind = () =>
    run(
      "remind",
      async () => unwrapAction(await remindKbUnread(pageId)),
      ({ notified }) =>
        notified > 0 ? `Напомнили: ${people(notified)}` : "Напоминать некому: все прочитали",
    );

  const onReread = async () => {
    const ok = await confirm({
      title: `Попросить перечитать ${name}?`,
      description: kbRereadConfirmText(staleCount, viewerStale),
      confirmLabel: "Попросить перечитать",
      tone: "warning",
    });
    if (!ok) return;
    await run(
      "reread",
      async () => unwrapAction(await requestKbReread(pageId)),
      ({ notified }) =>
        notified > 0 ? `Попросили перечитать: ${people(notified)}` : "Прочтения сброшены",
    );
  };

  const onDismiss = () =>
    run(
      "dismiss",
      async () => unwrapAction(await dismissKbReread(pageId)),
      () => "Отметили: перечитывать не нужно",
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {remindCount > 0 && (
        // Причина недоступности — в самой подписи: подсказку на неактивной
        // кнопке с клавиатуры не открыть.
        <Button
          variant="outline"
          size="sm"
          onClick={onRemind}
          disabled={busy !== null || cooldown}
        >
          {busy === "remind" ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" />}
          {cooldown ? "Уже напомнили" : "Напомнить"}
        </Button>
      )}
      {changedAfterRead && (
        <>
          <Button variant="outline" size="sm" onClick={onReread} disabled={busy !== null}>
            {busy === "reread" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            Попросить перечитать
          </Button>
          {showDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy !== null}>
              {busy === "dismiss" && <Loader2 className="size-4 animate-spin" />}
              Не нужно
            </Button>
          )}
        </>
      )}
      {dialog}
    </div>
  );
}
