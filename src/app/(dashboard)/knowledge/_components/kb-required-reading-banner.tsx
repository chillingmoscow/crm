"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookCheck, Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/shared/confirm-dialog";
import { unwrapAction } from "@/lib/actions/result";
import { requestKbReread } from "@/lib/knowledge/reading-actions";
import { countRu } from "@/lib/format/plural";
import { kbRereadConfirmText } from "@/lib/knowledge/reading-copy";
import { markKbPageAsRead } from "@/lib/knowledge/required-reading";
import { kbReadingPlate } from "@/lib/knowledge/document";
import { formatDayMonth } from "@/lib/format/date";
import { cn } from "@/lib/utils";
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
  /** Для руководителя с правом обязательного чтения: сколько человек
   *  прочитали текущую версию из скольких. null — не показывать. */
  stats?: {
    read: number;
    total: number;
    /** Страницу правили после чьего-то прочтения (сводка 416). */
    changedAfterRead: boolean;
    /** Скольких других сбросит «Попросить перечитать» (им придёт уведомление). */
    staleOthers: number;
    /** У самого руководителя тоже прочитана не последняя версия. */
    selfStale: boolean;
  } | null;
  /** Название страницы — для окна подтверждения. */
  pageTitle?: string;
  /** slug страницы — ссылка «Кто прочитал». */
  pageSlug?: string;
  /** Право обязательного чтения: ссылка «Кто прочитал» видна и тогда,
   *  когда счётчика ещё нет (флаг только что включили в меню ⋯). */
  canSeeReaders?: boolean;
}

/**
 * Плашка обязательного чтения в колонке документа, под заголовком
 * (состояние — `kbReadingPlate` в src/lib/knowledge/document.ts):
 *   1. страница не обязательная → ничего;
 *   2. прочитана → зелёная «Прочитано {дата}»;
 *   3. изменилась после прочтения → жёлтая с RotateCcw;
 *   4. иначе → жёлтая «Обязательно к прочтению» с BookCheck.
 * Руководителю справа — «Прочитали N из M» и ссылка «Кто прочитал».
 *
 * Кнопка «Прочитано» неактивна, пока суммарное активное время
 * (накопленное на сервере + добор в текущей сессии) не достигнет порога
 * (~25% времени чтения, 10–90 с); рядом — подсказка «Сначала прочитайте
 * страницу». Таймер на паузе при скрытой вкладке.
 */
export function KbRequiredReadingBanner({
  pageId,
  required,
  initialReadAt,
  needsReread = false,
  readingMinutes = null,
  accumulatedActiveSeconds = 0,
  stats = null,
  canSeeReaders = false,
  pageSlug,
  pageTitle,
}: KbRequiredReadingBannerProps) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [readAt, setReadAt] = useState<string | null>(initialReadAt);
  // После router.refresh (например, «Попросить перечитать») сервер присылает
  // новое значение — локальное состояние должно его подхватить.
  useEffect(() => setReadAt(initialReadAt), [initialReadAt]);
  const [pending, setPending] = useState(false);
  const [rereadPending, setRereadPending] = useState(false);

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

  const plate = kbReadingPlate({
    required: effectiveRequired,
    readAt,
    // После подтверждения в этой сессии старое «нужно перечитать» снято.
    needsReread: needsReread && !readAt,
    gateReady,
    changedAfterRead: stats?.changedAfterRead ?? false,
  });
  if (plate.kind === "none") return null;

  const onRequestReread = async () => {
    const ok = await confirm({
      title: `Попросить перечитать «${pageTitle?.trim() || "Без названия"}»?`,
      description: kbRereadConfirmText(stats?.staleOthers ?? 0, stats?.selfStale ?? false),
      confirmLabel: "Попросить перечитать",
      tone: "warning",
    });
    if (!ok) return;
    setRereadPending(true);
    try {
      const { notified } = unwrapAction(await requestKbReread(pageId));
      toast.success(
        notified > 0
          ? `Попросили перечитать: ${countRu(notified, "человек", "человека", "человек")}`
          : "Прочтения сброшены",
      );
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setRereadPending(false);
    }
  };

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

  const minutes = readingMinutes !== null ? ` · ≈ ${readingMinutes} мин` : "";

  // Плашка в колонке документа: встроенное предупреждение DS (amber) или
  // подтверждение (emerald); руководителю справа — сколько прочитали.
  return (
    <div
      className={cn(
        // Не хватает места — правая часть (статистика, кнопки) уходит на
        // вторую строку, заголовок не обрезается.
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3 text-sm",
        plate.kind === "read"
          ? "border-emerald-500/30 bg-emerald-500/10"
          : "border-amber-500/30 bg-amber-500/10",
      )}
    >
      <div className="flex min-w-[14rem] flex-1 items-center gap-2.5">
        {plate.kind === "read" ? (
          <Check className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
        ) : plate.reread ? (
          <RotateCcw className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        ) : (
          <BookCheck className="size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        )}
        <span className="min-w-0">
          <span className="font-semibold">
            {plate.kind === "read"
              ? `Прочитано ${formatDayMonth(plate.readAt) ?? ""}`.trim()
              : plate.reread
                ? "Страница изменилась, прочитайте снова"
                : "Обязательно к прочтению"}
          </span>
          {plate.kind === "unread" && minutes && (
            <span className="whitespace-nowrap text-[13px] text-muted-foreground">{minutes}</span>
          )}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
        {stats && stats.total > 0 && (
          <>
            <span className="text-[13px] tabular-nums text-muted-foreground">
              Прочитали {stats.read} из {stats.total}
            </span>
            <span
              className="h-1.5 w-[90px] overflow-hidden rounded-full bg-brand/15"
              role="progressbar"
              aria-label="Прочитали"
              aria-valuenow={stats.read}
              aria-valuemin={0}
              aria-valuemax={stats.total}
            >
              <span
                className="block h-full rounded-full bg-brand"
                style={{ width: `${Math.round((stats.read / stats.total) * 100)}%` }}
              />
            </span>
          </>
        )}
        {(canSeeReaders || (stats && stats.total > 0)) && pageSlug && (
          <Button variant="outline" size="sm" asChild>
            <Link href={`/knowledge/${pageSlug}/required-reading`}>Кто прочитал</Link>
          </Button>
        )}
        {plate.kind === "unread" && (
          <>
            {!plate.canConfirm && (
              <span className="text-[13px] text-muted-foreground">
                Сначала прочитайте страницу
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onConfirm}
              disabled={pending || !plate.canConfirm}
              className="max-sm:w-full"
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Прочитано
            </Button>
          </>
        )}
      </div>

      {plate.changedAfterRead && (
        <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-2 border-t border-foreground/10 pt-2">
          <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-muted-foreground">
            <RotateCcw className="size-4 shrink-0" />
            Изменена после прочтения
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onRequestReread}
            disabled={rereadPending}
            className="max-sm:w-full"
          >
            {rereadPending && <Loader2 className="size-4 animate-spin" />}
            Попросить перечитать
          </Button>
        </div>
      )}
      {dialog}
    </div>
  );
}
