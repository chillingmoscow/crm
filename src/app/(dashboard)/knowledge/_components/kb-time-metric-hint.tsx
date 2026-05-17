"use client";

import { CircleHelp } from "lucide-react";

import { IconTooltip } from "@/components/ui/icon-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Знак «?» в топбаре дашборда, слева от колокольчика. По клику
 * раскрывает понятное человеку объяснение того, как считается
 * время чтения — без технических терминов. Popover (а не tooltip):
 * текст в несколько предложений на hover-подсказке плохо читается
 * и обрезается, а по клику его спокойно прочитают и закроют.
 * Кнопка повторяет геометрию NotificationBell (size-9, rounded-lg).
 */
export function KbTimeMetricHint() {
  return (
    <Popover>
      <IconTooltip label="Как считается время">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Как считается время чтения"
            className="relative inline-flex items-center justify-center size-9 rounded-lg bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <CircleHelp className="w-[18px] h-[18px]" />
          </button>
        </PopoverTrigger>
      </IconTooltip>
      <PopoverContent
        align="end"
        className="w-80 text-sm leading-relaxed"
      >
        <p className="font-semibold text-foreground">
          Как считается время чтения
        </p>
        <p className="mt-1.5 text-muted-foreground">
          Засчитывается только активное время: пока страница открыта
          во вкладке и человек на ней что-то делает — нажимает,
          печатает, листает или касается экрана. Если отвлёкся и
          больше минуты ничего не делает — отсчёт останавливается.
        </p>
        <p className="mt-1.5 text-muted-foreground">
          Когда человек уходит со страницы или закрывает вкладку, время
          фиксируется. Открытая и забытая вкладка статистику не
          накручивает. Очень длинные сессии разбиваются на части
          примерно по 30 минут.
        </p>
      </PopoverContent>
    </Popover>
  );
}
