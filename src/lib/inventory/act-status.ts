/**
 * Pure helpers, описывающие статусную машину акта инвентаризации: какая
 * поверхность (форма заполнения / итоги ревьюера) залочена в каком статусе.
 * Единый источник правды, который переиспользуют:
 *   - server actions (`src/app/(dashboard)/inventory/actions.ts`),
 *   - форма заполнения (`document-editor.tsx`),
 *   - таблица итогов (`results-table.tsx`).
 *
 * Без импортов из `@/...`, чтобы node:test мог импортировать напрямую
 * (тест-раннер не резолвит alias из tsconfig — см. list-documents-shared.ts).
 *
 * Жизненный цикл (см. docs/handbook/inventory/statuses.md):
 *   synced → assigned → in_progress → ready_for_review | results_blocked
 *     → recount_pending → ready_for_review (петля пересчёта)
 *   Боковое: sync_error. Накладки-замки: results_finalized_at (финализация),
 *   processed + results_reopened_at (проведён в QR / разблокирован).
 */

export type InventoryActStatus =
  | "synced"
  | "assigned"
  | "in_progress"
  | "ready_for_review"
  | "recount_pending"
  | "processed"
  | "results_blocked"
  | "sync_error";

/** Минимум полей акта, достаточный для вычисления замков итогов. */
export type InventoryActLockInput = {
  status: string;
  results_finalized_at: string | null;
  results_reopened_at: string | null;
};

/**
 * Итоги залочены (read-only): финализированы (results_finalized_at) ИЛИ акт
 * проведён в QR (status='processed') и не был явно разблокирован
 * (results_reopened_at == null). Разблокировка — reopenInventoryResults.
 */
export function isInventoryResultLocked(doc: InventoryActLockInput): boolean {
  if (doc.results_finalized_at) return true;
  return doc.status === "processed" && doc.results_reopened_at == null;
}

/**
 * Инструменты ревьюера (пересорт, исключение из итогов, автоисключения,
 * комментарии, финализация) недоступны, когда итоги залочены ИЛИ акт
 * отправлен на пересчёт (status='recount_pending'): ревьюер ждёт, пока
 * исполнитель реально пересчитает, и не может «подогнать» итог. Это и есть
 * анти-подгонка из recount-механики.
 */
export function isInventoryResultAdjustLocked(doc: InventoryActLockInput): boolean {
  return isInventoryResultLocked(doc) || doc.status === "recount_pending";
}

/**
 * Причина, по которой инструменты ревьюера закрыты (для сообщения экшена),
 * либо null если итоги можно менять. Возвращает non-null ровно тогда, когда
 * isInventoryResultAdjustLocked === true — единый источник и предиката, и
 * текста (раньше дублировалось инлайном в getResultDocumentForAction).
 * Порядок проверок: пересчёт → финализация → проведение.
 */
export function getInventoryResultAdjustLockReason(doc: InventoryActLockInput): string | null {
  if (doc.status === "recount_pending") {
    return "Акт отправлен исполнителю на пересчёт. Дождитесь завершения пересчёта, прежде чем менять итоги.";
  }
  if (doc.results_finalized_at) {
    return "Итоги акта уже финализированы. Переоткройте итоги перед изменениями.";
  }
  if (doc.status === "processed" && doc.results_reopened_at == null) {
    return "Акт проведён в Quick Resto и заблокирован. Разблокируйте его перед изменениями.";
  }
  return null;
}

/**
 * Есть ли у акта итоги подсчёта.
 *
 * Quick Resto считает разницу как «факт − расчётный остаток» и отдаёт её ВСЕГДА,
 * даже когда акт ещё не считали: у незаполненного акта факт равен нулю, и
 * разница получается равной минус всему складскому остатку. На проде это
 * выглядело как недостача 478 193,6 ₽ по акту, к которому никто не притрагивался.
 *
 * Итоги существуют только после того, как исполнитель сдал акт: ready_for_review
 * (в т.ч. вернувшись с пересчёта), results_blocked, recount_pending и processed.
 * До сдачи (synced / assigned / in_progress) и при sync_error никаких итогов нет —
 * ни на странице, ни в суммах списка.
 */
export function hasCountedResults(status: string): boolean {
  return (
    status === "ready_for_review" ||
    status === "results_blocked" ||
    status === "recount_pending" ||
    status === "processed"
  );
}

/**
 * Статус акта после импорта строк из Quick Resto.
 *
 * Импорт — это обновление ДАННЫХ, а не событие процесса, поэтому он не должен
 * двигать акт по статусной машине. Раньше статус пересчитывался безусловно
 * (`processed` → иначе `resultsFound ? ready_for_review : results_blocked`), и
 * один клик «Обновить итоги» переводил акт с пересчёта или из работы
 * исполнителя в «Готов к проверке»: исполнителю закрывалась форма посреди
 * пересчёта, а с проверяющего снималась анти-подгонка.
 *
 * Правила:
 *  - QR says processed → `processed` (это факт на стороне источника правды);
 *  - акт ещё у исполнителя (synced / assigned / in_progress / recount_pending)
 *    → статус не трогаем;
 *  - акт уже на проверке (ready_for_review / results_blocked) → уточняем по
 *    тому, вернул ли QR построчные расчёты.
 */
export function resolveStatusAfterImport(input: {
  current: string;
  processed: boolean;
  resultsFound: boolean;
}): string {
  if (input.processed) return "processed";
  if (
    input.current === "synced" ||
    input.current === "assigned" ||
    input.current === "in_progress" ||
    input.current === "recount_pending"
  ) {
    return input.current;
  }
  return input.resultsFound ? "ready_for_review" : "results_blocked";
}

/**
 * Статус акта после ПОЛНОЙ синхронизации с Quick Resto.
 *
 * Отличие от resolveStatusAfterImport: там мы обновляем строки уже известного
 * акта, здесь — принимаем выгрузку QR, в которой акта может ещё не быть.
 *
 * Правило одно: синхронизация двигает акт по жизненному циклу только ВПЕРЁД.
 * `processed` — факт на стороне источника правды, его принимаем. Всё остальное
 * (назначен, в работе, готов к проверке, на пересчёте) — наш собственный
 * процесс, и данные QR не повод его отматывать.
 *
 * Прецедент: признак «акт проведён у нас» был завязан на results_finalized_at,
 * а reopenInventoryResults его обнуляет, оставляя акт проведённым. Поэтому
 * акт, который распровели в QR и переоткрыли у нас, откатывался в 'synced':
 * страница итогов показывала «подсчёт не завершён», в списке вместо суммы
 * стоял ноль, а форма снова открывалась исполнителю.
 */
export function resolveStatusAfterSync(input: {
  processedInQr: boolean;
  existingStatus: string | null | undefined;
}): string {
  if (input.processedInQr) return "processed";
  return input.existingStatus ?? "synced";
}

/**
 * Значение documents.qr_unprocessed_at (миграция 224) после синхронизации.
 *
 * Метка означает «акт проведён у нас, но в Quick Resto его распровели».
 * Ставится один раз — на переходе, чтобы плашка и запись в журнале не
 * дублировались на каждом проходе; снимается ТОЛЬКО когда QR снова отдал акт
 * проведённым. Безусловное обнуление стирало метку на первом же проходе по
 * любому непроведённому акту.
 */
export function resolveQrUnprocessedAt(input: {
  processedInQr: boolean;
  processedLocally: boolean;
  existingValue: string | null | undefined;
  now: string;
}): string | null {
  if (input.processedInQr) return null;
  if (input.processedLocally) return input.existingValue ?? input.now;
  return input.existingValue ?? null;
}

/**
 * Причина, по которой повторный импорт итогов из Quick Resto («Обновить итоги»)
 * закрыт, либо null если импорт разрешён.
 *
 * Импорт перезаписывает построчные итоги значениями, которые QR отдаёт ПРЯМО
 * СЕЙЧАС. «Расчётный остаток» в QR — не константа акта, а производная от
 * движений товара: то же поле, прочитанное позже, даёт другое число (прод,
 * акт СВ340: 0,2 кг в снимке от 24.08 против −0,4 кг сутки спустя). Поэтому на
 * залоченных итогах импорт запрещён — иначе он молча заменяет то, что утвердил
 * проверяющий. Легальный путь — сначала переоткрыть итоги
 * (reopenInventoryResults), тогда правка видна в журнале и в метке
 * «итоги правились после проведения».
 */
export function getInventoryResultRefreshLockReason(doc: InventoryActLockInput): string | null {
  if (doc.status === "recount_pending") {
    return "Акт отправлен исполнителю на пересчёт. Импорт из Quick Resto сейчас перезапишет строки и закроет исполнителю форму — дождитесь завершения пересчёта.";
  }
  if (doc.results_finalized_at) {
    return "Итоги акта зафиксированы. Quick Resto пересчитывает расчётные остатки по движениям товара, поэтому повторный импорт заменит утверждённые числа. Переоткройте итоги, если импорт действительно нужен.";
  }
  if (doc.status === "processed" && doc.results_reopened_at == null) {
    return "Акт проведён в Quick Resto. После проведения QR отдаёт уже пересчитанные остатки, и импорт заменит итоги акта. Разблокируйте акт, если импорт действительно нужен.";
  }
  return null;
}

/**
 * Статусы, в которых форма заполнения только для чтения: акт уже ушёл на
 * проверку / проведён / не синкнулся. В этих статусах исполнитель не должен
 * «дозаполнять» факт.
 */
export const FORM_LOCKED_STATUSES: readonly string[] = [
  "ready_for_review",
  "results_blocked",
  "processed",
  "sync_error",
];

/**
 * Форма заполнения только для чтения, если итоги финализированы ИЛИ статус
 * входит в FORM_LOCKED_STATUSES. Редактируема при synced / assigned /
 * in_progress / recount_pending (последний — легитимный перерасчёт).
 */
export function isInventoryFormLocked(status: string, finalized: boolean): boolean {
  return finalized || FORM_LOCKED_STATUSES.includes(status);
}

/**
 * Можно ли менять ИСПОЛНИТЕЛЯ акта. Зеркалит фазу заполнения: исполнитель —
 * тот, кто заполняет/пересчитывает, поэтому менять его можно ровно тогда,
 * когда форма редактируема (synced / assigned / in_progress / recount_pending).
 * Как только акт ушёл на проверку (ready_for_review / results_blocked) или
 * проведён / sync_error — менять нельзя: счёт уже сделан конкретным человеком,
 * подмена ломает атрибуцию. Чтобы передать другому — «Отправить на пересчёт»
 * (акт → recount_pending, исполнитель снова доступен).
 * Возвращает причину блокировки (для tooltip) или null, если менять можно.
 */
export function getAssigneeLockReason(status: string): string | null {
  if (status === "processed") return "Акт проведён — исполнителя менять нельзя";
  if (status === "sync_error")
    return "Ошибка синхронизации — сначала восстановите акт из Quick Resto";
  if (status === "ready_for_review" || status === "results_blocked")
    return "Акт на проверке — исполнителя менять нельзя. Чтобы передать другому, отправьте акт на пересчёт";
  return null;
}

/**
 * Какой статус выставить акту при (пере)назначении исполнителя.
 * - Снятие исполнителя (assignedTo == null) → "synced" (акт без ответственного).
 * - Назначение на акте «На пересчёте» → СОХРАНЯЕМ "recount_pending": смена
 *   исполнителя во время пересчёта не должна сбрасывать рамку пересчёта
 *   (баннер, подсветка строк, кнопка «Завершить пересчёт»). Новый исполнитель
 *   продолжает именно пересчёт.
 * - Любое другое назначение → "assigned" (обычный старт заполнения).
 *
 * Вызывать только когда менять исполнителя разрешено (getAssigneeLockReason
 * вернул null) — статусы вроде ready_for_review сюда не доходят.
 */
export function nextStatusAfterAssign(currentStatus: string, assignedTo: string | null): string {
  if (!assignedTo) return "synced";
  return currentStatus === "recount_pending" ? "recount_pending" : "assigned";
}

/**
 * Можно ли менять ПРОВЕРЯЮЩЕГО акта. Проверяющего назначают/меняют вплоть до
 * проведения акта: его можно задать заранее и переназначить во время проверки
 * итогов. Заблокировано только когда акт проведён / sync_error.
 * Возвращает причину блокировки (для tooltip) или null.
 */
export function getReviewerLockReason(status: string): string | null {
  if (status === "processed") return "Акт проведён — проверяющего менять нельзя";
  if (status === "sync_error")
    return "Ошибка синхронизации — сначала восстановите акт из Quick Resto";
  return null;
}
