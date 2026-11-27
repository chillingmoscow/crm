// Ход создания акта для панели «Создать акт».
//
// Создание большого акта идёт минуты: позиции уходят в Quick Resto по одной.
// Серверное действие держит ход в памяти процесса, а панель опрашивает его
// GET-маршрутом `/api/inventory/create-act-progress`. Не server action:
// Next выполняет действия одного клиента по очереди, и опрос ждал бы конца
// создания. Не база: ход нужен только на время запроса, а писать строку на
// каждую позицию — лишняя нагрузка. Прод — один процесс Next, поэтому памяти
// хватает; если ход не найден, панель показывает расчётное время.
//
// Pure-модуль без импортов из `@/...`: его читает node:test напрямую.

export type CreateActPhase = "creating" | "items" | "finishing";

export type CreateActProgress = {
  phase: CreateActPhase;
  done: number;
  total: number;
};

type Entry = CreateActProgress & { userId: string; updatedAt: number };

/** Запись старше этого срока — брошенная (процесс упал, вкладку закрыли). */
const STALE_MS = 15 * 60_000;

/** Секунд на позицию: пауза 300 мс в очереди клиента плюс ответ Quick Resto. */
export const CREATE_ACT_SECONDS_PER_ITEM = 0.35;
/** Создание акта, чтение и сверка в Quick Resto — сверх позиций. */
export const CREATE_ACT_OVERHEAD_SECONDS = 8;

export function createProgressStore(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  const prune = () => {
    const limit = now() - STALE_MS;
    for (const [key, entry] of entries) if (entry.updatedAt < limit) entries.delete(key);
  };
  return {
    set(attemptId: string, userId: string, progress: CreateActProgress) {
      prune();
      entries.set(attemptId, { ...progress, userId, updatedAt: now() });
    },
    /** Ход только для того, кто создаёт акт. */
    get(attemptId: string, userId: string): CreateActProgress | null {
      const entry = entries.get(attemptId);
      if (!entry || entry.userId !== userId || entry.updatedAt < now() - STALE_MS) return null;
      return { phase: entry.phase, done: entry.done, total: entry.total };
    },
    delete(attemptId: string) {
      entries.delete(attemptId);
    },
  };
}

type ProgressStore = ReturnType<typeof createProgressStore>;

/**
 * Одно хранилище на процесс: через globalThis, чтобы серверное действие и
 * маршрут видели одну карту, даже если сборщик положил модуль в два чанка.
 */
export function createActProgressStore(): ProgressStore {
  const holder = globalThis as typeof globalThis & { __sheerlyCreateActProgress?: ProgressStore };
  holder.__sheerlyCreateActProgress ??= createProgressStore();
  return holder.__sheerlyCreateActProgress;
}

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

/**
 * Доля готовности для полосы: по реальному ходу, а без него — по прошедшему
 * времени против расчётного (не выше 95%, пока сервер не ответил).
 */
export function progressFraction(input: {
  progress: CreateActProgress | null;
  elapsedSeconds: number;
  estimatedSeconds: number;
}): number {
  const { progress } = input;
  if (progress && progress.phase === "items" && progress.total > 0) {
    // Позиции — основная часть пути; создание и сверка — по 5% с краёв.
    return Math.min(0.95, 0.05 + 0.9 * (progress.done / progress.total));
  }
  if (progress?.phase === "finishing") return 0.97;
  if (input.estimatedSeconds <= 0) return 0;
  return Math.min(0.95, input.elapsedSeconds / input.estimatedSeconds);
}

/** Сколько ещё ждать, секунды: по реальному темпу, а без хода — по расчёту. */
export function remainingSeconds(input: {
  progress: CreateActProgress | null;
  elapsedSeconds: number;
  estimatedSeconds: number;
}): number {
  const { progress } = input;
  if (progress && progress.phase === "items" && progress.total > 0) {
    return Math.max(0, progress.total - progress.done) * CREATE_ACT_SECONDS_PER_ITEM + 3;
  }
  if (progress?.phase === "finishing") return 3;
  return Math.max(0, input.estimatedSeconds - input.elapsedSeconds);
}
