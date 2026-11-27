// Сколько ждать, пока акт соберётся: позиции уходят в Quick Resto по одной
// (пауза 300 мс в очереди клиента), их досылает фоновое задание.
//
// Pure-модуль без импортов из `@/...`: его читает node:test напрямую.

/** Секунд на позицию: пауза 300 мс в очереди клиента плюс ответ Quick Resto. */
export const CREATE_ACT_SECONDS_PER_ITEM = 0.35;
/** Создание акта, чтение и сверка в Quick Resto — сверх позиций. */
export const CREATE_ACT_OVERHEAD_SECONDS = 8;

/** Расчётное время создания акта, секунды. */
export function estimateCreateActSeconds(itemCount: number): number {
  return Math.round(CREATE_ACT_OVERHEAD_SECONDS + Math.max(0, itemCount) * CREATE_ACT_SECONDS_PER_ITEM);
}

/** «40 с», «1 мин 30 с», «2 мин» — для «осталось около …». Пробелы неразрывные. */
export function formatDurationRu(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const nb = "\u00a0";
  if (total < 60) return `${Math.max(5, Math.ceil(total / 5) * 5)}${nb}с`;
  if (total < 120) {
    const rest = Math.round((total - 60) / 10) * 10;
    if (rest >= 60) return `2${nb}мин`;
    return rest > 0 ? `1${nb}мин${nb}${rest}${nb}с` : `1${nb}мин`;
  }
  return `${Math.round(total / 60)}${nb}мин`;
}
