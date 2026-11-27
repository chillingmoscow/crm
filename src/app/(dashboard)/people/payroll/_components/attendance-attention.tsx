"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { countRu } from "@/lib/format/plural";
import { cn } from "@/lib/utils";
import { loadAttendanceAttention } from "../actions";
import { unwrapAction } from "@/lib/actions/result";
import { attentionKey, type AttentionSnapshot } from "@/lib/payroll/attention-snapshot";

const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString("ru-RU", { month: "long", timeZone: "UTC" });

/**
 * Уведомление «За ноябрь 3 выхода ждут проверки» над «Расписанием» и
 * «Зарплатой». Считает то же, что список «На проверке» в «Сверке отметок»,
 * и ведёт туда. Пересчитывается при смене месяцев, по `refreshKey` (решение
 * по смене) и раз в минуту, пока вкладка открыта. Нет выходов — нет блока.
 *
 * `initial` — счётчики, посчитанные сервером при отрисовке страницы: с ними
 * уведомление есть в первой же разметке и не сдвигает страницу, появляясь
 * после загрузки скриптов.
 */
export function AttendanceAttentionNotice({
  months,
  refreshKey = 0,
  initial,
  className,
}: {
  months: string[];
  refreshKey?: number;
  initial?: AttentionSnapshot;
  className?: string;
}) {
  const key = attentionKey(months);
  const [state, setState] = useState<AttentionSnapshot | null>(initial ?? null);
  // Серверные счётчики свежие — первое чтение пропускаем (и при повторном
  // запуске эффекта), дальше по таймеру, при смене месяцев или решении.
  const serverKey = useRef(initial?.key ?? null);
  useEffect(() => {
    if (!key) return;
    let active = true;
    const skipFirst = serverKey.current === key && refreshKey === 0;
    const load = () => {
      serverKey.current = null;
      void loadAttendanceAttention(key.split(","))
        .then(unwrapAction)
        .then((items) => {
          if (active) setState({ key, items });
        })
        .catch(() => {
          // Уведомление вспомогательное: при сбое просто не показываем его.
          if (active) setState(null);
        });
    };
    if (!skipFirst) load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [key, refreshKey]);

  const items = state?.key === key ? state.items.filter((item) => item.count > 0) : [];
  if (!items.length) return null;
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const period = items.map((item) => monthName(item.month)).join(" и ");
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm",
        className,
      )}
    >
      <span className="flex min-w-0 items-start gap-2">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <span>
          За {period} {countRu(total, "выход ждёт", "выхода ждут", "выходов ждут")} проверки: нет отметки
          Quick Resto или она расходится с графиком.
        </span>
      </span>
      <Button asChild variant="outline" size="sm">
        <Link href={`/schedule/attendance?month=${items[0].month}`}>Проверить</Link>
      </Button>
    </div>
  );
}
