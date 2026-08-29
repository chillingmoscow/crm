"use server";

// Итоги акта: пересчёт, комментарий, фиксация и распроведение.

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { getInventoryResultRefreshLockReason, hasCountedResults } from "@/lib/inventory/act-status";
import {
  compareResultLines,
  describeResultDrift,
  hasResultDrift,
  type InventoryRecheckLine
} from "@/lib/inventory/results-recheck";
import {
  readInventoryDocument,
  type QuickRestoInventoryDocument2
} from "@/lib/integrations/quickresto/client";
import {
  actionErrorMessage,
  assertDocumentVisible,
  connectionPassword,
  getActiveContext,
  getConnection,
  getResultDocumentForAction,
  isDeletedQuickRestoRow,
  listBackOfficeInventoryItemsWithSession,
  normalizeReason,
  notifyInventoryDocumentEvent,
  num,
  processBackOfficeInventoryDocumentWithSession,
  refreshLocalInventoryDocumentFromPayload,
  revalidateInventoryResultPages,
  text,
  writeInventoryResultEvent
} from "../actions-shared";

export async function refreshInventoryDocumentResults(input: {
  documentId: string;
}): Promise<{
  processed: boolean;
  resultsHasLineAmounts: boolean;
  error: string | null;
}> {
  // «Обновить итоги» — управленческая операция (перечитывает итоги из QR,
  // меняет статус/позиции). Требует именно право на итоги: назначенный
  // исполнитель, который просто смотрит проведённый акт, её не запускает.
  const ctx = await getActiveContext("inventory.view_results");
  if (ctx.error || !ctx.user || !ctx.accountId) {
    return { processed: false, resultsHasLineAmounts: false, error: ctx.error };
  }

  const [{ data: canViewResults }, { data: canViewDocuments }, { data: canFill }] = await Promise.all([
    ctx.supabase.rpc("has_permission", { permission_code: "inventory.view_results" }),
    ctx.supabase.rpc("has_permission", { permission_code: "inventory.view_documents" }),
    ctx.supabase.rpc("has_permission", { permission_code: "inventory.fill_assigned_documents" }),
  ]);
  if (!canViewResults) {
    return { processed: false, resultsHasLineAmounts: false, error: "Недостаточно прав" };
  }

  const admin = asLooseDb(createAdminClient());
  try {
    await assertDocumentVisible({ supabase: ctx.supabase, documentId: input.documentId });
  } catch (visibilityError) {
    return {
      processed: false,
      resultsHasLineAmounts: false,
      error: actionErrorMessage(visibilityError, "Акт не найден"),
    };
  }
  const { data: document } = await admin
    .from<{
      id: string;
      account_id: string;
      external_id: string;
      assigned_to: string | null;
      status: string;
      results_finalized_at: string | null;
      results_reopened_at: string | null;
    }>("documents")
    .select("id, account_id, external_id, assigned_to, status, results_finalized_at, results_reopened_at")
    .eq("id", input.documentId)
    .eq("account_id", ctx.accountId)
    .maybeSingle();

  if (!document?.id) {
    return { processed: false, resultsHasLineAmounts: false, error: "Акт не найден" };
  }
  const allowed = Boolean(canViewDocuments) || (Boolean(canFill) && document.assigned_to === ctx.user.id);
  if (!allowed) {
    return { processed: false, resultsHasLineAmounts: false, error: "Недостаточно прав" };
  }

  // Импорт заменяет построчные итоги тем, что QR отдаёт СЕЙЧАС. На залоченных
  // итогах это молча перезаписывает утверждённые числа — так и потерялись итоги
  // акта СВ340. Легальный путь — сначала переоткрыть итоги.
  const refreshLockReason = getInventoryResultRefreshLockReason(document);
  if (refreshLockReason) {
    return { processed: false, resultsHasLineAmounts: false, error: refreshLockReason };
  }

  const connection = await getConnection(ctx.accountId);
  if (!connection) {
    return { processed: false, resultsHasLineAmounts: false, error: "Активное подключение Quick Resto не найдено" };
  }

  try {
    const password = connectionPassword(connection);
    const qrDocument = await readInventoryDocument({
      layerName: connection.login,
      login: connection.login,
      password,
      objectId: Number(document.external_id),
    });
    const documentExternalId = Number(document.external_id);
    if (!Number.isFinite(documentExternalId)) {
      return { processed: false, resultsHasLineAmounts: false, error: "У акта некорректный ID Quick Resto" };
    }
    const backOfficeItems = await listBackOfficeInventoryItemsWithSession({
      connection,
      admin,
      documentExternalId,
    });
    const documentWithRows: QuickRestoInventoryDocument2 = {
      ...qrDocument,
      effectedItems: backOfficeItems.length > 0 ? backOfficeItems : qrDocument.effectedItems,
    };
    const syncResult = await refreshLocalInventoryDocumentFromPayload({
      admin,
      accountId: ctx.accountId,
      documentId: document.id,
      document: documentWithRows,
      status: qrDocument.processed ? "processed" : undefined,
    });

    // Quick Resto ответил без позиций — данные акта мы намеренно не тронули.
    // Раньше это молча удаляло все строки; теперь говорим об этом вслух, иначе
    // пользователь решит, что «обновилось» и цифры актуальны.
    if (syncResult.skippedEmptyPayload) {
      return {
        processed: Boolean(qrDocument.processed),
        resultsHasLineAmounts: false,
        error:
          "Quick Resto не вернул позиции акта — данные оставлены без изменений. Попробуйте ещё раз через минуту.",
      };
    }

    revalidatePath("/documents/inventory");
    revalidatePath(`/documents/inventory/${document.id}`);
    revalidatePath(`/documents/inventory/${document.id}/results`);

    // Ответ выглядел обрезанным: строки, которых в нём не было, мы НЕ удалили
    // (иначе снесли бы снимок итогов и половины пересортов). Молчать нельзя —
    // остальные строки обновились, и пользователь решит, что акт актуален.
    if (syncResult.skippedStaleDeletion > 0) {
      return {
        processed: Boolean(qrDocument.processed),
        resultsHasLineAmounts: syncResult.resultsFound,
        error: `Quick Resto вернул неполный список позиций — не хватает ${syncResult.skippedStaleDeletion}. Строки акта сохранены, но данные могут быть неактуальны: повторите обновление через минуту.`,
      };
    }

    return {
      processed: Boolean(qrDocument.processed),
      resultsHasLineAmounts: syncResult.resultsFound,
      error: null,
    };
  } catch (error) {
    return {
      processed: false,
      resultsHasLineAmounts: false,
      error: actionErrorMessage(error, "Не удалось обновить итоги из Quick Resto"),
    };
  }
}

export async function updateInventoryResultComment(input: {
  documentId: string;
  itemId: string;
  comment: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.comment_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
      requireOpen: true,
    });

    const comment = text(input.comment);
    const { data: item } = await admin
      .from<{ id: string; product_name: string }>("document_items")
      .select("id, product_name")
      .eq("id", input.itemId)
      .eq("document_id", input.documentId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (!item?.id) throw new Error("Строка акта не найдена");

    const { error } = await admin
      .from("document_items")
      .update({
        result_comment: comment,
        result_comment_updated_by: comment ? ctx.user.id : null,
        result_comment_updated_at: comment ? new Date().toISOString() : null,
      })
      .eq("id", item.id)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: input.documentId,
      documentItemId: item.id,
      eventType: "comment_updated",
      message: comment
        ? `Комментарий к позиции «${item.product_name}» обновлен`
        : `Комментарий к позиции «${item.product_name}» очищен`,
      payload: { itemId: item.id, productName: item.product_name, comment },
    });

    revalidateInventoryResultPages(input.documentId);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось обновить комментарий") };
  }
}

export async function finalizeInventoryResults(input: {
  documentId: string;
}): Promise<{ error: string | null; notice?: string }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.finalize_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    const document = await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
    });
    // Уже финализирован — no-op. NB: ТОЛЬКО results_finalized_at, не status.
    // reopenInventoryResults очищает results_finalized_at, но НЕ меняет status
    // (остаётся 'processed'); UI после reopen снова показывает «Подвести
    // итоги». Если гейтить и по status='processed', повторная финализация
    // тихо проглатывалась бы как успех — акт оставался в editable-режиме
    // навсегда (Codex P2).
    if (document.results_finalized_at) return { error: null };
    // Финализировать можно только сданный акт. До сдачи итогов не существует:
    // факт нулевой, и разница из Quick Resto равна минус всему складскому
    // остатку — проведение списало бы его целиком (прод-кейс на 478 193,6 ₽).
    // Кнопки в UI нет (страница итогов гейтится тем же предикатом), но экшен
    // вызываем напрямую, а это самое разрушительное действие модуля.
    if (!hasCountedResults(document.status)) {
      return {
        error:
          "Подсчёт ещё не завершён — подвести итоги можно после того, как исполнитель сдаст акт.",
      };
    }
    // Акт на пересчёте закрыть нельзя — сначала исполнитель должен завершить
    // пересчёт (статус вернётся в ready_for_review).
    if (document.status === "recount_pending") {
      return {
        error:
          "Акт отправлен на пересчёт. Дождитесь, пока исполнитель завершит пересчёт, прежде чем финализировать итоги.",
      };
    }

    // QR — источник правды для проведения акта. Сначала push в QR
    // (backoffice action /warehouse.inventory.document.v2/action,
    // actionName=process), и только при успехе обновляем локально:
    // status=processed + processed=true + results_finalized_at. На фейле QR
    // (нет коннекта / 5xx / отказ) локально НИЧЕГО не меняем — юзер видит
    // ошибку, может починить и попробовать заново. Следующий pull-sync
    // в любом случае подтянет реальное состояние из QR.
    const connection = await getConnection(ctx.accountId);
    if (!connection) {
      return {
        error:
          "Quick Resto не подключён — нельзя провести акт. Подключите интеграцию в настройках.",
      };
    }
    const externalIdNum = Number(document.external_id);
    if (!Number.isFinite(externalIdNum)) {
      return { error: "Не удалось определить ID акта в Quick Resto." };
    }
    const apiAuth = {
      layerName: connection.login,
      login: connection.login,
      password: connectionPassword(connection),
    };

    // Guard от «тихого успеха»: акт мог быть удалён в QR (или его там нет).
    // На удалённом акте /action отвечает 200 и НИЧЕГО не делает — без этой
    // проверки мы бы впустую пометили акт проведённым локально. Читаем акт
    // из QR перед проведением: если удалён / не найден — явная ошибка, локально
    // ничего не трогаем. (См. инцидент: финализация СВ-акта, удалённого в QR.)
    let qrDocBefore: QuickRestoInventoryDocument2;
    try {
      qrDocBefore = await readInventoryDocument({ ...apiAuth, objectId: externalIdNum });
    } catch (readError) {
      console.error("[finalize] QR read failed (акт удалён в QR?)", {
        documentId: document.id,
        externalId: externalIdNum,
        error: readError,
      });
      return {
        error:
          "Не удалось прочитать акт в Quick Resto — возможно, он удалён. Обновите синхронизацию и проверьте акт.",
      };
    }
    if (isDeletedQuickRestoRow(qrDocBefore)) {
      return {
        error:
          "Этот акт удалён в Quick Resto — провести его нельзя. Обновите синхронизацию.",
      };
    }

    // Полусбойное состояние: в Quick Resto акт уже проведён, а локально
    // финализация не доехала. Так бывает, когда /action отработал, а
    // постусловное чтение упало по таймауту: экшен вернул ошибку и НЕ тронул
    // documents. Повторное нажатие «Подвести итоги» не должно проводить
    // проведённый акт — вместо этого дописываем локальное состояние.
    //
    // Сверку перед проведением в этом случае пропускаем сознательно: у
    // проведённого акта Quick Resto отдаёт уже ПОСЛЕ-проведенческие расчётные
    // остатки, сверка нашла бы «расхождение» с утверждёнными числами и
    // заблокировала бы финализацию навсегда. Утверждённое — то, что лежит в
    // строках сейчас; его и фиксируем.
    const alreadyProcessedInQr = Boolean(qrDocBefore.processed);

    // Сверка перед проведением. Между тем моментом, когда проверяющий смотрел
    // «Итоги», и нажатием «Подвести итоги» Quick Resto мог пересчитать
    // расчётные остатки (правки в учёте за период до даты акта). Тогда
    // утверждают одни числа, а проводятся другие — так и вышло с СВ340:
    // на экране был итог +89,25 ₽, провелось +16 301,75 ₽.
    // Поэтому: перечитываем строки, и если они разъехались — НЕ проводим,
    // а показываем разницу и просим подтвердить ещё раз.
    const readResultLines = async (): Promise<InventoryRecheckLine[]> => {
      const { data } = await admin
        .from<Array<{ external_item_id: string; difference_amount: number | null; difference_sum: number | null }>>(
          "document_items",
        )
        .select("external_item_id, difference_amount, difference_sum")
        .eq("account_id", ctx.accountId)
        .eq("document_id", document.id);
      return (data ?? []).map((row) => ({
        externalItemId: row.external_item_id,
        differenceAmount: row.difference_amount,
        differenceSum: row.difference_sum,
      }));
    };

    let recheckSkippedReason: string | null = alreadyProcessedInQr
      ? "акт уже проведён в Quick Resto"
      : null;
    // Проведённый акт не сверяем (см. alreadyProcessedInQr выше).
    if (!alreadyProcessedInQr) {
      try {
        const linesBefore = await readResultLines();
        const freshItems = await listBackOfficeInventoryItemsWithSession({
          connection,
          admin,
          documentExternalId: externalIdNum,
        });
        if (freshItems.length === 0) {
          recheckSkippedReason = "Quick Resto не вернул позиции для сверки";
        } else {
          await refreshLocalInventoryDocumentFromPayload({
            admin,
            accountId: ctx.accountId,
            documentId: document.id,
            document: { ...qrDocBefore, effectedItems: freshItems },
            // Статус не двигаем: сверка — это обновление данных, а не переход
            // по статусной машине.
            status: document.status,
          });
          const diff = compareResultLines(linesBefore, await readResultLines());
          if (hasResultDrift(diff)) {
            console.info("[finalize] данные QR разъехались, проведение отменено", {
              documentId: document.id,
              changed: diff.changedLines,
              beforeTotal: diff.beforeTotal,
              afterTotal: diff.afterTotal,
            });
            await writeInventoryResultEvent({
              supabase: ctx.supabase,
              admin,
              accountId: ctx.accountId,
              userId: ctx.user.id,
              documentId: document.id,
              eventType: "results_recheck_drift",
              message: "Данные Quick Resto изменились перед проведением",
              payload: {
                changedLines: diff.changedLines,
                addedLines: diff.addedLines,
                removedLines: diff.removedLines,
                beforeTotal: diff.beforeTotal,
                afterTotal: diff.afterTotal,
              },
            });
            revalidateInventoryResultPages(document.id);
            return { error: describeResultDrift(diff) };
          }
        }
      } catch (recheckError) {
        // Сверка — защита, а не предусловие: если backoffice недоступен, не
        // блокируем проведение, но оставляем след в журнале.
        console.error("[finalize] сверка перед проведением не выполнена", {
          documentId: document.id,
          error: recheckError,
        });
        recheckSkippedReason = "Quick Resto недоступен для сверки";
      }
    }

    // Снимок построчных итогов — ДО обращения к QR. «Расчёт» и «Разница» в
    // строках приходят из QR и пересчитываются им по движениям товара, поэтому
    // фиксируем ровно то, что утвердил проверяющий (миграция 221). Если снимок
    // не снялся — выходим, не проведя акт: лучше ничего не делать, чем провести
    // и остаться без зафиксированных итогов.
    const { error: snapshotError } = await admin.rpc("freeze_inventory_result_snapshot", {
      p_account_id: ctx.accountId,
      p_document_id: document.id,
    });
    if (snapshotError) {
      console.error("[finalize] snapshot failed", {
        documentId: document.id,
        error: snapshotError,
      });
      return { error: "Не удалось зафиксировать итоги акта. Попробуйте ещё раз." };
    }

    // Снимок снят, а documents.results_snapshot_at выставится только в самом
    // конце. Если дальше что-то упадёт, строки останутся помечены finalized_*,
    // но страница продолжит показывать живые значения (акт не залочен) —
    // состояние корректное, но должно быть видно в логах.
    const logOrphanSnapshot = (reason: string) => {
      console.warn("[finalize] снимок строк снят, но акт не зафиксирован", {
        documentId: document.id,
        externalId: externalIdNum,
        reason,
      });
    };

    if (!alreadyProcessedInQr) {
      try {
        await processBackOfficeInventoryDocumentWithSession({
          connection,
          admin,
          documentExternalId: externalIdNum,
        });
        console.info("[finalize] QR processed", {
          documentId: document.id,
          externalId: externalIdNum,
        });
      } catch (qrError) {
        const message =
          qrError instanceof Error ? qrError.message : "Quick Resto не ответил";
        console.error("[finalize] QR process failed", {
          documentId: document.id,
          externalId: externalIdNum,
          error: qrError,
        });
        logOrphanSnapshot("проведение в Quick Resto не удалось");
        return { error: `Не удалось провести акт в Quick Resto: ${message}` };
      }
    }

    // Постусловие: убеждаемся, что QR реально провёл акт. /action на удалённом /
    // изменённом акте может тихо вернуть 200 ничего не сделав — тогда локально
    // НЕ помечаем проведённым, иначе разъедемся с QR (источник правды).
    let qrDocAfter: QuickRestoInventoryDocument2 | null = alreadyProcessedInQr
      ? qrDocBefore
      : null;
    if (!alreadyProcessedInQr) {
      try {
        qrDocAfter = await readInventoryDocument({ ...apiAuth, objectId: externalIdNum });
        if (!qrDocAfter.processed) {
          console.error("[finalize] QR не отметил акт проведённым после process", {
            documentId: document.id,
            externalId: externalIdNum,
          });
          logOrphanSnapshot("Quick Resto не отметил акт проведённым");
          return {
            error:
              "Quick Resto не отметил акт проведённым. Возможно, акт удалён или изменён — обновите синхронизацию и попробуйте снова.",
          };
        }
      } catch (verifyError) {
        console.error("[finalize] QR re-read after process failed", {
          documentId: document.id,
          externalId: externalIdNum,
          error: verifyError,
        });
        logOrphanSnapshot("не удалось подтвердить проведение");
        return {
          error:
            "Не удалось подтвердить проведение акта в Quick Resto. Обновите синхронизацию и проверьте статус акта.",
        };
      }
    }

    const finalizedAt = new Date().toISOString();
    // Суммы акта (колонка «Сумма итогов» в списке) Quick Resto заполняет
    // ТОЛЬКО у проведённого акта: до проведения public-payload отдаёт нули,
    // а мы читали акт именно до. Поэтому по всем актам в списке стояло 0
    // (прод: СВ340 — 0 против 16 301,75 ₽ в QR). Берём их из ответа, которым
    // только что подтвердили проведение; если QR не прислал числа, оставляем
    // прежние значения, а не затираем нулями.
    const qrShortfallSum = num(qrDocAfter?.shortfallSum);
    const qrSurplusSum = num(qrDocAfter?.surplusSum);
    const { error } = await admin
      .from("documents")
      .update({
        status: "processed",
        processed: true,
        ...(qrShortfallSum !== null ? { qr_shortfall_sum: qrShortfallSum } : {}),
        ...(qrSurplusSum !== null ? { qr_surplus_sum: qrSurplusSum } : {}),
        results_finalized_at: finalizedAt,
        results_finalized_by: ctx.user.id,
        // Акт снова проведён — метка «распровели в Quick Resto» (миграция 224)
        // больше не актуальна. Синхронизация её не снимет: она ходит только по
        // НЕпроведённым актам.
        qr_unprocessed_at: null,
        // Включает снимок строк (finalized_* выше) — с этого момента страница
        // итогов показывает зафиксированные числа, а не живые из Quick Resto.
        results_snapshot_at: finalizedAt,
        // Сбрасываем reopened-метки: если это была повторная финализация после
        // reopen, акт должен снова залочиться (isLocked на странице итогов
        // считает реопен-флаг → editable). Без сброса UI остался бы editable.
        results_reopened_at: null,
        results_reopened_by: null,
        // Авто-фоллбэк: финализирующий становится проверяющим, если поле пусто.
        ...(document.reviewer_id ? {} : { reviewer_id: ctx.user.id }),
      })
      .eq("id", document.id)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: "results_finalized",
      message: alreadyProcessedInQr
        ? "Зафиксировал итоги акта, уже проведённого в Quick Resto"
        : recheckSkippedReason
          ? `Подвел итоги акта (без сверки с Quick Resto: ${recheckSkippedReason})`
          : "Подвел итоги акта",
      payload: {
        documentId: document.id,
        recheckSkipped: recheckSkippedReason,
        alreadyProcessedInQr,
      },
    });

    // Уведомляем исполнителя, что его акт принят.
    await notifyInventoryDocumentEvent({
      admin,
      recipientId: document.assigned_to,
      actorId: ctx.user.id,
      venueId: document.venue_id,
      documentId: document.id,
      type: "inventory.document.finalized",
      title: `Итоги акта № ${document.document_number} приняты`,
      body: "Проверяющий финализировал итоги инвентаризации.",
    });

    revalidateInventoryResultPages(document.id);
    return {
      error: null,
      ...(alreadyProcessedInQr
        ? {
            notice:
              "Акт уже был проведён в Quick Resto — итоги зафиксированы локально, повторное проведение не потребовалось.",
          }
        : {}),
    };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось финализировать итоги") };
  }
}

export async function reopenInventoryResults(input: {
  documentId: string;
  reason: string;
}): Promise<{ error: string | null }> {
  const ctx = await getActiveContext(["inventory.view_results", "inventory.finalize_results"]);
  if (ctx.error || !ctx.user || !ctx.accountId) return { error: ctx.error };

  const admin = asLooseDb(createAdminClient());
  try {
    const reason = normalizeReason(input.reason, "Укажите причину переоткрытия итогов");
    const document = await getResultDocumentForAction({
      admin,
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      documentId: input.documentId,
    });
    // Разблокировать можно: финализированные итоги (results_finalized_at)
    // ИЛИ проведённый акт (status='processed' — он залочен по умолчанию,
    // см. результат-страницу isLocked). Если ни то, ни другое — no-op.
    const isProcessed = document.status === "processed";
    if (!document.results_finalized_at && !isProcessed) return { error: null };

    const { error } = await admin
      .from("documents")
      .update({
        results_finalized_at: null,
        results_finalized_by: null,
        results_reopened_at: new Date().toISOString(),
        results_reopened_by: ctx.user.id,
        // Устойчивый сигнал «итоги правились после проведения» — только когда
        // разблокируем УЖЕ проведённый акт (F6). Для обычного reopen на этапе
        // проверки (не processed) не ставим.
        ...(isProcessed ? { results_reopened_after_processed: true } : {}),
      })
      .eq("id", document.id)
      .eq("account_id", ctx.accountId);
    if (error) throw new Error(error.message);

    await writeInventoryResultEvent({
      supabase: ctx.supabase,
      admin,
      accountId: ctx.accountId,
      userId: ctx.user.id,
      documentId: document.id,
      eventType: "results_reopened",
      message: isProcessed
        ? "Разблокировал проведённый акт для редактирования"
        : "Открыл итоги для редактирования",
      payload: { documentId: document.id, reason, processed: isProcessed },
    });

    revalidateInventoryResultPages(document.id);
    return { error: null };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось переоткрыть итоги") };
  }
}
