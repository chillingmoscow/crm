// Фиксация итогов акта инвентаризации: проведение в Quick Resto и снимок
// построчных итогов. Общая часть для ручного «Подвести итоги»
// (finalizeInventoryResults), воркера взвешивания и импорта уже проведённых
// актов.
//
// Функция не знает о сессии пользователя: не проверяет права и видимость акта,
// не шлёт уведомлений, не пересчитывает удержание и не обновляет страницы —
// всё это делает вызывающий. Экшен, вызванный из браузера, обязан проверить
// права и видимость акта ДО вызова. Документ читается admin-клиентом строго в
// пределах accountId.

import "server-only";

import { readInventoryDocument, type QuickRestoInventoryDocument2 } from "@/lib/integrations/quickresto/client";
import { hasCountedResults } from "@/lib/inventory/act-status";
import { resolveReviewerFallback } from "@/lib/inventory/act-assignment";
import {
  compareResultLines,
  describeResultDrift,
  hasResultDrift,
  type InventoryRecheckLine,
} from "@/lib/inventory/results-recheck";
import type { LooseDb } from "@/lib/supabase/loose";
import {
  DOCUMENT_CHANGED_ERROR,
  actionErrorMessage,
  connectionPassword,
  getConnection,
  isDeletedQuickRestoRow,
  isDocumentStatusStill,
  listBackOfficeInventoryItemsWithSession,
  loadResultDocumentForAction,
  num,
  processBackOfficeInventoryDocumentWithSession,
  refreshLocalInventoryDocumentFromPayload,
  transitionDocumentStatus,
  writeInventoryResultEvent,
  type InventoryResultDocumentRow,
} from "./actions-shared";

/** Кто запустил фиксацию — пишется в журнал (`details.source`). */
export type FinalizeInventorySource = "manual" | "weighing" | "import";

export type FinalizeInventoryDocumentCoreResult = {
  error: string | null;
  /** Итоги уже были финализированы (в том числе параллельным запросом) — no-op. */
  alreadyFinalized?: boolean;
  /**
   * Локальные данные акта изменились, страницы итогов нужно обновить
   * (revalidatePath — на вызывающем).
   */
  revalidate?: boolean;
  /** Итоги зафиксированы этим вызовом: данные для уведомления и подсказки. */
  finalized?: {
    document: InventoryResultDocumentRow;
    alreadyProcessedInQr: boolean;
  };
};

export async function finalizeInventoryDocumentCore(input: {
  admin: LooseDb;
  accountId: string;
  documentId: string;
  /** Автор фиксации: results_finalized_by, журнал, фоллбэк проверяющего. */
  actorUserId: string;
  source: FinalizeInventorySource;
  /** Не сверять строки с Quick Resto перед проведением. */
  skipDriftCheck?: boolean;
}): Promise<FinalizeInventoryDocumentCoreResult> {
  const { admin, accountId, actorUserId, source } = input;
  const skipDriftCheck = input.skipDriftCheck === true;
  try {
    const document = await loadResultDocumentForAction({
      admin,
      accountId,
      documentId: input.documentId,
    });
    // Уже финализирован — no-op. NB: ТОЛЬКО results_finalized_at, не status.
    // reopenInventoryResults очищает results_finalized_at, но НЕ меняет status
    // (остаётся 'processed'); UI после reopen снова показывает «Подвести
    // итоги». Если гейтить и по status='processed', повторная финализация
    // тихо проглатывалась бы как успех — акт оставался в editable-режиме
    // навсегда (Codex P2).
    if (document.results_finalized_at) return { error: null, alreadyFinalized: true };
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
    // Без построчного расчёта Quick Resto (results_blocked) проверяющему не на
    // что опереться: кнопка в UI неактивна, закрываем и прямой вызов.
    if (document.status === "results_blocked") {
      return {
        error:
          "Quick Resto ещё не вернул расчёт по строкам. Нажмите «Обновить итоги» — подвести итоги можно после того, как расчёт придёт.",
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
    const connection = await getConnection(accountId);
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
    // Загрузка берёт только уже проведённые акты и сама ничего не проводит.
    // Акт распровели в Quick Resto, пока до него дошла очередь, — выходим до
    // сверки, снимка и проведения, ничего не меняя.
    if (source === "import" && !alreadyProcessedInQr) {
      return { error: "Акт больше не проведён в Quick Resto — загрузка пропущена" };
    }

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
        .eq("account_id", accountId)
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
    // Проведённый акт не сверяем (см. alreadyProcessedInQr выше). Вызывающий
    // может отключить сверку явно (skipDriftCheck): акт взвешивания создан
    // только что, «утверждённых раньше» чисел у него нет.
    if (!alreadyProcessedInQr && !skipDriftCheck) {
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
            accountId,
            documentId: document.id,
            document: { ...qrDocBefore, effectedItems: freshItems },
            // Статус не двигаем и не пишем вовсе: сверка — это обновление
            // данных, а не переход. Раньше сюда передавался прочитанный в
            // начале статус, и «Вернуть на пересчёт», случившийся за время
            // сверки, молча откатывался обратно.
            keepStatus: true,
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
              admin,
              accountId,
              userId: actorUserId,
              documentId: document.id,
              eventType: "results_recheck_drift",
              message: "Данные Quick Resto изменились перед проведением",
              payload: {
                changedLines: diff.changedLines,
                addedLines: diff.addedLines,
                removedLines: diff.removedLines,
                beforeTotal: diff.beforeTotal,
                afterTotal: diff.afterTotal,
                source,
              },
            });
            return { error: describeResultDrift(diff), revalidate: true };
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

    // Свежая проверка перед необратимыми шагами (снимок итогов и проведение в
    // Quick Resto): пока шла сверка, акт могли вернуть на пересчёт или
    // финализировать параллельно. Проведение в QR не откатить, поэтому гард —
    // ДО него; финальная запись ниже ещё и условная (transitionDocumentStatus).
    const stillFinalizable = await isDocumentStatusStill({
      admin,
      accountId,
      documentId: document.id,
      from: [document.status],
      finalized: "open",
    });
    if (!stillFinalizable) {
      return { error: DOCUMENT_CHANGED_ERROR, revalidate: true };
    }

    // Снимок построчных итогов — ДО обращения к QR. «Расчёт» и «Разница» в
    // строках приходят из QR и пересчитываются им по движениям товара, поэтому
    // фиксируем ровно то, что утвердил проверяющий (миграция 221). Если снимок
    // не снялся — выходим, не проведя акт: лучше ничего не делать, чем провести
    // и остаться без зафиксированных итогов.
    const { error: snapshotError } = await admin.rpc("freeze_inventory_result_snapshot", {
      p_account_id: accountId,
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
    const reviewerFallback = resolveReviewerFallback({
      reviewerId: document.reviewer_id,
      assignedTo: document.assigned_to,
      actorId: actorUserId,
    });
    const finalizePatch = {
      status: "processed",
      processed: true,
      ...(qrShortfallSum !== null ? { qr_shortfall_sum: qrShortfallSum } : {}),
      ...(qrSurplusSum !== null ? { qr_surplus_sum: qrSurplusSum } : {}),
      results_finalized_at: finalizedAt,
      results_finalized_by: actorUserId,
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
      // Авто-фоллбэк: финализирующий становится проверяющим, если поле пусто
      // и он не исполнитель акта (исполнитель и проверяющий — разные люди).
      ...(reviewerFallback ? { reviewer_id: reviewerFallback } : {}),
    };
    // Запись условная: только если статус тот же, что в начале, и итоги ещё
    // не финализированы. Иначе параллельное действие (второй клик «Подвести
    // итоги», «Вернуть на пересчёт» в окне проведения) перетиралось бы.
    let overriddenStatus: string | null = null;
    const applied = await transitionDocumentStatus({
      admin,
      accountId,
      documentId: document.id,
      from: [document.status],
      finalized: "open",
      patch: finalizePatch,
    });
    if (!applied) {
      // Мы проиграли гонку, но Quick Resto УЖЕ провёл акт (постусловие выше) —
      // это необратимо, и источник правды там. Варианты:
      //  - итоги уже финализировал параллельный запрос → ничего не делаем,
      //    это успех (двойной клик);
      //  - акт за эти секунды вернули на пересчёт / изменили иначе → всё равно
      //    фиксируем проведение: оставить «На пересчёте» поверх проведённого в
      //    QR акта — рассинхрон, который синхронизация потом «починит» уже без
      //    снимка итогов. Перекрытый статус пишем в журнал.
      const { data: current } = await admin
        .from<{ status: string; results_finalized_at: string | null }>("documents")
        .select("status, results_finalized_at")
        .eq("id", document.id)
        .eq("account_id", accountId)
        .maybeSingle();
      if (current?.results_finalized_at) {
        return { error: null, alreadyFinalized: true, revalidate: true };
      }
      const forced = current
        ? await transitionDocumentStatus({
            admin,
            accountId,
            documentId: document.id,
            from: [current.status],
            finalized: "open",
            patch: finalizePatch,
          })
        : false;
      if (!forced) {
        console.error("[finalize] акт проведён в QR, но локальная фиксация не применилась", {
          documentId: document.id,
        });
        logOrphanSnapshot("акт изменили параллельно во время проведения");
        return {
          error:
            "Акт проведён в Quick Resto, но его только что изменили здесь. Обновите страницу и повторите «Подвести итоги» — повторного проведения не будет.",
        };
      }
      overriddenStatus = current?.status ?? null;
      console.warn("[finalize] проведение перекрыло параллельную смену статуса", {
        documentId: document.id,
        overriddenStatus,
      });
    }

    // Автоматическая фиксация (взвешивание, загрузка актов) в журнале от имени системы:
    // мастер/загрузивший назван в подписи, а не выдаётся за того, кто «подвёл итоги».
    let automaticActor: string | null = null;
    if (source !== "manual") {
      const { data: profile } = await admin
        .from<{ first_name: string | null; last_name: string | null }>("profiles")
        .select("first_name, last_name")
        .eq("id", actorUserId)
        .maybeSingle();
      automaticActor = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || null;
    }
    await writeInventoryResultEvent({
      admin,
      accountId,
      userId: actorUserId,
      ...(source !== "manual" ? { auditUserId: null } : {}),
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
        ...(overriddenStatus ? { overriddenStatus } : {}),
        ...(skipDriftCheck ? { driftCheckSkipped: true } : {}),
        source,
        ...(automaticActor ? { actorName: automaticActor } : {}),
      },
    });

    return {
      error: null,
      revalidate: true,
      finalized: { document, alreadyProcessedInQr },
    };
  } catch (error) {
    return { error: actionErrorMessage(error, "Не удалось финализировать итоги") };
  }
}
