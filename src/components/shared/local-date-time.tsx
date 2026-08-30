"use client";

import { useEffect, useState } from "react";

/**
 * Момент времени в часовом поясе пользователя — без расхождения при гидратации.
 *
 * Наивный `new Date(x).toLocaleString("ru-RU")` прямо в разметке не годится,
 * даже в клиентском компоненте: Next всё равно отрисовывает его на сервере, а
 * там часовой пояс UTC. React сравнивает серверную разметку с ПЕРВЫМ клиентским
 * рендером, и у пользователя в другом поясе они не совпадают — предупреждение о
 * гидратации и подмена текста на глазах.
 *
 * Поэтому первый рендер на обеих сторонах одинаковый (фиксированный пояс), а
 * на местное время переключаемся уже после монтирования — это обычное
 * обновление состояния, которое React не сверяет с сервером.
 */

const FIXED_ZONE = "Europe/Moscow";

function format(value: string, timeZone?: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  });
}

export function LocalDateTime({
  value,
  fallback = "—",
}: {
  value: string | null | undefined;
  fallback?: string;
}) {
  const [text, setText] = useState(() => (value ? format(value, FIXED_ZONE) : fallback));

  useEffect(() => {
    setText(value ? format(value) : fallback);
  }, [value, fallback]);

  return <>{text}</>;
}
