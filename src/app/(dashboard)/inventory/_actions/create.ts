"use server";

// Создание акта инвентаризации из Sheerly: акт заводится в Quick Resto и сразу
// появляется у нас, без ожидания синхронизации.

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { chunk, fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  getAssignmentConflictReason,
  ineligibleAssigneeMessage,
  isEligibleForRole,
} from "@/lib/inventory/act-assignment";
import { loadAssignmentEligibility } from "@/lib/inventory/assignment-eligibility-server";
import {
  CREATE_ACT_KINDS,
  CREATE_ACT_MAX_ITEMS,
  buildGroupTree,
  collectGroupSubtree,
  planActItems,
  validateCreateActInput,
  type CreateActGroup,
  type CreateActGroupNode,
  type CreateActInput,
  type CreateActNomenclatureKind,
  type CreateActProduct,
} from "@/lib/inventory/act-create";
import { backOfficeTimeZoneParam, moveInvoiceDate } from "@/lib/inventory/act-date";
import { processActCreationJob } from "../act-creation-worker";
import {
  ACT_CREATION_INLINE_HEAD_START_MS,
  isActCreationStuck,
  type ActCreationJobState,
} from "@/lib/inventory/act-creation-job";
import {
  QuickRestoRateLimitError,
  createInventoryDocumentBackOffice,
  listInventoryDocuments,
  readInventoryDocument,
  removeInventoryDocumentBackOffice,
  type QuickRestoInventoryDocument2,
} from "@/lib/integrations/quickresto/client";
import { isBackOfficePermissionError } from "@/lib/integrations/quickresto/auth-state";
import { isDeletedQuickRestoRow } from "@/lib/integrations/quickresto/normalize";
import {
  assertDocumentVisible,
  connectionPassword,
  dateText,
  getActiveContext,
  getConnection,
  inventoryDocumentNumber,
  quickRestoUserError,
  withBackOfficeSession,
  type QuickRestoConnection,
} from "../actions-shared";

const MANAGE = "inventory.manage_documents";


export type CreateActStoreOption = {
  id: string;
  title: string;
  venueId: string | null;
  /** Пояс заведения склада: в нём панель ставит время акта по умолчанию. */
  timeZone: string;
};

export type CreateActOptions = {
  stores: CreateActStoreOption[];
  groups: CreateActGroupNode[];
  /** Позиций в каждой группе без подгрупп: панель считает выбор сама. */
  productCountByGroup: Record<string, number>;
};

type GroupRow = { id: string; parent_group_id: string | null; name: string; kind: CreateActNomenclatureKind };
type ProductRow = {
  id: string;
  group_id: string | null;
  kind: CreateActNomenclatureKind;
  external_id: string | null;
  name: string;
  raw_payload: unknown;
};

const toGroup = (row: GroupRow): CreateActGroup => ({
  id: row.id,
  parentId: row.parent_group_id,
  name: row.name,
  kind: row.kind,
});

async function loadGroups(admin: LooseDb, accountId: string): Promise<CreateActGroup[]> {
  const rows = await fetchAllRows<GroupRow>(() =>
    admin
      .from<GroupRow[]>("ingredient_groups")
      .select("id, parent_group_id, name, kind")
      .eq("account_id", accountId)
      .in("kind", [...CREATE_ACT_KINDS]),
  );
  return rows.map(toGroup);
}

/**
 * Что нужно панели «Создать акт»: склады и дерево групп каталога с числом
 * позиций. Грузится при открытии панели, а не со списком актов — список
 * открывают гораздо чаще, чем создают акт.
 */
export async function loadCreateActOptions(): Promise<{ error: string | null; options?: CreateActOptions }> {
  try {
    const ctx = await getActiveContext(MANAGE);
    if (ctx.error || !ctx.accountId) return { error: ctx.error ?? "Не удалось определить аккаунт" };
    const admin = asLooseDb(createAdminClient());

    // Склады — через RLS-клиент: склад чужого заведения в панели не нужен.
    const [{ data: stores, error: storesError }, groups, counts] = await Promise.all([
      asLooseDb(ctx.supabase)
        .from<Array<{ id: string; title: string; local_venue_id: string | null; external_id: string | null }>>("stores")
        .select("id, title, local_venue_id, external_id")
        .eq("account_id", ctx.accountId)
        .is("archived_at", null)
        .order("title"),
      loadGroups(admin, ctx.accountId),
      fetchAllRows<{ id: string; group_id: string | null }>(() =>
        admin
          .from<Array<{ id: string; group_id: string | null }>>("ingredients")
          .select("id, group_id")
          .eq("account_id", ctx.accountId as string)
          .in("kind", [...CREATE_ACT_KINDS])
          .is("archived_at", null)
          .not("group_id", "is", null),
      ),
    ]);
    if (storesError) {
      console.error("[loadCreateActOptions] склады не прочитаны", storesError);
      return { error: "Не удалось загрузить склады. Попробуйте ещё раз." };
    }

    const venueIds = Array.from(
      new Set((stores ?? []).map((store) => store.local_venue_id).filter((id): id is string => Boolean(id))),
    );
    const { data: venueRows } = venueIds.length
      ? await admin
          .from<Array<{ id: string; timezone: string | null }>>("venues")
          .select("id, timezone")
          .in("id", venueIds)
      : { data: [] as Array<{ id: string; timezone: string | null }> };
    const timeZoneByVenue = new Map((venueRows ?? []).map((venue) => [venue.id, venue.timezone]));

    const productCountByGroup = new Map<string, number>();
    for (const row of counts) {
      if (!row.group_id) continue;
      productCountByGroup.set(row.group_id, (productCountByGroup.get(row.group_id) ?? 0) + 1);
    }
    return {
      error: null,
      options: {
        stores: (stores ?? [])
          // Склад без числового id Quick Resto акт не примет.
          .filter((store) => Number.isInteger(Number(store.external_id)) && Boolean(store.external_id))
          .map((store) => ({
            id: store.id,
            title: store.title,
            venueId: store.local_venue_id,
            timeZone: (store.local_venue_id && timeZoneByVenue.get(store.local_venue_id)) || DEFAULT_TIME_ZONE,
          })),
        groups: buildGroupTree({ groups, productCountByGroup }),
        productCountByGroup: Object.fromEntries(productCountByGroup),
      },
    };
  } catch (error) {
    console.error("[loadCreateActOptions] исключение", error);
    return { error: "Не удалось загрузить данные для нового акта. Попробуйте ещё раз." };
  }
}


type DocumentRow = {
  id: string;
  external_id: string;
  document_number: string;
  processed: boolean;
  archived_at: string | null;
  venue_id: string | null;
  store_id: string | null;
  invoice_date: string | null;
};

const DOCUMENT_COLUMNS = "id, external_id, document_number, processed, archived_at, venue_id, store_id, invoice_date";

/**
 * Создать акт инвентаризации: акт в Quick Resto (номер — из preinit, как в
 * интерфейсе QR) и у нас — сразу, а позиции выбранных групп досылает в фоне
 * задание `inventory_act_creation_jobs` (см. act-creation-worker.ts). Панель
 * закрывается, как только акт заведён; в списке он «Создаётся · N из M»,
 * по готовности создателю приходит уведомление, исполнителю и проверяющему —
 * назначение.
 *
 * Повтор той же попытки (тот же `attemptId`, пока панель открыта) второй акт
 * не заводит. Синхронизация дубля не создаст: акт у нас лежит с тем же id
 * Quick Resto (`external_id`), а синк ищет строку именно по нему.
 */
export async function createInventoryAct(
  input: CreateActInput,
): Promise<{ error: string | null; documentId?: string; number?: string; warning?: string }> {
  const log = (message: string, extra?: unknown) =>
    console.warn(`[createInventoryAct] ${message}`, { attemptId: input.attemptId, extra });
  try {
    const ctx = await getActiveContext(MANAGE);
    if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error ?? "Не удалось определить аккаунт" };
    const accountId = ctx.accountId;
    const actorId = ctx.user.id;

    const normalized: CreateActInput = {
      ...input,
      groupIds: Array.from(new Set(input.groupIds ?? [])),
      comment: (input.comment ?? "").trim(),
      assignedTo: input.assignedTo || null,
      reviewerId: input.reviewerId || null,
    };
    const invalid = validateCreateActInput(normalized);
    if (invalid) return { error: invalid };

    const admin = asLooseDb(createAdminClient());

    // Склад — через RLS-клиент: склад чужого заведения недоступен, даже если знать id.
    const { data: store } = await asLooseDb(ctx.supabase)
      .from<{ id: string; title: string; external_id: string | null; local_venue_id: string | null; archived_at: string | null }>("stores")
      .select("id, title, external_id, local_venue_id, archived_at")
      .eq("account_id", accountId)
      .eq("id", normalized.storeId)
      .maybeSingle();
    if (!store || store.archived_at) return { error: "Склад не найден. Обновите страницу." };
    const externalStoreId = Number(store.external_id);
    if (!Number.isInteger(externalStoreId)) {
      return { error: "У склада нет связи с Quick Resto. Запустите синхронизацию складов." };
    }

    // Исполнитель и проверяющий — по тем же правилам, что и назначение из списка.
    if (normalized.assignedTo || normalized.reviewerId) {
      const eligibility = await loadAssignmentEligibility({ admin, accountId });
      for (const [role, userId] of [
        ["assignee", normalized.assignedTo],
        ["reviewer", normalized.reviewerId],
      ] as const) {
        if (userId && !isEligibleForRole({ eligibility, role, venueId: store.local_venue_id, userId })) {
          return { error: ineligibleAssigneeMessage(role) };
        }
      }
      const conflict = getAssignmentConflictReason({
        role: "reviewer",
        userId: normalized.reviewerId,
        assignedTo: normalized.assignedTo,
        reviewerId: null,
      });
      if (conflict) return { error: conflict };
    }

    // Состав акта — из каталога: выбранные группы с подгруппами, живые позиции.
    const groups = await loadGroups(admin, accountId);
    const subtree = [...collectGroupSubtree(groups, normalized.groupIds)];
    if (subtree.length === 0) return { error: "Выбранные группы не найдены. Обновите страницу." };
    const productRows: ProductRow[] = [];
    for (const ids of chunk(subtree, 150)) {
      productRows.push(
        ...(await fetchAllRows<ProductRow>(() =>
          admin
            .from<ProductRow[]>("ingredients")
            .select("id, group_id, kind, external_id, name, raw_payload")
            .eq("account_id", accountId)
            .in("group_id", ids)
            .is("archived_at", null),
        )),
      );
    }
    const products: CreateActProduct[] = productRows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      kind: row.kind,
      externalId: row.external_id,
      name: row.name,
      rawPayload: row.raw_payload,
    }));
    const plan = planActItems({ groups, products, selectedGroupIds: normalized.groupIds });
    if (plan.items.length === 0) {
      return { error: "В выбранных группах нет позиций. Выберите другие группы или синхронизируйте номенклатуру." };
    }
    if (plan.items.length > CREATE_ACT_MAX_ITEMS) {
      return {
        error: `В акт попадает ${plan.items.length} позиций — больше ${CREATE_ACT_MAX_ITEMS}. Разделите группы на несколько актов.`,
      };
    }

    const connection = await getConnection(accountId);
    if (!connection) return { error: "Подключение к Quick Resto не настроено." };
    const qrAuth = { layerName: connection.login, baseUrl: connection.backoffice_base_url };

    // Дата и время — в поясе заведения склада, как в окне смены даты акта.
    const timeZone = (await venueTimeZone(admin, store.local_venue_id)) ?? DEFAULT_TIME_ZONE;
    const invoiceDate = moveInvoiceDate({ original: null, day: normalized.date, time: normalized.time, timeZone });
    if (invoiceDate === null) return { error: "Укажите дату и время акта." };

    // ── Повтор той же попытки (двойное нажатие, обрыв связи) ────────────────
    // Акт уже заведён — второй не создаём, отвечаем тем же актом.
    const { data: previous } = await admin
      .from<DocumentRow>("documents")
      .select(DOCUMENT_COLUMNS)
      .eq("account_id", accountId)
      .eq("creation_attempt_id", normalized.attemptId)
      .maybeSingle();
    if (previous) {
      const { data: previousJob } = await admin
        .from<{ id: string }>("inventory_act_creation_jobs")
        .select("id")
        .eq("account_id", accountId)
        .eq("document_id", previous.id)
        .maybeSingle();
      if (previousJob) after(() => runJobInBackground(previousJob.id));
      return { error: null, documentId: previous.id, number: previous.document_number };
    }

    // ── Акт в Quick Resto и у нас ───────────────────────────────────────────
    let createdDoc;
    try {
      createdDoc = await withBackOfficeSession({
        connection,
        admin,
        run: (authorization) =>
          createInventoryDocumentBackOffice({
            ...qrAuth,
            authorization,
            storeId: externalStoreId,
            invoiceDate,
            timeZoneOffset: backOfficeTimeZoneParam(invoiceDate, timeZone),
            comment: normalized.comment,
          }),
      });
    } catch (error) {
      console.error("[createInventoryAct] Quick Resto не создал акт", error);
      // Ответ мог потеряться (таймаут, обрыв связи), а акт в Quick Resto —
      // создаться. Без этой проверки повтор завёл бы второй акт, а первый,
      // пустой, позже пришёл бы синхронизацией.
      const lost =
        error instanceof QuickRestoRateLimitError || isBackOfficePermissionError(error)
          ? null
          : await findActAfterLostResponse({
              connection,
              admin,
              accountId,
              externalStoreId,
              invoiceDate,
              comment: normalized.comment,
            });
      if (!lost) return { error: quickRestoUserError(error, "Quick Resto не создал акт. Попробуйте ещё раз.") };
      log("ответ create потерян, акт найден в Quick Resto", { externalId: lost.id });
      createdDoc = lost;
    }
    if (typeof createdDoc?.id !== "number") {
      log("create вернул акт без id", createdDoc);
      return { error: "Quick Resto не создал акт. Попробуйте ещё раз." };
    }
    const savedInvoiceDate = dateText(createdDoc.invoiceDate);
    if (savedInvoiceDate && Date.parse(savedInvoiceDate) !== invoiceDate) {
      // Не ошибка для пользователя: акт создан, а синхронизация и карточка
      // покажут дату Quick Resto. Но сдвиг — повод проверить пояс.
      log("Quick Resto сохранил другое время акта", { sent: invoiceDate, saved: savedInvoiceDate, timeZone });
    }

    const { data: document, error: saveError } = await admin
      .from<DocumentRow>("documents")
      .upsert(
        {
          account_id: accountId,
          external_id: String(createdDoc.id),
          document_kind: "inventory",
          document_number: inventoryDocumentNumber(createdDoc),
          invoice_date: savedInvoiceDate ?? new Date(invoiceDate).toISOString(),
          store_id: store.id,
          external_store_id: String(externalStoreId),
          status: normalized.assignedTo ? "assigned" : "synced",
          processed: false,
          results_has_line_amounts: false,
          comment: normalized.comment || null,
          synced_at: new Date().toISOString(),
          assigned_to: normalized.assignedTo,
          reviewer_id: normalized.reviewerId,
          creation_attempt_id: normalized.attemptId,
        },
        { onConflict: "account_id,external_id" },
      )
      .select(DOCUMENT_COLUMNS)
      .single();
    if (saveError || !document?.id) {
      // Чаще всего — двойное нажатие: эту же попытку уже сохранил другой
      // запрос. Пустой акт, который создали мы, убираем, чтобы не плодить
      // пустышки в Quick Resto.
      console.error("[createInventoryAct] акт не сохранён у нас", saveError);
      await removeEmptyQuickRestoAct({ connection, admin, externalId: createdDoc.id });
      return { error: "Не удалось сохранить акт. Обновите страницу и проверьте список актов." };
    }

    // ── Задание: позиции досылаются в фоне ──────────────────────────────────
    const groupNames = groups
      .filter((group) => normalized.groupIds.includes(group.id))
      .map((group) => group.name);
    const { data: job, error: jobError } = await admin
      .from<{ id: string }>("inventory_act_creation_jobs")
      .insert({
        account_id: accountId,
        document_id: document.id,
        actor_id: actorId,
        external_id: createdDoc.id,
        items: plan.items,
        total: plan.items.length,
        // Первым задание берёт этот процесс (after() ниже); cron — только если
        // тот не взял, иначе тик мог перехватить его раньше.
        available_at: new Date(Date.now() + ACT_CREATION_INLINE_HEAD_START_MS).toISOString(),
        details: {
          date: normalized.date,
          time: normalized.time,
          store_title: store.title,
          groups: groupNames,
          comment: normalized.comment || null,
          skipped_items: plan.skipped.slice(0, 20),
        },
      })
      .select("id")
      .single();
    if (jobError || !job?.id) {
      console.error("[createInventoryAct] задание не записано", jobError);
      await removeEmptyQuickRestoAct({ connection, admin, externalId: createdDoc.id, localId: document.id, accountId });
      return { error: "Не удалось создать акт. Попробуйте ещё раз." };
    }

    // Позиции — после ответа: панель закрывается, акт уже в списке со
    // статусом «Создаётся». Если процесс упадёт, задание подхватит cron.
    after(() => runJobInBackground(job.id));
    revalidatePath("/documents/inventory");
    return {
      error: null,
      documentId: document.id,
      number: document.document_number,
      ...(plan.skipped.length > 0
        ? {
            warning: `Не попадут в акт ${plan.skipped.length} позиций без данных Quick Resto: ${plan.skipped
              .slice(0, 3)
              .join(", ")}${plan.skipped.length > 3 ? " и другие" : ""}. Синхронизируйте номенклатуру.`,
          }
        : {}),
    };
  } catch (error) {
    console.error("[createInventoryAct] исключение", { attemptId: input.attemptId, error });
    return { error: "Не удалось создать акт. Попробуйте ещё раз." };
  }
}

async function runJobInBackground(jobId: string) {
  try {
    await processActCreationJob({ id: jobId });
  } catch (error) {
    // Задание останется в очереди — его подхватит cron.
    console.error("[createInventoryAct] фоновое добавление позиций", { jobId, error });
  }
}

const DEFAULT_TIME_ZONE = "Europe/Moscow";

async function venueTimeZone(admin: LooseDb, venueId: string | null): Promise<string | null> {
  if (!venueId) return null;
  const { data } = await admin
    .from<{ timezone: string | null }>("venues")
    .select("timezone")
    .eq("id", venueId)
    .maybeSingle();
  return data?.timezone ?? null;
}

/** Удалить пустой акт в Quick Resto (и нашу строку, если она есть). Ошибка — только в лог. */
async function removeEmptyQuickRestoAct(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
  externalId: number;
  localId?: string;
  accountId?: string;
}) {
  try {
    const qrDoc = await readInventoryDocument({
      layerName: input.connection.login,
      login: input.connection.login,
      password: connectionPassword(input.connection),
      objectId: input.externalId,
    });
    await withBackOfficeSession({
      connection: input.connection,
      admin: input.admin,
      run: (authorization) =>
        removeInventoryDocumentBackOffice({
          layerName: input.connection.login,
          baseUrl: input.connection.backoffice_base_url,
          authorization,
          document: qrDoc,
        }),
    });
    if (input.localId && input.accountId) {
      await input.admin.from("documents").delete().eq("id", input.localId).eq("account_id", input.accountId);
    }
  } catch (error) {
    console.error("[createInventoryAct] пустой акт не удалён из Quick Resto", {
      externalId: input.externalId,
      error,
    });
  }
}

/**
 * «Повторить» у акта, в который не все позиции добавились (попытки кончились):
 * задание снова в очередь, первая попытка — сразу. Уже добавленные позиции
 * не повторяются — обработчик сверяется с актом.
 */
export async function retryInventoryActCreation(input: { documentId: string }): Promise<{ error: string | null }> {
  try {
    const ctx = await getActiveContext(MANAGE);
    if (ctx.error || !ctx.accountId) return { error: ctx.error ?? "Не удалось определить аккаунт" };
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
    const admin = asLooseDb(createAdminClient());
    const { data: job } = await admin
      .from<{ id: string; state: ActCreationJobState; attempts: number; lease_until: string | null }>(
        "inventory_act_creation_jobs",
      )
      .select("id, state, attempts, lease_until")
      .eq("account_id", ctx.accountId)
      .eq("document_id", input.documentId)
      .maybeSingle();
    if (!job || job.state === "complete") return { error: "Все позиции уже в акте. Обновите страницу." };
    if (!isActCreationStuck(job)) return { error: "Позиции ещё добавляются — дождитесь окончания." };
    // Сравнение со снимком (состояние, попытки, аренда): если задание за это
    // время кто-то взял, перезапуска не будет. Застрявшее `working` (обработчик
    // последней попытки остановился вместе с процессом) — аренда истекла.
    let reset = admin
      .from<Array<{ id: string }>>("inventory_act_creation_jobs")
      .update({ state: "pending", attempts: 0, error: null, lease_until: null, available_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("state", job.state)
      .eq("attempts", job.attempts);
    reset = job.lease_until ? reset.eq("lease_until", job.lease_until) : reset.is("lease_until", null);
    const { data: updated } = await reset.select("id");
    if (!updated?.length) return { error: "Задание уже перезапущено. Обновите страницу." };
    after(() => runJobInBackground(job.id));
    revalidatePath("/documents/inventory");
    return { error: null };
  } catch (error) {
    console.error("[retryInventoryActCreation] исключение", error);
    return { error: "Не удалось перезапустить добавление позиций. Попробуйте ещё раз." };
  }
}

/**
 * Акт, который Quick Resto создал, но ответ до нас не дошёл: тот же склад,
 * та же дата до миллисекунды и тот же комментарий, не проведён, не удалён, ещё
 * не связан ни с одним нашим актом и обновлялся в последние 15 минут. Ровно
 * один такой — он наш; ноль или несколько — не гадаем (null).
 */
async function findActAfterLostResponse(input: {
  connection: QuickRestoConnection;
  admin: LooseDb;
  accountId: string;
  externalStoreId: number;
  invoiceDate: number;
  comment: string;
}): Promise<QuickRestoInventoryDocument2 | null> {
  try {
    const list = await listInventoryDocuments({
      layerName: input.connection.login,
      login: input.connection.login,
      password: connectionPassword(input.connection),
    });
    const freshSince = Date.now() - 15 * 60_000;
    const candidates = (list ?? []).filter((doc) => {
      if (typeof doc.id !== "number" || doc.processed || isDeletedQuickRestoRow(doc)) return false;
      if (doc.store?.id !== input.externalStoreId) return false;
      const date = dateText(doc.invoiceDate);
      if (!date || Date.parse(date) !== input.invoiceDate) return false;
      if ((typeof doc.comment === "string" ? doc.comment.trim() : "") !== input.comment) return false;
      const updated = dateText(doc.lastUpdateDate);
      return !updated || Date.parse(updated) >= freshSince;
    });
    if (candidates.length === 0) return null;
    const { data: linked } = await input.admin
      .from<Array<{ external_id: string }>>("documents")
      .select("external_id")
      .eq("account_id", input.accountId)
      .in("external_id", candidates.map((doc) => String(doc.id)));
    const taken = new Set((linked ?? []).map((row) => row.external_id));
    const free = candidates.filter((doc) => !taken.has(String(doc.id)));
    return free.length === 1 ? free[0] : null;
  } catch (error) {
    console.error("[createInventoryAct] акт после потерянного ответа не найден", error);
    return null;
  }
}
