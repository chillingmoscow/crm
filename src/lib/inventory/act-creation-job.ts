// Фоновое создание акта: правила задания (`inventory_act_creation_jobs`,
// миграция 411), общие для обработчика, серверных действий и списка актов.
//
// Pure-модуль без импортов из `@/...`: его читает node:test напрямую.

import { CREATE_ACT_SECONDS_PER_ITEM, formatDurationRu } from "./act-create-progress.ts";

export type ActCreationJobState = "pending" | "working" | "error" | "complete";

/** Столько попыток делает обработчик, дальше задание ждёт «Повторить». */
export const ACT_CREATION_MAX_ATTEMPTS = 8;

/** Аренда задания: обработчик продлевает её по ходу. */
export const ACT_CREATION_LEASE_MS = 3 * 60_000;

/** Сколько cron-обработчик работает над заданием за один тик, потом отпускает. */
export const ACT_CREATION_CRON_BUDGET_MS = 25_000;

/** Меньше этого до дедлайна тика — задание не берём: не успеем ничего полезного. */
export const ACT_CREATION_MIN_SLICE_MS = 8_000;

/**
 * Свежее задание сначала берёт процесс, создавший акт (`after()`); cron —
 * не раньше этой задержки, чтобы не перехватить его первым.
 */
export const ACT_CREATION_INLINE_HEAD_START_MS = 20_000;

/** Как часто обработчик продлевает аренду, даже если позиции не прибавляются. */
export const ACT_CREATION_HEARTBEAT_MS = 45_000;

export type ActCreationJobStatus = {
  state: ActCreationJobState;
  done: number;
  total: number;
  attempts: number;
  error: string | null;
  /** Аренда обработчика: истекла у `working` — обработчик остановился. */
  lease_until?: string | null;
};

type JobLifecycle = Pick<ActCreationJobStatus, "state" | "attempts" | "lease_until">;

function leaseExpired(job: JobLifecycle, now: number): boolean {
  return !job.lease_until || Date.parse(job.lease_until) < now;
}

/**
 * Задание остановилось, не добрав позиций, и само уже не продолжится: нужен
 * «Повторить» или удаление акта. Попытки кончились, и задание либо
 * записало ошибку, либо обработчик последней попытки остановился вместе с
 * процессом (`working` с истёкшей арендой) — cron такие больше не берёт.
 */
export function isActCreationStuck(job: JobLifecycle | null | undefined, now: number = Date.now()): boolean {
  if (!job || job.attempts < ACT_CREATION_MAX_ATTEMPTS) return false;
  if (job.state === "error") return true;
  return job.state === "working" && leaseExpired(job, now);
}

/**
 * Акт ещё создаётся: задание не закончено и не застряло. Пока так, акт нельзя
 * назначать, заполнять, удалять и переносить по дате — позиции в нём ещё
 * меняются.
 */
export function isActCreationActive(job: JobLifecycle | null | undefined, now: number = Date.now()): boolean {
  if (!job || job.state === "complete") return false;
  return !isActCreationStuck(job, now);
}

/** Через сколько повторить после сбоя: 30 с, 1 мин, 2 мин … не больше 10 мин. */
export function actCreationRetryDelayMs(attempts: number): number {
  return Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
}

export const ACT_CREATING_LOCK_REASON = "Акт ещё создаётся — дождитесь, пока все позиции добавятся в Quick Resto";

/**
 * Короткий статус для колонки: «Создаётся» или «Не все позиции». Колонка
 * узкая, ход — в подсказке (`actCreationProgressText`).
 */
export function actCreationLabel(job: JobLifecycle): string {
  return isActCreationStuck(job) ? "Не все позиции" : "Создаётся";
}

/** Ход для подсказки и карточки акта: «Добавлено 55 из 313 · осталось около 1 мин 30 с». */
export function actCreationProgressText(job: ActCreationJobStatus): string {
  const added = `Добавлено ${job.done} из ${job.total}`;
  if (isActCreationStuck(job)) return added;
  const remaining = Math.max(0, job.total - job.done) * CREATE_ACT_SECONDS_PER_ITEM + 3;
  return `${added} · осталось около ${formatDurationRu(remaining)}`;
}
