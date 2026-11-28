"use server";

// Разовая загрузка проведённых актов склада из Quick Resto (акты взвешивания
// табака, которые до Sheerly вёл n8n). Сначала предпросмотр — только чтение,
// затем загрузка: документ, строки из Quick Resto и снимок итогов общей
// функцией фиксации (ветка «уже проведён в Quick Resto» — без повторного
// проведения и без сверки). Повторный запуск ничего не дублирует: известный
// Sheerly акт пропускается, недогруженный — дозагружается.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { finalizeInventoryDocumentCore } from "@/app/(dashboard)/inventory/finalize-core";
import {
  connectionPassword,
  dateMs,
  dateText,
  externalProductId,
  getConnection,
  inventoryDocumentItems,
  inventoryDocumentNumber,
  isDeletedQuickRestoRow,
  listBackOfficeInventoryItemsWithSession,
  quickRestoDocumentSums,
  readActualAmountsByExternalItemId,
  refreshLocalInventoryDocumentFromPayload,
  revalidateInventoryResultPages,
  text,
  upsertExternalLink,
  type QuickRestoConnection,
} from "@/app/(dashboard)/inventory/actions-shared";
import { actionResult, type ActionResult } from "@/lib/actions/result";
import { writeAuditEvent } from "@/lib/audit/write";
import {
  listInventoryDocuments,
  readInventoryDocument,
  type QuickRestoInventoryDocument2,
  type QuickRestoInventoryItem2,
} from "@/lib/integrations/quickresto/client";
import {
  affectedMonths,
  classifyImportCandidate,
  dayInZone,
  isResumableImport,
} from "@/lib/stock-count/import-plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunk } from "@/lib/supabase/fetch-all";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";

import { getStoreActsImportAccess } from "./access";

export type StoreActRow = {
  externalId: number;
  number: string;
  /** День акта `YYYY-MM-DD` в часовом поясе заведения. */
  date: string;
  comment: string | null;
  shortfallSum: number | null;
  surplusSum: number | null;
};

export type StoreActsPreview = {
  toImport: StoreActRow[];
  skipped: Array<StoreActRow & { reason: string }>;
  /** Актов склада раньше начала периода — в списке не показываем. */
  earlierCount: number;
};

export type StoreActsImportResult = {
  imported: number;
  failed: Array<{ externalId: number; number: string | null; error: string }>;
  /** Месяцы `YYYY-MM` загруженных актов — их удержание нужно пересчитать. */
  months: string[];
};

const baseInput = z.object({
  storeId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Выберите склад"),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите дату начала")
    .refine((value) => Number.isFinite(Date.parse(`${value}T00:00:00Z`)), "Укажите дату начала"),
  allowedProductIds: z
    .array(z.number().int().positive())
    .min(1, "Укажите номера позиций Quick Resto")
    .max(50, "Слишком много позиций"),
});

const runInput = baseInput.extend({
  externalIds: z.array(z.number().int().positive()).min(1, "Нет актов для загрузки").max(200, "Слишком много актов за один запуск"),
});

const DEFAULT_TIME_ZONE = "Europe/Moscow";

type StoreRow = {
  id: string;
  title: string | null;
  external_id: string | null;
  local_venue_id: string | null;
  archived_at: string | null;
};

type LocalDocRow = {
  id: string;
  external_id: string;
  status: string;
  results_finalized_at: string | null;
  results_reopened_at: string | null;
  results_snapshot_at: string | null;
  archived_at: string | null;
};

const LOCAL_DOC_COLUMNS =
  "id, external_id, status, results_finalized_at, results_reopened_at, results_snapshot_at, archived_at";

type Ctx = {
  admin: LooseDb;
  accountId: string;
  userId: string;
  connection: QuickRestoConnection;
  apiAuth: { layerName: string; login: string; password: string };
  store: StoreRow & { externalId: number };
  timeZone: string;
};

type Candidate = StoreActRow & { fullDoc: QuickRestoInventoryDocument2 };

async function loadContext(raw: z.infer<typeof baseInput>): Promise<Ctx> {
  const access = await getStoreActsImportAccess();
  if (!access) throw new Error("Недостаточно прав");
  // Без подключения ничего не прочитать — это главная причина, её и называем.
  const connection = await getConnection(access.accountId);
  if (!connection) {
    throw new Error("Quick Resto не подключён — подключите интеграцию в настройках");
  }
  const admin = asLooseDb(createAdminClient());
  const { data: store, error } = await admin
    .from<StoreRow>("stores")
    .select("id, title, external_id, local_venue_id, archived_at")
    .eq("id", raw.storeId)
    .eq("account_id", access.accountId)
    .maybeSingle();
  if (error) throw new Error("Не удалось прочитать склад");
  if (!store) throw new Error("Склад не найден");
  const externalId = Number(store.external_id);
  if (!store.external_id || !Number.isFinite(externalId)) {
    throw new Error("Склад не связан с Quick Resto");
  }
  let timeZone = DEFAULT_TIME_ZONE;
  if (store.local_venue_id) {
    const { data: venue } = await admin
      .from<{ timezone: string | null }>("venues")
      .select("timezone")
      .eq("id", store.local_venue_id)
      .eq("account_id", access.accountId)
      .maybeSingle();
    if (venue?.timezone) timeZone = venue.timezone;
  }
  return {
    admin,
    accountId: access.accountId,
    userId: access.userId,
    connection,
    apiAuth: {
      layerName: connection.login,
      login: connection.login,
      password: connectionPassword(connection),
    },
    store: { ...store, externalId },
    timeZone,
  };
}

function rowOf(doc: QuickRestoInventoryDocument2, date: string): StoreActRow {
  const sums = quickRestoDocumentSums(doc);
  return {
    externalId: doc.id,
    number: inventoryDocumentNumber(doc),
    date,
    comment: text(doc.comment),
    shortfallSum: sums.qr_shortfall_sum,
    surplusSum: sums.qr_surplus_sum,
  };
}

function liveProductIds(items: QuickRestoInventoryItem2[]): number[] {
  return items
    .filter((item) => !isDeletedQuickRestoRow(item))
    .map((item) => Number(externalProductId(item)))
    .filter((id) => Number.isFinite(id));
}

async function readLocalDocs(ctx: Ctx, externalIds: number[]): Promise<Map<number, LocalDocRow>> {
  const out = new Map<number, LocalDocRow>();
  for (const ids of chunk(externalIds.map(String), 200)) {
    const { data, error } = await ctx.admin
      .from<LocalDocRow[]>("documents")
      .select(LOCAL_DOC_COLUMNS)
      .eq("account_id", ctx.accountId)
      .in("external_id", ids);
    if (error) throw new Error("Не удалось прочитать акты Sheerly");
    for (const row of data ?? []) out.set(Number(row.external_id), row);
  }
  return out;
}

/**
 * Акты склада в Quick Resto с решением по каждому. Список актов приходит без
 * позиций, поэтому акт читается целиком, только когда остальные условия
 * выполнены: проведён, жив, в периоде и неизвестен Sheerly.
 */
async function collectCandidates(
  ctx: Ctx,
  input: { from: string; allowedProductIds: number[] },
): Promise<{ toImport: Candidate[]; skipped: StoreActsPreview["skipped"]; earlierCount: number }> {
  let list: QuickRestoInventoryDocument2[];
  try {
    list = await listInventoryDocuments(ctx.apiAuth);
  } catch (error) {
    console.error("[import-store-acts] список актов Quick Resto не получен", error);
    throw new Error("Quick Resto не ответил списком актов. Попробуйте позже");
  }
  // Склад акта есть в списке; акт без склада в списке дочитываем — пропустить
  // свой акт хуже, чем прочитать лишний.
  const storeDocs = list.filter(
    (doc) =>
      typeof doc.id === "number" &&
      (typeof doc.store?.id !== "number" || doc.store.id === ctx.store.externalId),
  );
  const local = await readLocalDocs(
    ctx,
    storeDocs.map((doc) => doc.id),
  );
  const knownExternalIds = new Set(
    [...local.entries()].filter(([, row]) => !isResumableImport(row)).map(([id]) => id),
  );

  const toImport: Candidate[] = [];
  const skipped: StoreActsPreview["skipped"] = [];
  let earlierCount = 0;
  const decide = (doc: QuickRestoInventoryDocument2, date: string, productIds: number[]) =>
    classifyImportCandidate(
      {
        processed: Boolean(doc.processed),
        deleted: isDeletedQuickRestoRow(doc),
        invoiceDate: date,
        productIds,
        storeId: typeof doc.store?.id === "number" ? doc.store.id : null,
      },
      {
        from: input.from,
        allowedProductIds: input.allowedProductIds,
        knownExternalIds,
        externalId: doc.id,
        storeExternalId: ctx.store.externalId,
      },
    );

  for (const listed of storeDocs) {
    const at = dateMs(listed.invoiceDate);
    const listedDate = at === null ? "" : dayInZone(at, ctx.timeZone);
    // Без позиций решение доходит до «другие позиции», только если все
    // остальные условия выполнены: тогда и стоит читать акт целиком.
    const preliminary = decide(listed, listedDate, []);
    if (preliminary.import || preliminary.reason !== "другие позиции") {
      if (typeof listed.store?.id !== "number") continue; // склад неизвестен — не наш акт не показываем
      if (!preliminary.import && preliminary.reason === "раньше даты") earlierCount += 1;
      else if (!preliminary.import) skipped.push({ ...rowOf(listed, listedDate), reason: preliminary.reason });
      continue;
    }
    let fullDoc: QuickRestoInventoryDocument2;
    try {
      fullDoc = await readInventoryDocument({ ...ctx.apiAuth, objectId: listed.id });
    } catch (error) {
      console.error("[import-store-acts] акт не прочитан", { externalId: listed.id, error });
      skipped.push({ ...rowOf(listed, listedDate), reason: "не удалось прочитать в Quick Resto" });
      continue;
    }
    // Акт другого склада — не наш, в списке не показываем. Акт без склада
    // classifyImportCandidate отправит в «Пропущено: склад не указан».
    if (typeof fullDoc.store?.id === "number" && fullDoc.store.id !== ctx.store.externalId) continue;
    const fullAt = dateMs(fullDoc.invoiceDate);
    const date = fullAt === null ? listedDate : dayInZone(fullAt, ctx.timeZone);
    const decision = decide(fullDoc, date, liveProductIds(inventoryDocumentItems(fullDoc).items));
    if (decision.import) toImport.push({ ...rowOf(fullDoc, date), fullDoc });
    else if (decision.reason === "раньше даты") earlierCount += 1;
    else skipped.push({ ...rowOf(fullDoc, date), reason: decision.reason });
  }

  const byDate = (a: StoreActRow, b: StoreActRow) => a.date.localeCompare(b.date) || a.externalId - b.externalId;
  return { toImport: toImport.sort(byDate), skipped: skipped.sort(byDate), earlierCount };
}

/** Предпросмотр: что будет загружено и что пропущено и почему. Только чтение. */
export async function previewStoreActsImport(raw: {
  storeId: string;
  from: string;
  allowedProductIds: number[];
}): Promise<ActionResult<StoreActsPreview>> {
  return actionResult(async () => {
    const input = baseInput.parse(raw);
    const ctx = await loadContext(input);
    const { toImport, skipped, earlierCount } = await collectCandidates(ctx, input);
    return {
      toImport: toImport.map((row) => ({
        externalId: row.externalId,
        number: row.number,
        date: row.date,
        comment: row.comment,
        shortfallSum: row.shortfallSum,
        surplusSum: row.surplusSum,
      })),
      skipped,
      earlierCount,
    };
  }, "Не удалось получить акты из Quick Resto");
}

/** Один акт: документ, строки из Quick Resto и снимок итогов. Бросает русский текст. */
async function importOne(ctx: Ctx, candidate: Candidate, allowed: Set<number>): Promise<string> {
  const { admin, accountId } = ctx;
  const { fullDoc } = candidate;
  const externalId = String(fullDoc.id);

  const existing = (await readLocalDocs(ctx, [fullDoc.id])).get(fullDoc.id);
  if (existing && !isResumableImport(existing)) throw new Error("Акт уже в Sheerly");
  // Склад акта — только склад загрузки: строка документа получит его store_id.
  if (fullDoc.store?.id !== ctx.store.externalId) throw new Error("В акте Quick Resto не указан склад загрузки");

  // Строки — из backoffice (там расчёт и разница), иначе из полного акта.
  let items: QuickRestoInventoryItem2[] = [];
  try {
    items = await listBackOfficeInventoryItemsWithSession({
      connection: ctx.connection,
      admin,
      documentExternalId: fullDoc.id,
    });
  } catch (error) {
    console.error("[import-store-acts] backoffice не вернул позиции", { externalId, error });
  }
  if (items.length === 0) items = inventoryDocumentItems(fullDoc).items;
  items = items.filter((item) => !isDeletedQuickRestoRow(item));
  if (items.length === 0) throw new Error("Quick Resto не вернул позиции акта");
  const productIds = liveProductIds(items);
  // Строка без позиции тоже «другая»: проверить её нечем.
  if (productIds.length !== items.length || productIds.some((id) => !allowed.has(id))) {
    throw new Error("В акте есть другие позиции");
  }

  let documentId = existing?.id ?? null;
  const createdHere = !documentId;
  if (!documentId) {
    const { data: created, error } = await admin
      .from<{ id: string }>("documents")
      .insert({
        account_id: accountId,
        external_id: externalId,
        document_kind: "inventory",
        document_number: inventoryDocumentNumber(fullDoc),
        invoice_date: dateText(fullDoc.invoiceDate),
        store_id: ctx.store.id,
        external_store_id: String(ctx.store.externalId),
        // Акт уже проведён в Quick Resto: сразу «проведён», иначе общая
        // фиксация итогов не примет его (нужен посчитанный статус).
        status: "processed",
        processed: true,
        results_has_line_amounts: false,
        ...quickRestoDocumentSums(fullDoc),
        base_last_update_date: dateText(fullDoc.lastUpdateDate),
        last_qr_update_date: dateText(fullDoc.lastUpdateDate),
        comment: text(fullDoc.comment),
        synced_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !created?.id) {
      if (error?.message.includes("duplicate key")) {
        throw new Error("Этот акт только что загрузили — обновите предпросмотр");
      }
      console.error("[import-store-acts] документ не сохранён", { externalId, error });
      throw new Error("Не удалось сохранить акт в Sheerly");
    }
    documentId = created.id;
  }
  try {
    await upsertExternalLink({
      admin,
      accountId,
      entityType: "inventory_document",
      externalId,
      localTable: "documents",
      localId: documentId,
    });

    // Фиксация без сверки строки не перечитывает — загружаем их здесь. Факт —
    // количество из Quick Resto: подсчёт вели там.
    const refreshed = await refreshLocalInventoryDocumentFromPayload({
      admin,
      accountId,
      documentId,
      document: { ...fullDoc, effectedItems: items },
      keepStatus: true,
      submittedAmounts: readActualAmountsByExternalItemId(items),
    });
    if (refreshed.skippedEmptyPayload || refreshed.count === 0) {
      throw new Error("Quick Resto не вернул позиции акта");
    }
    if (!refreshed.resultsFound) {
      throw new Error("Quick Resto не вернул расчёт по строкам акта — повторите загрузку позже");
    }

    const core = await finalizeInventoryDocumentCore({
      admin,
      accountId,
      documentId,
      actorUserId: ctx.userId,
      source: "import",
    });
    if (core.error) throw new Error(core.error);
    try {
      revalidateInventoryResultPages(documentId);
    } catch {
      // Обновление страниц — не часть загрузки.
    }
  } catch (error) {
    // Строка создана этим запуском и осталась без итогов: «проведённый» акт без строк
    // закрыл бы месяц и не дал бы загрузить его заново. Возобновляемую строку не трогаем.
    if (createdHere) await discardHalfImported(admin, accountId, documentId, externalId);
    throw error;
  }
  return documentId;
}

/** Убирает документ, созданный загрузкой и не доведённый до итогов (только строки и ссылка этого запуска). */
async function discardHalfImported(admin: LooseDb, accountId: string, documentId: string, externalId: string) {
  try {
    const items = await admin.from("document_items").delete().eq("account_id", accountId).eq("document_id", documentId);
    const link = await admin
      .from("external_entity_links")
      .delete()
      .eq("account_id", accountId)
      .eq("provider", "quickresto")
      .eq("entity_type", "inventory_document")
      .eq("external_id", externalId)
      .eq("local_id", documentId);
    const doc = await admin.from("documents").delete().eq("account_id", accountId).eq("id", documentId);
    const failure = items.error ?? link.error ?? doc.error;
    if (failure) throw new Error(failure.message);
  } catch (error) {
    console.error("[import-store-acts] не удалось убрать недогруженный акт", {
      documentId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

/**
 * Загрузка актов из предпросмотра. Список из браузера — только пожелание:
 * каждый акт заново проверяется по Quick Resto и Sheerly, загружаются по
 * одному. Одна запись журнала на запуск.
 */
export async function runStoreActsImport(raw: {
  storeId: string;
  from: string;
  allowedProductIds: number[];
  externalIds: number[];
}): Promise<ActionResult<StoreActsImportResult>> {
  return actionResult(async () => {
    const input = runInput.parse(raw);
    const ctx = await loadContext(input);
    const plan = await collectCandidates(ctx, input);
    const candidates = new Map(plan.toImport.map((row) => [row.externalId, row]));
    const skippedReasons = new Map(plan.skipped.map((row) => [row.externalId, row]));
    const allowed = new Set(input.allowedProductIds);

    const imported: Array<{ externalId: number; number: string; date: string; documentId: string }> = [];
    const failed: StoreActsImportResult["failed"] = [];
    for (const externalId of [...new Set(input.externalIds)]) {
      const candidate = candidates.get(externalId);
      if (!candidate) {
        const skipped = skippedReasons.get(externalId);
        failed.push({
          externalId,
          number: skipped?.number ?? null,
          error: skipped ? `Пропущен: ${skipped.reason}` : "Акт не найден среди проведённых актов склада",
        });
        continue;
      }
      try {
        const documentId = await importOne(ctx, candidate, allowed);
        imported.push({ externalId, number: candidate.number, date: candidate.date, documentId });
      } catch (error) {
        const message = error instanceof Error && /[а-яё]/i.test(error.message) ? error.message : "Не удалось загрузить акт";
        console.error("[import-store-acts] акт не загружен", { externalId, error });
        failed.push({ externalId, number: candidate.number, error: message });
      }
    }

    const months = affectedMonths(imported.map((row) => row.date));
    if (imported.length > 0) {
      await writeAuditEvent({
        accountId: ctx.accountId,
        venueId: ctx.store.local_venue_id,
        userId: ctx.userId,
        actionCode: "inventory.store_acts.imported",
        entityType: "store",
        entityId: ctx.store.id,
        details: {
          store_title: ctx.store.title,
          from: input.from,
          imported: imported.length,
          failed: failed.length,
          months,
          documents: imported.map((row) => ({ number: row.number, external_id: row.externalId, id: row.documentId })),
        },
      });
    }
    revalidatePath("/documents/inventory");
    return { imported: imported.length, failed, months };
  }, "Не удалось загрузить акты");
}
