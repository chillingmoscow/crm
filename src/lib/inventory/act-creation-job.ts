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
export const ACT_CREATION_CRON_BUDGET_MS = 40_000;

export type ActCreationJobStatus = {
  state: ActCreationJobState;
  done: number;
  total: number;
  attempts: number;
  error: string | null;
};

/**
 * Акт ещё создаётся: задание не закончено и попытки не кончились. Пока так,
 * акт нельзя назначать, заполнять, удалять и переносить по дате — позиции в
 * нём ещё меняются.
 */
export function isActCreationActive(job: Pick<ActCreationJobStatus, "state" | "attempts"> | null | undefined): boolean {
  if (!job || job.state === "complete") return false;
  return job.state !== "error" || job.attempts < ACT_CREATION_MAX_ATTEMPTS;
}

/** Задание остановилось, не добрав позиций: нужен «Повторить» или удаление акта. */
export function isActCreationStuck(job: Pick<ActCreationJobStatus, "state" | "attempts"> | null | undefined): boolean {
  return Boolean(job && job.state === "error" && job.attempts >= ACT_CREATION_MAX_ATTEMPTS);
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
export function actCreationLabel(job: Pick<ActCreationJobStatus, "state" | "attempts">): string {
  return isActCreationStuck(job) ? "Не все позиции" : "Создаётся";
}

/** Ход для подсказки и карточки акта: «Добавлено 55 из 313 · осталось около 1 мин 30 с». */
export function actCreationProgressText(job: ActCreationJobStatus): string {
  const added = `Добавлено ${job.done} из ${job.total}`;
  if (isActCreationStuck(job)) return added;
  const remaining = Math.max(0, job.total - job.done) * CREATE_ACT_SECONDS_PER_ITEM + 3;
  return `${added} · осталось около ${formatDurationRu(remaining)}`;
}
