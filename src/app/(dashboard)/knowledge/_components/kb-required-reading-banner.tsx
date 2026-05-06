"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { markKbPageAsRead } from "@/lib/knowledge/required-reading";
import { useKbPageStateOverride } from "@/app/(dashboard)/knowledge/_components/kb-page-state-overrides-store";

interface KbRequiredReadingBannerProps {
  pageId: string;
  /** Помечена ли страница как обязательная (server-rendered initial). */
  required: boolean;
  /** Когда current user подтвердил прочтение ТЕКУЩЕЙ версии (null
   *  если не подтверждал или подтверждал старую версию). */
  initialReadAt: string | null;
  /** True если страница обновилась после прежнего подтверждения (Sprint D
   *  §2.7-A, миграция 097). UI рендерит другой баннер с акцентом «Страница
   *  обновлена, подтвердите заново», а не «Требуется прочтение». */
  needsReread?: boolean;
  /** Примерное время чтения в минутах (Sprint D §2.9). Показываем
   *  рядом с описанием баннера — снижает порог входа («это всего на
   *  3 минуты»). null/undefined = не показываем (например в short-
   *  read-confirmed badge). */
  readingMinutes?: number | null;
}

/**
 * Баннер «Требуется прочтение» / «Страница обновилась» / «✓ Прочитано».
 *
 * Состояния:
 *   1. required=false → ничего не рендерится.
 *   2. required=true + readAt=null + needsReread=false → жёлтый баннер
 *      «Требуется прочтение».
 *   3. required=true + readAt=null + needsReread=true → жёлтый баннер
 *      «Страница обновлена. Подтвердите заново» (RotateCcw иконка).
 *   4. required=true + readAt!=null → зелёный mini-badge «✓ Прочитано».
 *
 * После подтверждения — optimistic switch в зелёный badge + router
 * refresh (подтянет статус для других страниц через listKbPages).
 */
export function KbRequiredReadingBanner({
  pageId,
  required,
  initialReadAt,
  needsReread = false,
  readingMinutes = null,
}: KbRequiredReadingBannerProps) {
  const router = useRouter();
  const [readAt, setReadAt] = useState<string | null>(initialReadAt);
  const [pending, setPending] = useState(false);

  // Если admin переключил required-reading toggle, пользователь должен
  // увидеть исчезновение баннера мгновенно (без router.refresh). Берём
  // эффективное значение из override-store, fallback — server-prop.
  const override = useKbPageStateOverride(pageId);
  const effectiveRequired = override?.requiredReading ?? required;
  if (!effectiveRequired) return null;

  if (readAt) {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5
                   text-[12px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
      >
        <CheckCircle2 className="size-3.5" />
        Прочитано {formatReadAt(readAt)}
      </div>
    );
  }

  const onConfirm = async () => {
    setPending(true);
    const { error } = await markKbPageAsRead(pageId);
    setPending(false);
    if (error) {
      toast.error(`Не удалось подтвердить: ${error}`);
      return;
    }
    setReadAt(new Date().toISOString());
    toast.success("Прочтение подтверждено");
    router.refresh();
  };

  // Re-read state: страница обновилась после прежнего подтверждения.
  // Иконка RotateCcw, заголовок акцентирует «обновилась», подсказка —
  // что нужно пересмотреть и заново подтвердить.
  if (needsReread) {
    return (
      <div
        className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4
                   dark:border-yellow-900 dark:bg-yellow-950"
      >
        <span className="shrink-0 inline-flex items-center justify-center size-8 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
          <RotateCcw className="size-4" />
        </span>
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-yellow-900 dark:text-yellow-100">
            Страница обновлена
            {readingMinutes !== null && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                title={`Примерное время чтения: ${readingMinutes} мин`}
              >
                ≈ {readingMinutes} мин
              </span>
            )}
          </div>
          <div className="text-[13px] leading-snug text-yellow-800 dark:text-yellow-200">
            Содержимое изменилось с момента вашего предыдущего прочтения.
            Ознакомьтесь с обновлениями и подтвердите заново.
          </div>
        </div>
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={pending}
          className="shrink-0 bg-yellow-600 hover:bg-yellow-700 text-white"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCircle2 className="size-4" />
          )}
          Подтверждаю прочитано
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-4
                 dark:border-yellow-900 dark:bg-yellow-950"
    >
      <span className="shrink-0 inline-flex items-center justify-center size-8 rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
        <AlertTriangle className="size-4" />
      </span>
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-yellow-900 dark:text-yellow-100">
          Требуется прочтение
          {readingMinutes !== null && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
              title={`Примерное время чтения: ${readingMinutes} мин`}
            >
              ≈ {readingMinutes} мин
            </span>
          )}
        </div>
        <div className="text-[13px] leading-snug text-yellow-800 dark:text-yellow-200">
          Эта страница помечена как обязательная к прочтению. После того как
          ознакомитесь с содержимым — подтвердите прочтение.
        </div>
      </div>
      <Button
        size="sm"
        onClick={onConfirm}
        disabled={pending}
        className="shrink-0 bg-yellow-600 hover:bg-yellow-700 text-white"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        Подтверждаю прочитано
      </Button>
    </div>
  );
}

function formatReadAt(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
