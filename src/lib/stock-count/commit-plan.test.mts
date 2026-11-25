import test from "node:test";
import assert from "node:assert/strict";

import {
  COMMIT_FALLBACK_ERROR,
  CommitStepError,
  MAX_COMMIT_ATTEMPTS,
  commitErrorText,
  commitMarker,
  findMarkedDocument,
  lineProblems,
  markerSearchCandidates,
  missingLines,
  LEASE_STALE_MS,
  claimKind,
  nextAttemptAt,
  telegramStep,
  validateCommitInput,
} from "./commit-plan.ts";

const OCC = "4b6d2c1e-9f0a-4c3b-8e7d-1a2b3c4d5e6f";
const MARKER = `sheerly:weighing:${OCC}`;

const item = (productId: number, actualAmount: number, extra: Record<string, unknown> = {}) => ({
  id: productId * 10,
  product: { id: productId, name: `Позиция ${productId}` },
  actualAmount,
  ...extra,
});

test("commitMarker: маркер задания в комментарии акта", () => {
  assert.equal(commitMarker(OCC), MARKER);
});

test("findMarkedDocument: находит акт по маркеру в комментарии", () => {
  const docs = [
    { id: 1, comment: "Сергей Попов" },
    { id: 2, comment: `Сергей Попов · ${MARKER}` },
  ];
  assert.equal(findMarkedDocument(docs, MARKER)?.id, 2);
});

test("findMarkedDocument: удалённый акт с маркером не считается", () => {
  const docs = [{ id: 2, comment: `Сергей Попов · ${MARKER}`, deleted: true }];
  assert.equal(findMarkedDocument(docs, MARKER), null);
});

test("findMarkedDocument: маркер другого задания не подходит", () => {
  const docs = [{ id: 3, comment: "Сергей Попов · sheerly:weighing:00000000-0000-4000-8000-000000000000" }];
  assert.equal(findMarkedDocument(docs, MARKER), null);
});

test("findMarkedDocument: акт без комментария пропускается", () => {
  assert.equal(findMarkedDocument([{ id: 4 }], MARKER), null);
});

test("findMarkedDocument: из двух помеченных берётся проведённый, иначе первый созданный", () => {
  const docs = [
    { id: 9, comment: MARKER },
    { id: 7, comment: MARKER },
  ];
  assert.equal(findMarkedDocument(docs, MARKER)?.id, 7);
  assert.equal(findMarkedDocument([...docs, { id: 12, comment: MARKER, processed: true }], MARKER)?.id, 12);
});

test("markerSearchCandidates: только живые акты склада рядом с датой взвешивания", () => {
  const at = Date.parse("2026-11-24T08:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const docs = [
    { id: 1, store: { id: 2 }, invoiceDate: at },
    { id: 2, store: { id: 5 }, invoiceDate: at },
    { id: 3, store: { id: 2 }, invoiceDate: at - 10 * day },
    { id: 4, store: { id: 2 }, invoiceDate: at, deleted: true },
    // Склада или даты в списке нет — проверяем такой акт чтением, а не пропускаем.
    { id: 5, invoiceDate: at + day },
    { id: 6, store: { id: 2 } },
  ];
  assert.deepEqual(
    markerSearchCandidates(docs, { storeExternalId: 2, invoiceDateMs: at }).map((d) => d.id),
    [1, 5, 6],
  );
});

test("missingLines: в пустой акт добавляются все позиции", () => {
  const wanted = [
    { externalProductId: 11, kg: 52.418 },
    { externalProductId: 12, kg: 8.912 },
  ];
  assert.deepEqual(missingLines([], wanted), wanted);
});

test("missingLines: повтор после частичного создания добавляет только недостающую позицию", () => {
  const wanted = [
    { externalProductId: 11, kg: 52.418 },
    { externalProductId: 12, kg: 8.912 },
    { externalProductId: 13, kg: 0 },
  ];
  const existing = [item(11, 52.418), item(12, 8.912)];
  assert.deepEqual(missingLines(existing, wanted), [{ externalProductId: 13, kg: 0 }]);
});

test("missingLines: удалённая строка не считается добавленной", () => {
  const wanted = [{ externalProductId: 11, kg: 1 }];
  assert.deepEqual(missingLines([item(11, 1, { deleted: true })], wanted), wanted);
});

test("missingLines: id позиции строкой тоже узнаётся", () => {
  const existing = [{ id: 1, product: { id: "11" }, actualAmount: 1 }];
  assert.deepEqual(missingLines(existing, [{ externalProductId: 11, kg: 1 }]), []);
});

test("lineProblems: акт совпадает со взвешиванием — проблем нет", () => {
  const wanted = [
    { externalProductId: 11, kg: 52.418 },
    { externalProductId: 13, kg: 0 },
  ];
  assert.deepEqual(lineProblems([item(11, 52.418), item(13, 0)], wanted), []);
});

test("lineProblems: задвоенная, недостающая и чужая по количеству позиция", () => {
  const wanted = [
    { externalProductId: 11, kg: 52.418 },
    { externalProductId: 12, kg: 8.912 },
    { externalProductId: 13, kg: 0.312 },
  ];
  const existing = [item(11, 52.418), { ...item(11, 52.418), id: 999 }, item(13, 0.3)];
  assert.deepEqual(lineProblems(existing, wanted), [
    { kind: "duplicate", externalProductId: 11 },
    { kind: "missing", externalProductId: 12 },
    { kind: "amount", externalProductId: 13 },
  ]);
});

test("lineProblems: дробная погрешность Quick Resto в кг не считается расхождением", () => {
  assert.deepEqual(lineProblems([item(11, 52.41800000001)], [{ externalProductId: 11, kg: 52.418 }]), []);
});

test("nextAttemptAt: паузы 1, 5, 15 и 60 минут, после пятой неудачи — конец", () => {
  const now = new Date("2026-11-25T10:00:00.000Z");
  const minutes = (d: Date | null) => (d ? (d.getTime() - now.getTime()) / 60000 : null);
  assert.equal(minutes(nextAttemptAt(1, now)), 1);
  assert.equal(minutes(nextAttemptAt(2, now)), 5);
  assert.equal(minutes(nextAttemptAt(3, now)), 15);
  assert.equal(minutes(nextAttemptAt(4, now)), 60);
  assert.equal(nextAttemptAt(5, now), null);
  assert.equal(nextAttemptAt(6, now), null);
  assert.equal(MAX_COMMIT_ATTEMPTS, 5);
});

test("commitErrorText: свой текст шага проходит как есть", () => {
  assert.equal(
    commitErrorText(new CommitStepError("Нет образца позиции «Табак / Стандарт»: сначала загрузите прежние акты склада", { terminal: true })),
    "Нет образца позиции «Табак / Стандарт»: сначала загрузите прежние акты склада",
  );
});

test("commitErrorText: русский текст функции проведения проходит", () => {
  assert.equal(
    commitErrorText("Не удалось зафиксировать итоги акта. Попробуйте ещё раз."),
    "Не удалось зафиксировать итоги акта. Попробуйте ещё раз.",
  );
  assert.equal(
    commitErrorText("Quick Resto не отметил акт проведённым. Возможно, акт удалён или изменён — обновите синхронизацию и попробуйте снова."),
    "Quick Resto не отметил акт проведённым. Возможно, акт удалён или изменён — обновите синхронизацию и попробуйте снова.",
  );
});

test("commitErrorText: английский и сырой текст заменяются общей фразой", () => {
  assert.equal(commitErrorText(new Error("fetch failed")), COMMIT_FALLBACK_ERROR);
  assert.equal(commitErrorText(new Error('duplicate key value violates unique constraint "documents_pkey"')), COMMIT_FALLBACK_ERROR);
  assert.equal(commitErrorText(new Error("Quick Resto вернул ошибку 500: Внутренняя ошибка сервера")), COMMIT_FALLBACK_ERROR);
  assert.equal(commitErrorText(new Error("Quick Resto: не удалось соединиться с chilling.quickresto.ru (ECONNRESET): socket hang up")), COMMIT_FALLBACK_ERROR);
  assert.equal(commitErrorText(new Error("Quick Resto (Keycloak): страница входа недоступна (502)")), COMMIT_FALLBACK_ERROR);
  assert.equal(commitErrorText(new Error("Quick Resto back-office access denied (403): проверьте права пользователя Sheerly Bot")), COMMIT_FALLBACK_ERROR);
  assert.equal(commitErrorText(null), COMMIT_FALLBACK_ERROR);
  assert.equal(commitErrorText({ message: "permission denied for table documents" }), COMMIT_FALLBACK_ERROR);
});

test("commitErrorText: сырой хвост после русского начала отрезается", () => {
  assert.equal(
    commitErrorText("Не удалось провести акт в Quick Resto: Quick Resto вернул ошибку 500: <html>"),
    COMMIT_FALLBACK_ERROR,
  );
  assert.equal(
    commitErrorText("Не удалось провести акт в Quick Resto: Request failed with status 502"),
    COMMIT_FALLBACK_ERROR,
  );
});

test("commitErrorText: длинный текст обрезается", () => {
  const text = commitErrorText("Ошибка " + "а".repeat(1000));
  assert.ok(text.length <= 500);
});

const config = {
  mode: "tobacco_weighing",
  storeId: "store-1",
  telegramChatId: null,
  sections: [
    { key: "standard", title: "Стандарт", hint: "", productId: "p1", tares: [{ key: "container", title: "Контейнер", grams: 47 }] },
    { key: "parfum", title: "Парфюм", hint: "", productId: "p3", tares: [{ key: "container", title: "Контейнер", grams: 47 }] },
  ],
};
const batch = (grams: number, count: number, photo: string | null = "occ/weighing/a.jpg") => ({
  id: "00000000-0000-4000-8000-000000000001",
  grams,
  tares: [{ tareKey: "container", count }],
  photo,
});
const occurrence = (weighing: unknown, extra: Record<string, unknown> = {}) => ({
  status: "completed",
  userId: "user-1",
  snapshot: { kind: "stock_count", count_config: config },
  answers: { weighing },
  ...extra,
});
const goodDraft = {
  startedAt: "2026-11-24T08:00:00.000Z",
  sections: { standard: { empty: false, batches: [batch(7458, 30)] }, parfum: { empty: true, batches: [] } },
};

test("validateCommitInput: сданное взвешивание даёт дату акта и нетто по разделам", () => {
  const result = validateCommitInput(occurrence(goodDraft));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.invoiceDateMs, Date.parse("2026-11-24T08:00:00.000Z"));
  assert.deepEqual(result.netKg, { standard: 6.048, parfum: 0 });
});

test("validateCommitInput: взвешивание в обход проверки (0 г, без фото) не проводится", () => {
  const zero = validateCommitInput(
    occurrence({ ...goodDraft, sections: { ...goodDraft.sections, standard: { empty: false, batches: [batch(0, 0)] } } }),
  );
  assert.deepEqual(zero, { ok: false, error: "Взвешивание не прошло проверку: Стандарт, партия 1: введите вес" });
  const noPhoto = validateCommitInput(
    occurrence({ ...goodDraft, sections: { ...goodDraft.sections, standard: { empty: false, batches: [batch(7458, 30, null)] } } }),
  );
  assert.deepEqual(noPhoto, { ok: false, error: "Взвешивание не прошло проверку: Стандарт, партия 1: нет фото" });
});

test("validateCommitInput: без времени начала дату акта взять неоткуда", () => {
  const empty = { startedAt: null, sections: { standard: { empty: true, batches: [] }, parfum: { empty: true, batches: [] } } };
  assert.deepEqual(validateCommitInput(occurrence(empty)), {
    ok: false,
    error: "Взвешивание не прошло проверку: не известно время начала взвешивания",
  });
  assert.equal(validateCommitInput(occurrence({ ...goodDraft, startedAt: "вчера" })).ok, false);
});

test("validateCommitInput: повреждённые данные и несданное задание", () => {
  assert.equal(validateCommitInput(occurrence({ sections: 5 })).ok, false);
  assert.equal(validateCommitInput(occurrence(goodDraft, { snapshot: { kind: "checklist" } })).ok, false);
  assert.equal(
    validateCommitInput(occurrence(goodDraft, { snapshot: { kind: "stock_count", count_config: { mode: "x" } } })).ok,
    false,
  );
  assert.equal(validateCommitInput(occurrence(goodDraft, { status: "in_progress" })).ok, false);
  assert.equal(validateCommitInput(occurrence(goodDraft, { userId: null })).ok, false);
});

const NOW = new Date("2026-11-25T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const later = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

test("claimKind: созревшая pending — в работу, будущая — нет", () => {
  assert.equal(claimKind({ status: "pending", next_attempt_at: ago(1), updated_at: ago(1) }, NOW), "due");
  assert.equal(claimKind({ status: "pending", next_attempt_at: later(60_000), updated_at: ago(1) }, NOW), null);
});

test("claimKind: processing забираем, только когда воркер молчит дольше аренды", () => {
  assert.equal(claimKind({ status: "processing", next_attempt_at: ago(1), updated_at: ago(LEASE_STALE_MS - 1000) }, NOW), null);
  assert.equal(claimKind({ status: "processing", next_attempt_at: ago(1), updated_at: ago(LEASE_STALE_MS + 1000) }, NOW), "stale");
});

test("claimKind: done и failed не захватываются", () => {
  assert.equal(claimKind({ status: "done", next_attempt_at: ago(1), updated_at: ago(LEASE_STALE_MS * 2) }, NOW), null);
  assert.equal(claimKind({ status: "failed", next_attempt_at: ago(1), updated_at: ago(LEASE_STALE_MS * 2) }, NOW), null);
});

const tg = (extra: Record<string, unknown>) => ({
  status: "done",
  telegram_status: "pending",
  telegram_attempts: 0,
  telegram_next_attempt_at: ago(1),
  updated_at: ago(1),
  ...extra,
});

test("telegramStep: отчёт проведённого акта отправляется, пока не кончились попытки", () => {
  assert.equal(telegramStep(tg({}), NOW), "send");
  assert.equal(telegramStep(tg({ telegram_status: "failed", telegram_attempts: 3 }), NOW), "send");
  assert.equal(telegramStep(tg({ telegram_status: "failed", telegram_attempts: 5 }), NOW), null);
});

test("telegramStep: не время, нет повтора, не проведено, уже отправлено или без чата — ничего", () => {
  assert.equal(telegramStep(tg({ telegram_next_attempt_at: later(60_000) }), NOW), null);
  assert.equal(telegramStep(tg({ telegram_status: "failed", telegram_next_attempt_at: null }), NOW), null);
  assert.equal(telegramStep(tg({ status: "processing" }), NOW), null);
  assert.equal(telegramStep(tg({ telegram_status: "sent" }), NOW), null);
  assert.equal(telegramStep(tg({ telegram_status: "skipped" }), NOW), null);
});

test("telegramStep: зависшая отправка не повторяется, а закрывается", () => {
  assert.equal(telegramStep(tg({ telegram_status: "sending", updated_at: ago(LEASE_STALE_MS - 1000) }), NOW), null);
  assert.equal(telegramStep(tg({ telegram_status: "sending", updated_at: ago(LEASE_STALE_MS + 1000) }), NOW), "abandon");
});
