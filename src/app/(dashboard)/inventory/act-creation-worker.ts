// Фоновое добавление позиций в акт, созданный из Sheerly (задание
// `inventory_act_creation_jobs`, миграция 411). НЕ "use server": модуль
// вызывают серверное действие (через `after()`) и cron.
//
// Задание берётся с арендой. Сразу после создания акта его берёт процесс,
// который принял запрос; если процесс упал или закончилось время тика, его
// подхватывает cron `/api/cron/candidates`. Повтор сверяется с позициями,
// которые уже лежат в акте Quick Resto, — дублей нет.

import "server-only";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { writeAuditEvent } from "@/lib/audit/write";
import { LeaseLostError, leasedUpdate } from "@/lib/people/job-lease";
import { countRu } from "@/lib/format/plural";
import { addActItems, quickRestoProductKey, type ActItemPlan } from "@/lib/inventory/act-create";
import {
  ACT_CREATION_CRON_BUDGET_MS,
  ACT_CREATION_LEASE_MS,
  ACT_CREATION_MAX_ATTEMPTS,
  actCreationRetryDelayMs,
} from "@/lib/inventory/act-creation-job";
import {
  QuickRestoRateLimitError,
  createInventoryItemBackOffice,
  readInventoryDocument,
  type QuickRestoInventoryItem2,
} from "@/lib/integrations/quickresto/client";
import {
  connectionPassword,
  getConnection,
  listBackOfficeInventoryItemsWithSession,
  notifyInventoryDocumentEvent,
  quickRestoUserError,
  refreshLocalInventoryDocumentFromPayload,
  withBackOfficeSession,
  type QuickRestoConnection,
} from "./actions-shared";

const TABLE = "inventory_act_creation_jobs";

type Job = {
  id: string;
  account_id: string;
  document_id: string;
  actor_id: string | null;
  external_id: number;
  items: ActItemPlan[];
  total: number;
  done: number;
  details: ActCreationDetails;
  attempts: number;
};

/** Что записать в журнал по готовности акта. */
export type ActCreationDetails = {
  date?: string;
  store_title?: string | null;
  groups?: string[];
  comment?: string | null;
  skipped_items?: string[];
};

function checked<T>(result: { data: T | null; error: { message: string } | null }): T | null {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

/** Ключи позиций, которые уже лежат в акте Quick Resto. */
export async function readActItemKeys(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
  externalId: number;
}): Promise<Set<string>> {
  const present = await listBackOfficeInventoryItemsWithSession({
    connection: input.connection,
    admin: input.admin,
    documentExternalId: input.externalId,
  });
  return new Set(
    present
      .map((item) => {
        const product = (item as { product?: { className?: string; id?: unknown } }).product;
        return quickRestoProductKey(product?.className, product?.id);
      })
      .filter((key): key is string => Boolean(key)),
  );
}

/** Перечитать акт из Quick Resto — позиции и расчётные остатки берём у источника. */
export async function refreshActFromQuickResto(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
  accountId: string;
  documentId: string;
  externalId: number;
}) {
  try {
    const qrDoc = await readInventoryDocument({
      layerName: input.connection.login,
      login: input.connection.login,
      password: connectionPassword(input.connection),
      objectId: input.externalId,
    });
    const items = await listBackOfficeInventoryItemsWithSession({
      connection: input.connection,
      admin: input.admin,
      documentExternalId: input.externalId,
    });
    await refreshLocalInventoryDocumentFromPayload({
      admin: input.admin,
      accountId: input.accountId,
      documentId: input.documentId,
      document: { ...qrDoc, effectedItems: items },
      keepStatus: true,
    });
  } catch (error) {
    // Позиции в QR уже есть; подтянет синхронизация или «Обновить итоги».
    console.error("[act-creation] акт не перечитан из Quick Resto", { documentId: input.documentId, error });
  }
}

function safeRevalidate(documentId: string) {
  try {
    revalidatePath("/documents/inventory");
    revalidatePath(`/documents/inventory/${documentId}`);
  } catch {
    // Вне запроса (cron после ответа) кэш страниц обновит следующий заход.
  }
}

/**
 * Взять задание и досылать позиции. `id` — конкретное задание (сразу после
 * создания акта, «Повторить»), без него — следующее доступное (cron).
 * `budgetMs` — сколько работать, потом отпустить задание следующему тику.
 * Возвращает false, если брать нечего.
 */
export async function processActCreationJob(input: { id?: string; budgetMs?: number } = {}): Promise<boolean> {
  const admin = asLooseDb(createAdminClient());
  const job = checked(await admin.rpc("inventory_act_creation_claim", { p_id: input.id ?? null })) as Job | null;
  if (!job) return false;
  const startedAt = Date.now();
  const deadline = input.budgetMs ? startedAt + input.budgetMs : null;

  let lastSavedAt = 0;
  let lastSavedDone = job.done;
  const saveProgress = async (done: number, force = false) => {
    if (!force && done === lastSavedDone) return;
    if (!force && Date.now() - lastSavedAt < 2_000 && done - lastSavedDone < 10) return;
    await leasedUpdate(admin, TABLE, job, {
      done,
      lease_until: new Date(Date.now() + ACT_CREATION_LEASE_MS).toISOString(),
    });
    lastSavedAt = Date.now();
    lastSavedDone = done;
  };

  try {
    const connection = await getConnection(job.account_id);
    if (!connection) throw new Error("Подключение к Quick Resto не настроено.");
    const qrAuth = { layerName: connection.login, baseUrl: connection.backoffice_base_url };
    const readKeys = () => readActItemKeys({ connection, admin, externalId: job.external_id });

    const existingKeys = await readKeys();
    const result = await addActItems({
      items: job.items,
      existingKeys,
      readKeys,
      isRateLimit: (error) => error instanceof QuickRestoRateLimitError,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      onProgress: (inAct) => saveProgress(inAct),
      shouldStop: () => deadline !== null && Date.now() > deadline,
      add: (item) =>
        withBackOfficeSession({
          connection,
          admin,
          run: (authorization) =>
            createInventoryItemBackOffice({
              ...qrAuth,
              authorization,
              documentId: job.external_id,
              sample: item.sample as unknown as QuickRestoInventoryItem2,
              actualAmount: 0,
            }),
        }).then(() => undefined),
    });
    if (result.failure instanceof LeaseLostError) throw result.failure;
    if (result.failure) throw result.failure;

    if (result.stopped) {
      // Время тика вышло: отпускаем задание, следующий тик продолжит. Попытку
      // не засчитываем — это не сбой.
      await leasedUpdate(admin, TABLE, job, {
        state: "pending",
        done: result.inAct,
        attempts: job.attempts - 1,
        lease_until: null,
        available_at: new Date().toISOString(),
      });
      // Свои же поля поменяли — следующий leasedUpdate этого запуска не нужен.
      return true;
    }

    await saveProgress(result.inAct, true);
    await refreshActFromQuickResto({
      connection,
      admin,
      accountId: job.account_id,
      documentId: job.document_id,
      externalId: job.external_id,
    });
    await leasedUpdate(admin, TABLE, job, {
      state: "complete",
      done: result.inAct,
      error: null,
      lease_until: null,
      completed_at: new Date().toISOString(),
    });
    await announceReady(admin, job);
    safeRevalidate(job.document_id);
    return true;
  } catch (error) {
    if (error instanceof LeaseLostError) {
      console.warn("[act-creation] задание перехвачено или удалено вместе с актом", { jobId: job.id });
      return true;
    }
    console.error("[act-creation] позиции добавлены не все", { jobId: job.id, attempts: job.attempts, error });
    const own = error instanceof Error && error.message.startsWith("Подключение к Quick Resto") ? error.message : null;
    const message = own ?? quickRestoUserError(error, "Quick Resto перестал принимать позиции.");
    const giveUp = job.attempts >= ACT_CREATION_MAX_ATTEMPTS;
    try {
      await leasedUpdate(admin, TABLE, job, {
        state: "error",
        error: message.slice(0, 500),
        lease_until: null,
        available_at: new Date(Date.now() + actCreationRetryDelayMs(job.attempts)).toISOString(),
      });
    } catch (saveError) {
      if (!(saveError instanceof LeaseLostError)) throw saveError;
      return true;
    }
    if (giveUp) await announceStuck(admin, job, message);
    safeRevalidate(job.document_id);
    return true;
  }
}

/** Cron: одно задание за тик, не дольше ACT_CREATION_CRON_BUDGET_MS. */
export async function processActCreationJobs() {
  try {
    return { processed: (await processActCreationJob({ budgetMs: ACT_CREATION_CRON_BUDGET_MS })) ? 1 : 0, errors: 0 };
  } catch (error) {
    console.error("[act-creation] cron", error);
    return { processed: 0, errors: 1 };
  }
}

type DocumentInfo = {
  document_number: string | null;
  venue_id: string | null;
  assigned_to: string | null;
  reviewer_id: string | null;
};

async function loadDocument(admin: LooseDb, job: Job): Promise<DocumentInfo | null> {
  const { data } = await admin
    .from<DocumentInfo>("documents")
    .select("document_number, venue_id, assigned_to, reviewer_id")
    .eq("id", job.document_id)
    .eq("account_id", job.account_id)
    .maybeSingle();
  return data ?? null;
}

/**
 * Акт собран: журнал (одна запись на акт), уведомления исполнителю и
 * проверяющему — только сейчас, чтобы не начали считать недособранный акт, —
 * и создателю «акт готов» (колокольчик показывает его и тостом).
 */
async function announceReady(admin: LooseDb, job: Job) {
  const document = await loadDocument(admin, job);
  if (!document) return;
  const number = document.document_number ?? "";
  await writeAuditEvent({
    accountId: job.account_id,
    venueId: document.venue_id,
    userId: job.actor_id,
    actionCode: "inventory.document.created",
    entityType: "inventory_document",
    entityId: job.document_id,
    details: {
      number,
      date: job.details.date ?? null,
      store_title: job.details.store_title ?? null,
      item_count: job.total,
      groups: job.details.groups ?? [],
      comment: job.details.comment ?? null,
      assigned_to: document.assigned_to,
      reviewer_id: document.reviewer_id,
      skipped_items: job.details.skipped_items ?? [],
    },
  });
  await notifyInventoryDocumentEvent({
    admin,
    recipientId: document.assigned_to,
    actorId: job.actor_id,
    venueId: document.venue_id,
    documentId: job.document_id,
    type: "inventory.document.assigned",
    title: `Вам назначен акт инвентаризации № ${number}`,
    body: "Откройте акт, проверьте позиции и заполните фактические остатки.",
  });
  await notifyInventoryDocumentEvent({
    admin,
    recipientId: document.reviewer_id,
    actorId: job.actor_id,
    venueId: document.venue_id,
    documentId: job.document_id,
    type: "inventory.document.review_assigned",
    title: `Вы назначены проверяющим по акту № ${number}`,
    body: "Когда исполнитель завершит акт, проверьте итоги и при необходимости верните на пересчёт.",
  });
  const skipped = job.details.skipped_items ?? [];
  await notifyCreator(admin, job, document, {
    type: "inventory.document.creation_done",
    title: `Акт № ${number} готов`,
    body:
      `Все ${countRu(job.total, "позиция добавлена", "позиции добавлены", "позиций добавлены")} в Quick Resto.` +
      (skipped.length > 0 ? ` Не попали без данных Quick Resto: ${skipped.slice(0, 3).join(", ")}.` : ""),
  });
}

/** Попытки кончились: создателю — что акт неполный и что делать. */
async function announceStuck(admin: LooseDb, job: Job, reason: string) {
  const document = await loadDocument(admin, job);
  if (!document) return;
  await notifyCreator(admin, job, document, {
    type: "inventory.document.creation_failed",
    title: `Акт № ${document.document_number ?? ""} собран не полностью`,
    body: `${reason} Откройте список актов и нажмите «Повторить» у этого акта или удалите его.`,
  });
}

/** Создателю — даже если он и есть автор события (общий хелпер такие пропускает). */
async function notifyCreator(
  admin: LooseDb,
  job: Job,
  document: DocumentInfo,
  message: { type: string; title: string; body: string },
) {
  if (!job.actor_id) return;
  const { error } = await admin.from("notifications").insert({
    user_id: job.actor_id,
    venue_id: document.venue_id,
    type: message.type,
    category: "inventory",
    title: message.title,
    body: message.body,
    link: `/documents/inventory/${job.document_id}`,
    actor_user_id: null,
    entity_type: "inventory_document",
    entity_id: job.document_id,
  });
  if (error) console.error(`[act-creation] уведомление ${message.type} не записано`, error);
}
