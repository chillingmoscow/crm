"use client";

import { CircleHelp } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Знак «?» рядом с показателями времени на дашборде. По клику
 * раскрывает понятное человеку объяснение того, как считается
 * время чтения — без технических терминов. Popover (а не tooltip):
 * текст в несколько предложений на hover-подсказке плохо читается
 * и обрезается, а по клику его спокойно прочитают и закроют.
 */
export function KbTimeMetricHint() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Как считается время чтения"
          className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground/70 hover:text-foreground transition-colors align-middle"
        >
          <CircleHelp className="size-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
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
