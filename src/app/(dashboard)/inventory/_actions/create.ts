"use server";

// Создание акта инвентаризации из Sheerly: акт заводится в Quick Resto и сразу
// появляется у нас, без ожидания синхронизации.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import { chunk, fetchAllRows } from "@/lib/supabase/fetch-all";
import { writeAuditEvent } from "@/lib/audit/write";
import { countRu } from "@/lib/format/plural";
import {
  getAssignmentConflictReason,
  ineligibleAssigneeMessage,
  isEligibleForRole,
} from "@/lib/inventory/act-assignment";
import { loadAssignmentEligibility } from "@/lib/inventory/assignment-eligibility-server";
import {
  CREATE_ACT_KINDS,
  CREATE_ACT_MAX_ITEMS,
  actInvoiceDateMs,
  addActItems,
  buildGroupTree,
  collectGroupSubtree,
  planActItems,
  quickRestoProductKey,
  validateCreateActInput,
  type CreateActGroup,
  type CreateActGroupNode,
  type CreateActInput,
  type CreateActNomenclatureKind,
  type CreateActProduct,
} from "@/lib/inventory/act-create";
import {
  createInventoryDocumentBackOffice,
  createInventoryItemBackOffice,
  QuickRestoRateLimitError,
  readInventoryDocument,
  removeInventoryDocumentBackOffice,
  type QuickRestoInventoryItem2,
} from "@/lib/integrations/quickresto/client";
import {
  connectionPassword,
  dateText,
  getActiveContext,
  getConnection,
  inventoryDocumentNumber,
  listBackOfficeInventoryItemsWithSession,
  notifyInventoryDocumentEvent,
  refreshLocalInventoryDocumentFromPayload,
  revalidateInventoryResultPages,
  withBackOfficeSession,
  type QuickRestoConnection,
} from "../actions-shared";

const MANAGE = "inventory.manage_documents";

export type CreateActStoreOption = {
  id: string;
  title: string;
  venueId: string | null;
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
          .map((store) => ({ id: store.id, title: store.title, venueId: store.local_venue_id })),
        groups: buildGroupTree({ groups, productCountByGroup }),
        productCountByGroup: Object.fromEntries(productCountByGroup),
      },
    };
  } catch (error) {
    console.error("[loadCreateActOptions] исключение", error);
    return { error: "Не удалось загрузить данные для нового акта. Попробуйте ещё раз." };
  }
}

/**
 * Текст ошибки Quick Resto для пользователя. Клиент QR бросает исключения с
 * английским телом ответа («Quick Resto вернул ошибку 400: {…}») — это только
 * в лог. Пропускаем лишь наши собственные подсказки о настройке доступа.
 */
function quickRestoUserError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (/^(Настройте back-office|Неверный логин или пароль|Не удалось сохранить токен)/.test(message)) {
    return message;
  }
  return fallback;
}

const QR_UNAVAILABLE = "Quick Resto не ответил. Попробуйте ещё раз через минуту.";

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
 * Создать акт инвентаризации в Quick Resto и сразу у нас.
 *
 * Шаги: акт в QR (номер — как в интерфейсе QR, из preinit) → строка у нас →
 * позиции выбранных групп по одной → перечитать акт из QR → журнал и
 * уведомления.
 *
 * Повтор после сбоя (тот же `attemptId` — панель держит его, пока открыта)
 * продолжает тот же акт: дополняет недостающие позиции, второй акт не
 * заводится. Если не удалось добавить ни одной позиции, пустой акт удаляется
 * и в QR, и у нас.
 *
 * Синхронизация дубля не создаст: акт у нас лежит с тем же id Quick Resto
 * (`external_id`), а синк ищет строку именно по нему.
 */
export async function createInventoryAct(
  input: CreateActInput,
): Promise<{ error: string | null; documentId?: string; warning?: string }> {
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

    // ── Акт: продолжить прошлую попытку или завести новый ───────────────────
    const { data: previous } = await admin
      .from<DocumentRow>("documents")
      .select(DOCUMENT_COLUMNS)
      .eq("account_id", accountId)
      .eq("creation_attempt_id", normalized.attemptId)
      .maybeSingle();
    if (previous && (previous.processed || previous.archived_at)) {
      return { error: "Этот акт уже проведён или удалён в Quick Resto. Закройте панель и создайте новый." };
    }
    // Повтор дополняет акт прошлой попытки. Если склад или дату за это время
    // поменяли, дописывать в тот акт нельзя — позиции ушли бы не туда.
    if (
      previous &&
      (previous.store_id !== store.id || (previous.invoice_date ?? "").slice(0, 10) !== normalized.date)
    ) {
      return {
        error: `Акт № ${previous.document_number} уже создан на прежний склад и дату. Закройте панель и откройте её снова, чтобы создать ещё один акт.`,
      };
    }

    let document: DocumentRow;
    let createdNow = false;
    if (previous) {
      document = previous;
    } else {
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
              invoiceDate: actInvoiceDateMs(normalized.date),
              comment: normalized.comment,
            }),
        });
      } catch (error) {
        console.error("[createInventoryAct] Quick Resto не создал акт", error);
        return { error: quickRestoUserError(error, "Quick Resto не создал акт. Попробуйте ещё раз.") };
      }
      if (typeof createdDoc?.id !== "number") {
        log("create вернул акт без id", createdDoc);
        return { error: "Quick Resto не создал акт. Попробуйте ещё раз." };
      }

      const { data: saved, error: saveError } = await admin
        .from<DocumentRow>("documents")
        .upsert(
          {
            account_id: accountId,
            external_id: String(createdDoc.id),
            document_kind: "inventory",
            document_number: inventoryDocumentNumber(createdDoc),
            invoice_date: dateText(createdDoc.invoiceDate) ?? `${normalized.date}T09:00:00.000Z`,
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
      if (saveError || !saved?.id) {
        // Чаще всего — двойное нажатие: эту же попытку уже сохранил другой
        // запрос. Пустой акт, который создали мы, убираем, чтобы не плодить
        // пустышки в Quick Resto.
        console.error("[createInventoryAct] акт не сохранён у нас", saveError);
        await removeEmptyQuickRestoAct({ connection, admin, externalId: createdDoc.id });
        return { error: "Не удалось сохранить акт. Обновите страницу и проверьте список актов." };
      }
      document = saved;
      createdNow = true;
    }
    const externalId = Number(document.external_id);

    // ── Позиции ─────────────────────────────────────────────────────────────
    // Снимок того, что уже лежит в акте: повтор после обрыва не должен класть
    // позицию второй раз.
    const readKeys = async () => {
      const present = await listBackOfficeInventoryItemsWithSession({
        connection,
        admin,
        documentExternalId: externalId,
      });
      return new Set(
        present
          .map((item) => {
            const product = (item as { product?: { className?: string; id?: unknown } }).product;
            return quickRestoProductKey(product?.className, product?.id);
          })
          .filter((key): key is string => Boolean(key)),
      );
    };
    let existingKeys: Set<string>;
    try {
      existingKeys = await readKeys();
    } catch (error) {
      console.error("[createInventoryAct] позиции акта не прочитаны", error);
      if (createdNow) {
        // Новый акт заведомо пуст — читать его было незачем, идём дальше.
        existingKeys = new Set();
      } else {
        return { error: QR_UNAVAILABLE };
      }
    }

    // Темп запросов держит очередь клиента Quick Resto (пауза между
    // созданиями позиций); 429 здесь — запас на чужую нагрузку.
    const { failure, inAct } = await addActItems({
      items: plan.items,
      existingKeys,
      readKeys,
      isRateLimit: (error) => error instanceof QuickRestoRateLimitError,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      add: (item) =>
        withBackOfficeSession({
          connection,
          admin,
          run: (authorization) =>
            createInventoryItemBackOffice({
              ...qrAuth,
              authorization,
              documentId: externalId,
              sample: item.sample as unknown as QuickRestoInventoryItem2,
              actualAmount: 0,
            }),
        }).then(() => undefined),
    });
    if (failure) {
      console.error("[createInventoryAct] позиции добавлены не все", {
        attemptId: input.attemptId,
        inAct,
        total: plan.items.length,
        error: failure,
      });
      if (inAct === 0 && existingKeys.size === 0) {
        // В акте ни одной позиции — пустой акт не оставляем ни в QR, ни у нас.
        await removeEmptyQuickRestoAct({ connection, admin, externalId, localId: document.id, accountId });
        return { error: quickRestoUserError(failure, "Quick Resto не принял позиции, акт не создан. Попробуйте ещё раз.") };
      }
      await refreshFromQuickResto({ connection, admin, accountId, documentId: document.id, externalId });
      revalidatePath("/documents/inventory");
      return {
        error:
          `Акт № ${document.document_number} создан, но в нём ${inAct} из ${countRu(plan.items.length, "позиции", "позиций", "позиций")}: ` +
          "Quick Resto перестал отвечать. Нажмите «Создать акт» ещё раз — оставшиеся позиции добавятся в этот же акт.",
      };
    }

    await refreshFromQuickResto({ connection, admin, accountId, documentId: document.id, externalId });
    const { data: fresh } = await admin
      .from<{ document_number: string; venue_id: string | null }>("documents")
      .select("document_number, venue_id")
      .eq("id", document.id)
      .eq("account_id", accountId)
      .maybeSingle();
    const number = fresh?.document_number ?? document.document_number;
    const venueId = fresh?.venue_id ?? document.venue_id ?? store.local_venue_id;

    // Журнал — одна запись на акт, а не на позицию. При повторе после сбоя
    // пишем её тогда, когда акт наконец собран.
    const groupNames = groups
      .filter((group) => normalized.groupIds.includes(group.id))
      .map((group) => group.name);
    await writeAuditEvent({
      accountId,
      venueId,
      userId: actorId,
      actionCode: "inventory.document.created",
      entityType: "inventory_document",
      entityId: document.id,
      details: {
        number,
        date: normalized.date,
        store_title: store.title,
        item_count: plan.items.length,
        groups: groupNames,
        comment: normalized.comment || null,
        assigned_to: normalized.assignedTo,
        reviewer_id: normalized.reviewerId,
        skipped_items: plan.skipped.slice(0, 20),
      },
    });

    // Уведомляем, когда акт собран: после сбоя на середине — на успешном повторе.
    await notifyInventoryDocumentEvent({
      admin,
      recipientId: normalized.assignedTo,
      actorId,
      venueId,
      documentId: document.id,
      type: "inventory.document.assigned",
      title: `Вам назначен акт инвентаризации № ${number}`,
      body: "Откройте акт, проверьте позиции и заполните фактические остатки.",
    });
    await notifyInventoryDocumentEvent({
      admin,
      recipientId: normalized.reviewerId,
      actorId,
      venueId,
      documentId: document.id,
      type: "inventory.document.review_assigned",
      title: `Вы назначены проверяющим по акту № ${number}`,
      body: "Когда исполнитель завершит акт, проверьте итоги и при необходимости верните на пересчёт.",
    });

    revalidateInventoryResultPages(document.id);
    return {
      error: null,
      documentId: document.id,
      ...(plan.skipped.length > 0
        ? {
            warning: `Не попали в акт ${plan.skipped.length} позиций без данных Quick Resto: ${plan.skipped
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

/** Перечитать акт из Quick Resto — позиции и расчётные остатки берём у источника. */
async function refreshFromQuickResto(input: {
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
    // Акт в QR уже собран; позиции подтянет синхронизация или «Обновить итоги».
    console.error("[createInventoryAct] акт не перечитан из Quick Resto", {
      documentId: input.documentId,
      error,
    });
  }
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
