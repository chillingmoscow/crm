// Чистые правила проведения взвешивания: маркер акта в Quick Resto, какие
// позиции ещё нужно добавить, сверка акта со взвешиванием, расписание повторов
// и текст ошибки для мастера. Без сети и базы — тестируется node:test.

import type {
  QuickRestoInventoryDocument2,
  QuickRestoInventoryItem2,
} from "../integrations/quickresto/client";
import { dateMs, externalProductId, isDeletedQuickRestoRow } from "../integrations/quickresto/normalize.ts";
import {
  countConfigSchema,
  netKgBySection,
  submitErrors,
  weighingDraftSchema,
  type CountConfig,
  type WeighingDraft,
} from "./tobacco-weighing.ts";

export type WantedLine = { externalProductId: number; kg: number };

/** Маркер задания в комментарии акта: по нему повтор находит уже созданный акт. */
export function commitMarker(occurrenceId: string): string {
  return `sheerly:weighing:${occurrenceId}`;
}

/**
 * Акт этого задания среди актов Quick Resto: не удалённый, с маркером в
 * комментарии. Двух таких быть не должно; если всё же есть — берём проведённый
 * (его итоги уже двинули остатки), иначе созданный первым.
 */
export function findMarkedDocument<T extends Pick<QuickRestoInventoryDocument2, "id" | "comment" | "processed">>(
  docs: T[],
  marker: string,
): T | null {
  const marked = docs.filter(
    (doc) => !isDeletedQuickRestoRow(doc) && typeof doc.comment === "string" && doc.comment.includes(marker),
  );
  if (marked.length === 0) return null;
  const ordered = [...marked].sort((a, b) => a.id - b.id);
  return ordered.find((doc) => doc.processed) ?? ordered[0];
}

export type CommitInput =
  | {
      ok: true;
      config: CountConfig;
      draft: WeighingDraft;
      /** Дата акта: начало взвешивания (первая сохранённая партия). */
      invoiceDateMs: number;
      netKg: Record<string, number>;
    }
  | { ok: false; error: string };

const INVALID = "Взвешивание не прошло проверку";

/**
 * Проверка задания перед проведением — каждый раз, до первого обращения к
 * Quick Resto. Сдача идёт RPC, которую можно вызвать из браузера в обход формы
 * (0 г, партия без фото), поэтому проверку формы повторяем здесь.
 */
export function validateCommitInput(occurrence: {
  status: string;
  userId: string | null;
  snapshot: unknown;
  answers: unknown;
}): CommitInput {
  const fail = (reason: string): CommitInput => ({ ok: false, error: `${INVALID}: ${reason}` });
  const snapshot = (occurrence.snapshot ?? {}) as { kind?: unknown; count_config?: unknown };
  if (snapshot.kind !== "stock_count") return fail("это задание не взвешивание");
  if (occurrence.status !== "completed") return fail("задание не сдано");
  if (!occurrence.userId) return fail("не указан исполнитель");
  const config = countConfigSchema.safeParse(snapshot.count_config);
  if (!config.success) return fail("настройка взвешивания повреждена");
  const answers = (occurrence.answers ?? {}) as { weighing?: unknown };
  const draft = weighingDraftSchema.safeParse(answers.weighing);
  if (!draft.success) return fail("данные взвешивания повреждены");
  const errors = submitErrors(draft.data, config.data);
  if (errors.length > 0) return fail(errors[0]);
  const invoiceDateMs = draft.data.startedAt ? Date.parse(draft.data.startedAt) : Number.NaN;
  if (!Number.isFinite(invoiceDateMs)) return fail("не известно время начала взвешивания");
  return {
    ok: true,
    config: config.data,
    draft: draft.data,
    invoiceDateMs,
    netKg: netKgBySection(draft.data, config.data),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Акты, среди которых ищется маркер: живые, на складе взвешивания и с датой
 * рядом с началом взвешивания (Quick Resto может сдвинуть дату на часовой пояс).
 * Если склада или даты в списке нет, акт оставляем — его проверят чтением:
 * пропустить свой акт значит создать второй.
 */
export function markerSearchCandidates<T extends Pick<QuickRestoInventoryDocument2, "store" | "invoiceDate">>(
  docs: T[],
  input: { storeExternalId: number; invoiceDateMs: number; windowMs?: number },
): T[] {
  const windowMs = input.windowMs ?? 3 * DAY_MS;
  return docs.filter((doc) => {
    if (isDeletedQuickRestoRow(doc)) return false;
    const storeId = doc.store?.id;
    if (typeof storeId === "number" && storeId !== input.storeExternalId) return false;
    const at = dateMs(doc.invoiceDate);
    if (at !== null && Math.abs(at - input.invoiceDateMs) > windowMs) return false;
    return true;
  });
}

function liveLinesByProduct(items: QuickRestoInventoryItem2[]): Map<string, QuickRestoInventoryItem2[]> {
  const out = new Map<string, QuickRestoInventoryItem2[]>();
  for (const item of items) {
    if (isDeletedQuickRestoRow(item)) continue;
    const productId = externalProductId(item);
    if (!productId) continue;
    out.set(productId, [...(out.get(productId) ?? []), item]);
  }
  return out;
}

/** Позиции взвешивания, которых в акте ещё нет (повтор после частичного создания). */
export function missingLines(existing: QuickRestoInventoryItem2[], wanted: WantedLine[]): WantedLine[] {
  const present = liveLinesByProduct(existing);
  return wanted.filter((line) => !present.has(String(line.externalProductId)));
}

export type LineProblem = {
  kind: "duplicate" | "missing" | "amount";
  externalProductId: number;
};

/** Граммы — целые, поэтому расхождение меньше половины грамма считаем шумом float. */
const KG_TOLERANCE = 0.0005;

/**
 * Сверка акта перед проведением: каждая позиция взвешивания — ровно одной
 * строкой и с тем же фактом. Задвоенная строка удвоила бы факт, а значит, и
 * удержание из зарплаты, — такой акт не проводим.
 */
export function lineProblems(items: QuickRestoInventoryItem2[], wanted: WantedLine[]): LineProblem[] {
  const present = liveLinesByProduct(items);
  const out: LineProblem[] = [];
  for (const line of wanted) {
    const rows = present.get(String(line.externalProductId)) ?? [];
    if (rows.length === 0) out.push({ kind: "missing", externalProductId: line.externalProductId });
    else if (rows.length > 1) out.push({ kind: "duplicate", externalProductId: line.externalProductId });
    else {
      const amount = rows[0].actualAmount;
      if (typeof amount !== "number" || Math.abs(amount - line.kg) > KG_TOLERANCE) {
        out.push({ kind: "amount", externalProductId: line.externalProductId });
      }
    }
  }
  return out;
}

/** Строка, чей воркер молчит дольше, считается брошенной: упавший процесс. */
export const LEASE_STALE_MS = 10 * 60 * 1000;

type QueueRow = { status: string; next_attempt_at: string; updated_at: string };

/**
 * Можно ли захватить строку проведения: `due` — пора повторить, `stale` —
 * воркер в `processing` не подаёт признаков жизни дольше аренды.
 */
export function claimKind(row: QueueRow, now: Date): "due" | "stale" | null {
  if (row.status === "pending") return Date.parse(row.next_attempt_at) <= now.getTime() ? "due" : null;
  if (row.status === "processing") {
    return Date.parse(row.updated_at) < now.getTime() - LEASE_STALE_MS ? "stale" : null;
  }
  return null;
}

type TelegramRow = {
  status: string;
  telegram_status: string;
  telegram_attempts: number;
  telegram_next_attempt_at: string | null;
  updated_at: string;
};

/**
 * Что делать с отчётом проведённого акта. `send` — пора (повторно) отправить;
 * `abandon` — отправка зависла посреди вызова Telegram: дошло ли сообщение,
 * неизвестно, поэтому не повторяем, а закрываем как неудачу.
 */
export function telegramStep(row: TelegramRow, now: Date): "send" | "abandon" | null {
  if (row.status !== "done") return null;
  if (row.telegram_status === "sending") {
    return Date.parse(row.updated_at) < now.getTime() - LEASE_STALE_MS ? "abandon" : null;
  }
  if (row.telegram_status !== "pending" && row.telegram_status !== "failed") return null;
  if (row.telegram_attempts >= MAX_COMMIT_ATTEMPTS || !row.telegram_next_attempt_at) return null;
  return Date.parse(row.telegram_next_attempt_at) <= now.getTime() ? "send" : null;
}

export const MAX_COMMIT_ATTEMPTS = 5;
const RETRY_DELAYS_MIN = [1, 5, 15, 60];

/**
 * Когда повторить после неудачной попытки номер `attempts` (считая её).
 * null — попытки кончились, проведение переходит в «Ошибка проведения».
 */
export function nextAttemptAt(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_COMMIT_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MIN[Math.max(0, attempts - 1)] ?? RETRY_DELAYS_MIN[RETRY_DELAYS_MIN.length - 1];
  return new Date(now.getTime() + delay * 60_000);
}

/**
 * Отказ шага с нашим собственным русским текстом. `terminal` — повтор ничего
 * не изменит (взвешивание не прошло проверку, нет образца позиции), сразу
 * «Ошибка проведения».
 */
export class CommitStepError extends Error {
  readonly terminal: boolean;
  constructor(message: string, options: { terminal?: boolean } = {}) {
    super(message);
    this.name = "CommitStepError";
    this.terminal = options.terminal === true;
  }
}

export const COMMIT_FALLBACK_ERROR = "Не удалось провести акт в Quick Resto";

const CYRILLIC = /[а-яё]/i;
/** Сырые тексты клиента Quick Resto: тело ответа, сеть, Keycloak, HTTP-статусы. */
const RAW_QUICK_RESTO = /^Quick Resto(?: вернул ошибку|:| \(Keycloak\)| back-office| request| auth)/;
const MAX_ERROR_LENGTH = 500;

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

function cleanText(message: string): string | null {
  const text = message.trim();
  if (!text || !CYRILLIC.test(text) || RAW_QUICK_RESTO.test(text)) return null;
  // «Не удалось провести акт в Quick Resto: <ответ Quick Resto>» — начало наше,
  // хвост сырой: оставляем только начало.
  const split = text.indexOf(": ");
  if (split > 0) {
    const head = text.slice(0, split);
    const tail = cleanText(text.slice(split + 2));
    if (CYRILLIC.test(head) && tail === null) return head;
  }
  return text;
}

/**
 * Текст `last_error`: его видит мастер в задании. Свой текст шага и русские
 * тексты функции проведения проходят; английский, сырой ответ Quick Resto,
 * ошибки базы — общая фраза. Сырой текст вызывающий пишет в лог.
 */
export function commitErrorText(error: unknown): string {
  if (error instanceof CommitStepError) return error.message.slice(0, MAX_ERROR_LENGTH);
  const text = cleanText(messageOf(error)) ?? COMMIT_FALLBACK_ERROR;
  return text.slice(0, MAX_ERROR_LENGTH);
}
