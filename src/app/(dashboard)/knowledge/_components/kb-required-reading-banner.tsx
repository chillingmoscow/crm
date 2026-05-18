"use client";

import { useEffect, useRef, useState } from "react";
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
  /** True если страница обновилась после прежнего подтверждения
   *  (миграция 097). Другой заголовок/иконка, но gate тот же. */
  needsReread?: boolean;
  /** Примерное время чтения в минутах. */
  readingMinutes?: number | null;
  /** Накопленное активное время текущего юзера на странице (сек, с
   *  сервера, миграция 183). Read-gate ориентируется на него, а не
   *  на свежий per-mount таймер — повторный заход / обновление
   *  страницы не требуют вычитывать порог заново. */
  accumulatedActiveSeconds?: number;
}

/**
 * Edge-to-edge баннер обязательного чтения (как красная плашка
 * корзины в Notion). Состояния:
 *   1. required=false → ничего.
 *   2. readAt!=null → зелёный mini-badge «Прочитано {дата}».
 *   3. needsReread → «Страница обновлена» (RotateCcw).
 *   4. иначе → «Требуется прочтение» (AlertTriangle).
 *
 * Read-gate: кнопка «Прочитано» неактивна, пока суммарное активное
 * время (накопленное на сервере + добор в текущей сессии) не
 * достигнет порога (~25% времени чтения, 10–90с). Таймер на паузе
 * при скрытой вкладке. Никакого обратного отсчёта в кнопке —
 * disabled + tooltip.
 */
export function KbRequiredReadingBanner({
  pageId,
  required,
  initialReadAt,
  needsReread = false,
  readingMinutes = null,
  accumulatedActiveSeconds = 0,
}: KbRequiredReadingBannerProps) {
  const [readAt, setReadAt] = useState<string | null>(initialReadAt);
  const [pending, setPending] = useState(false);

  const override = useKbPageStateOverride(pageId);
  const effectiveRequired = override?.requiredReading ?? required;

  const READ_GATE_MIN_SEC = 10;
  const READ_GATE_MAX_SEC = 90;
  const thresholdSec = Math.min(
    READ_GATE_MAX_SEC,
    Math.max(
      READ_GATE_MIN_SEC,
      readingMinutes != null
        ? Math.round(readingMinutes * 60 * 0.25)
        : READ_GATE_MIN_SEC,
    ),
  );

  // Стартуем с накопленного на сервере времени — если юзер уже
  // вычитал страницу раньше (или до обновления), порог пройден сразу
  // и ждать заново не нужно. Добор активных секунд в текущей сессии
  // идёт сверху (пауза при скрытой вкладке).
  const elapsedRef = useRef(accumulatedActiveSeconds);
  const [gateReady, setGateReady] = useState(
    accumulatedActiveSeconds >= thresholdSec,
  );

  useEffect(() => {
    if (elapsedRef.current >= thresholdSec) {
      setGateReady(true);
      return;
    }
    const id = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      elapsedRef.current += 1;
      if (elapsedRef.current >= thresholdSec) {
        setGateReady(true);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [thresholdSec]);

  if (!effectiveRequired) return null;

  if (readAt) {
    // Edge-to-edge slim green bar — единая разметка с жёлтым баром,
    // чтобы статус не «прыгал» по ширине после подтверждения.
    return (
      <div
        className="flex w-full items-center gap-2 border-b border-emerald-200 bg-emerald-50
                   px-6 py-2.5 text-[13px] font-medium text-emerald-700
                   md:px-8 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
      >
        <CheckCircle2 className="size-4 shrink-0" />
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
  };

  const Icon = needsReread ? RotateCcw : AlertTriangle;
  const title = needsReread ? "Страница обновлена" : "Требуется прочтение";
  const description = needsReread
    ? "Содержимое изменилось с момента вашего предыдущего прочтения. Ознакомьтесь с обновлениями и подтвердите заново."
    : "Эта страница помечена как обязательная к прочтению. После того как ознакомитесь с содержимым — подтвердите прочтение.";

  return (
    // Edge-to-edge: w-full + горизонтальный паддинг, нижний бордер,
    // без скруглений — плашка во всю ширину области (как в Notion).
    <div
      className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-b border-yellow-200 bg-yellow-50
                 px-6 py-3 md:px-8 dark:border-yellow-900 dark:bg-yellow-950"
    >
      <span className="shrink-0 inline-flex size-8 items-center justify-center rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-yellow-900 dark:text-yellow-100">
          {title}
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
          {description}
        </div>
      </div>
      <Button
        size="sm"
        onClick={onConfirm}
        disabled={pending || !gateReady}
        title={
          gateReady
            ? undefined
            : "Ознакомьтесь со страницей, прежде чем подтверждать прочтение"
        }
        className="shrink-0 bg-yellow-600 hover:bg-yellow-700 text-white"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        Прочитано
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
