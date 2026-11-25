import "server-only";

import { randomUUID } from "node:crypto";

// Проведение сданного взвешивания: акт в Quick Resto → локальный документ →
// фиксация итогов → отчёт в Telegram. Очередь — public.stock_count_commits,
// одна строка на задание. Каждый шаг идемпотентен: повтор после падения в любом
// месте доводит то же проведение, а не создаёт второй акт.
//
// Защита от второго акта в Quick Resto:
//  - id акта пишется в очередь сразу после создания (qr_document_id);
//  - если запись не дошла, акт находится по маркеру задания в комментарии;
//  - пока Quick Resto не ответил списком актов, акт не создаём.
// Защита от неверного удержания: перед проведением акт сверяется со
// взвешиванием (каждая позиция ровно одной строкой и с тем же фактом).

import {
  finalizeInventoryDocumentCore,
} from "@/app/(dashboard)/inventory/finalize-core";
import {
  connectionPassword,
  dateText,
  extractLineResult,
  externalItemId,
  externalProductId,
  getConnection,
  inventoryDocumentItems,
  inventoryDocumentNumber,
  isDeletedQuickRestoRow,
  listBackOfficeInventoryItemsWithSession,
  nomenclatureKind,
  notifyInventoryDocumentEvent,
  refreshLocalInventoryDocumentFromPayload,
  revalidateInventoryResultPages,
  transitionDocumentStatus,
  withBackOfficeSession,
  type QuickRestoConnection,
} from "@/app/(dashboard)/inventory/actions-shared";
import {
  createInventoryDocumentBackOffice,
  createInventoryItemBackOffice,
  downloadInventoryResultsPdfBackOffice,
  listInventoryDocuments,
  readInventoryDocument,
  removeInventoryDocumentBackOffice,
  type QuickRestoInventoryDocument2,
  type QuickRestoInventoryItem2,
} from "@/lib/integrations/quickresto/client";
import { loadTelegramBot } from "@/lib/integrations/telegram-bot";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb, type LooseDb } from "@/lib/supabase/loose";
import {
  CommitStepError,
  LEASE_STALE_MS,
  MAX_COMMIT_ATTEMPTS,
  claimKind,
  commitErrorText,
  commitMarker,
  findMarkedDocument,
  lineProblems,
  markerSearchCandidates,
  missingLines,
  nextAttemptAt,
  telegramStep,
  validateCommitInput,
  type WantedLine,
} from "./commit-plan";
import { buildWeighingCaption, sendWeighingReport } from "./report";
import { chunk, fetchAllRows } from "@/lib/supabase/fetch-all";
import type { CountConfig, CountSection } from "./tobacco-weighing";

/** Сколько актов без комментария в списке дочитываем по одному при поиске маркера. */
const MAX_MARKER_READS = 30;
/** Не начинать следующее проведение в тике, если прошло больше. */
const TICK_BUDGET_MS = 25_000;

const COMMIT_COLUMNS =
  "id, account_id, venue_id, occurrence_id, status, attempts, qr_document_id, document_id, telegram_status, telegram_attempts, telegram_next_attempt_at, next_attempt_at, updated_at, lease_token";

type CommitRow = {
  id: string;
  account_id: string;
  venue_id: string;
  occurrence_id: string;
  status: "pending" | "processing" | "done" | "failed";
  attempts: number;
  qr_document_id: number | string | null;
  document_id: string | null;
  telegram_status: "pending" | "sending" | "sent" | "failed" | "skipped";
  telegram_attempts: number;
  telegram_next_attempt_at: string | null;
  next_attempt_at: string;
  updated_at: string;
  lease_token: string | null;
};

type OccurrenceRow = {
  id: string;
  account_id: string;
  venue_id: string;
  user_id: string | null;
  employee_name: string | null;
  business_date: string;
  status: string;
  snapshot: unknown;
  answers: unknown;
  submitted_at: string | null;
};

const OCCURRENCE_COLUMNS =
  "id, account_id, venue_id, user_id, employee_name, business_date, status, snapshot, answers, submitted_at";

type SectionLine = {
  section: CountSection;
  ingredient: { id: string; name: string; kind: string };
  externalProductId: number;
  kg: number;
};

type Outcome = "done" | "retry" | "failed" | "skipped";

/** Строку очереди перехватил другой воркер — дальше не пишем ничего. */
class LeaseLostError extends Error {}

/**
 * Аренда строки: свой токен на каждый захват. Пишем только с ним и только в
 * своей фазе — `processing` (проведение) или `done` (отчёт в Telegram). Токен
 * закрывает и ABA: после «Повторить» (stock_count_retry обнуляет попытки)
 * старый воркер с прежним номером попытки строку уже не тронет.
 */
type Lease = { id: string; token: string; phase: "processing" | "done" };

async function writeLeased(db: LooseDb, lease: Lease, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await db
    .from<Array<{ id: string }>>("stock_count_commits")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", lease.id)
    .eq("status", lease.phase)
    .eq("lease_token", lease.token)
    .select("id");
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 0) throw new LeaseLostError("stock_count_commits: аренда потеряна");
}

/** Признак жизни перед долгими шагами: иначе строку сочтут брошенной и заберут. */
function heartbeat(db: LooseDb, lease: Lease) {
  return writeLeased(db, lease, {});
}

async function readCommit(db: LooseDb, occurrenceId: string): Promise<CommitRow | null> {
  const { data, error } = await db
    .from<CommitRow>("stock_count_commits")
    .select(COMMIT_COLUMNS)
    .eq("occurrence_id", occurrenceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Compare-and-swap по всему, что видел читающий: статус, номер попытки,
 * updated_at и токен. Живой воркер обновляет updated_at (heartbeat), поэтому
 * захват «брошенной» строки, которую на самом деле ещё ведут, не пройдёт.
 */
async function casUpdate(
  db: LooseDb,
  row: CommitRow,
  patch: Record<string, unknown>,
): Promise<CommitRow | null> {
  let query = db
    .from<CommitRow[]>("stock_count_commits")
    .update(patch)
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("attempts", row.attempts)
    .eq("telegram_status", row.telegram_status)
    .eq("telegram_attempts", row.telegram_attempts)
    .eq("updated_at", row.updated_at);
  query = row.lease_token ? query.eq("lease_token", row.lease_token) : query.is("lease_token", null);
  const { data, error } = await query.select(COMMIT_COLUMNS);
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

/**
 * Захват строки проведения. Номер попытки растёт при захвате: упавший посреди
 * шага воркер тоже тратит попытку, вечного цикла падений не будет.
 */
async function claim(db: LooseDb, occurrenceId: string): Promise<{ commit: CommitRow; lease: Lease } | null> {
  const row = await readCommit(db, occurrenceId);
  if (!row || !claimKind(row, new Date())) return null;
  const token = randomUUID();
  const commit = await casUpdate(db, row, {
    status: "processing",
    attempts: row.attempts + 1,
    lease_token: token,
    updated_at: new Date().toISOString(),
  });
  return commit ? { commit, lease: { id: commit.id, token, phase: "processing" } } : null;
}

function qrDocumentIdOf(commit: CommitRow): number | null {
  const id = Number(commit.qr_document_id);
  return commit.qr_document_id !== null && Number.isFinite(id) ? id : null;
}

type Ctx = {
  db: LooseDb;
  lease: Lease;
  commit: CommitRow;
  occurrence: OccurrenceRow;
};

/** Проведение одного задания. Ошибки не бросает: результат пишется в очередь. */
export async function processStockCountCommit(occurrenceId: string): Promise<void> {
  await runCommit(occurrenceId);
}

async function runCommit(occurrenceId: string): Promise<Outcome> {
  const db = asLooseDb(createAdminClient());
  let claimed: Awaited<ReturnType<typeof claim>>;
  try {
    claimed = await claim(db, occurrenceId);
  } catch (error) {
    console.error("[stock-count commit] захват не удался", { occurrenceId, error: rawMessage(error) });
    return "retry";
  }
  if (!claimed) return "skipped";
  const { commit, lease } = claimed;

  let occurrence: OccurrenceRow | null = null;
  try {
    const { data, error } = await db
      .from<OccurrenceRow>("schedule_task_occurrences")
      .select(OCCURRENCE_COLUMNS)
      .eq("id", commit.occurrence_id)
      .eq("account_id", commit.account_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new CommitStepError("Задание взвешивания не найдено", { terminal: true });
    occurrence = data;
    // Захват упавшей строки, у которой попытки уже кончились: воркер падал
    // посреди шага раз за разом — дальше без человека не идём.
    if (commit.attempts > MAX_COMMIT_ATTEMPTS) {
      throw new CommitStepError(
        "Проведение несколько раз прервалось на середине — проверьте акт в Quick Resto и повторите",
        { terminal: true },
      );
    }
    await commitSteps({ db, lease, commit, occurrence });
  } catch (error) {
    if (error instanceof LeaseLostError) {
      console.warn("[stock-count commit] строку перехватил другой воркер", { occurrenceId });
      return "skipped";
    }
    return failCommit({ db, lease, commit, occurrence, error });
  }
  // Отчёт — отдельной фазой со своими повторами: сбой Telegram проведение не трогает.
  await runTelegram(occurrenceId).catch((error) => {
    console.error("[stock-count telegram] отчёт не отправлен", { occurrenceId, error: rawMessage(error) });
  });
  return "done";
}

async function commitSteps(ctx: Ctx): Promise<void> {
  const { db, lease, commit, occurrence } = ctx;
  const accountId = commit.account_id;

  // 0. Проверка взвешивания — до любого обращения к Quick Resto.
  const input = validateCommitInput({
    status: occurrence.status,
    userId: occurrence.user_id,
    snapshot: occurrence.snapshot,
    answers: occurrence.answers,
    submittedAt: occurrence.submitted_at,
  });
  if (!input.ok) throw new CommitStepError(input.error, { terminal: true });
  const { config, invoiceDateMs, netKg } = input;
  const masterId = occurrence.user_id as string;
  const employeeName = occurrence.employee_name?.trim() || "Сотрудник";

  // Итоги уже зафиксированы (упали после фиксации, до записи «готово») —
  // остаётся только отчёт.
  if (commit.document_id) {
    const { data: doc } = await db
      .from<{ id: string; results_finalized_at: string | null }>("documents")
      .select("id, results_finalized_at")
      .eq("id", commit.document_id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (doc?.results_finalized_at) {
      await finishDone(ctx, config);
      return;
    }
  }

  const storeExternalId = await loadStoreExternalId(db, accountId, config.storeId);
  const lines = await loadSectionLines(db, accountId, config, netKg);
  const wanted: WantedLine[] = lines.map((line) => ({ externalProductId: line.externalProductId, kg: line.kg }));
  const nameOf = (productId: number) =>
    lines.find((line) => line.externalProductId === productId)?.ingredient.name ?? `#${productId}`;

  const samples = new Map<number, QuickRestoInventoryItem2>();
  const sampleFor = async (line: SectionLine) => {
    const cached = samples.get(line.externalProductId);
    if (cached) return cached;
    const sample = await loadSample(db, accountId, line);
    samples.set(line.externalProductId, sample);
    return sample;
  };

  const connection = await connectionOrFail(accountId);
  const apiAuth = { layerName: connection.login, login: connection.login, password: connectionPassword(connection) };
  const qrAuth = { layerName: connection.login, baseUrl: connection.backoffice_base_url };
  const marker = commitMarker(occurrence.id);

  // 1. Акт в Quick Resto: сохранённый id → маркер → создание.
  let qrId = qrDocumentIdOf(commit);
  let createdNow = false;
  let qrDoc: QuickRestoInventoryDocument2 | null = null;
  if (qrId !== null) {
    const known = await readInventoryDocument({ ...apiAuth, objectId: qrId });
    if (isDeletedQuickRestoRow(known)) {
      if (commit.document_id) {
        throw new CommitStepError(
          "Акт взвешивания удалён в Quick Resto — проведите взвешивание вручную",
          { terminal: true },
        );
      }
      // Акт без документа Sheerly удалён (наш откат или человек) — ищем заново.
      await writeLeased(db, lease, { qr_document_id: null });
      commit.qr_document_id = null;
      qrId = null;
    } else {
      assertOwnDocument(known, marker, storeExternalId);
      qrDoc = known;
    }
  }
  if (qrId === null) {
    await heartbeat(db, lease);
    const found = await findDocumentByMarker({
      apiAuth,
      marker,
      storeExternalId,
      invoiceDateMs,
      heartbeat: () => heartbeat(db, lease),
    });
    if (found) {
      qrId = found.id;
      qrDoc = found;
      await writeLeased(db, lease, { qr_document_id: qrId });
      commit.qr_document_id = qrId;
    } else {
      // Образцы — до создания: без них акт остался бы пустым.
      for (const line of lines) await sampleFor(line);
      // Последняя проверка аренды перед необратимым шагом: строку не забрали.
      await heartbeat(db, lease);
      const created = await withBackOfficeSession({
        connection,
        admin: db,
        run: (authorization) =>
          createInventoryDocumentBackOffice({
            ...qrAuth,
            authorization,
            storeId: storeExternalId,
            invoiceDate: invoiceDateMs,
            comment: `${employeeName} · ${marker}`,
          }),
      });
      if (typeof created?.id !== "number") {
        throw new CommitStepError("Quick Resto не создал акт взвешивания");
      }
      qrId = created.id;
      createdNow = true;
      // Сразу: если дальше упадём, повтор продолжит этот же акт. Не дошла
      // запись — акт найдётся по маркеру.
      await writeLeased(db, lease, { qr_document_id: qrId });
      commit.qr_document_id = qrId;
    }
  }
  const documentExternalId = qrId as number;

  // 2. Недостающие позиции.
  if (!createdNow && !qrDoc) qrDoc = await readInventoryDocument({ ...apiAuth, objectId: documentExternalId });
  if (!qrDoc?.processed) {
    let existing: QuickRestoInventoryItem2[] = [];
    if (!createdNow) {
      // Два источника: backoffice иногда отдаёт по живому акту пустой список,
      // а пропущенная строка добавилась бы второй раз.
      const backOffice = await listBackOfficeInventoryItemsWithSession({ connection, admin: db, documentExternalId });
      existing = [...backOffice, ...inventoryDocumentItems(qrDoc as QuickRestoInventoryDocument2).items];
    }
    const toAdd = missingLines(existing, wanted);
    let added = 0;
    try {
      for (const line of toAdd) {
        const sectionLine = lines.find((l) => l.externalProductId === line.externalProductId) as SectionLine;
        const sample = await sampleFor(sectionLine);
        await heartbeat(db, lease);
        await withBackOfficeSession({
          connection,
          admin: db,
          run: (authorization) =>
            createInventoryItemBackOffice({
              ...qrAuth,
              authorization,
              documentId: documentExternalId,
              sample,
              actualAmount: line.kg,
            }),
        });
        added += 1;
      }
    } catch (error) {
      if (createdNow && added === 0) {
        if (await removeEmptyDocument({ db, lease, connection, apiAuth, qrAuth, documentExternalId })) {
          commit.qr_document_id = null;
        }
      }
      throw error;
    }
  }

  // 3. Сверка акта со взвешиванием — до проведения.
  const boItems = await listBackOfficeInventoryItemsWithSession({ connection, admin: db, documentExternalId });
  if (boItems.length === 0) {
    throw new CommitStepError("Quick Resto не вернул позиции акта взвешивания — повторим позже");
  }
  const problem = lineProblems(boItems, wanted)[0];
  if (problem?.kind === "duplicate") {
    throw new CommitStepError(
      `В акте Quick Resto позиция «${nameOf(problem.externalProductId)}» встречается дважды — удалите лишнюю строку в Quick Resto и повторите`,
      { terminal: true },
    );
  }
  if (problem?.kind === "amount") {
    throw new CommitStepError(
      `Количество позиции «${nameOf(problem.externalProductId)}» в акте Quick Resto не совпадает со взвешиванием — проверьте акт`,
      { terminal: true },
    );
  }
  if (problem?.kind === "missing") {
    throw new CommitStepError(
      `Quick Resto не показал позицию «${nameOf(problem.externalProductId)}» в акте — повторим позже`,
    );
  }
  const wantedIds = new Set(wanted.map((line) => String(line.externalProductId)));
  const ownItems = boItems.filter((item) => wantedIds.has(externalProductId(item) ?? ""));
  if (!qrDoc?.processed && ownItems.some((item) => !extractLineResult(item).hasResult)) {
    throw new CommitStepError("Quick Resto ещё не посчитал расчётный остаток по акту — повторим позже");
  }

  // 4. Документ Sheerly и строки из Quick Resto.
  const fullDoc = await readInventoryDocument({ ...apiAuth, objectId: documentExternalId });
  const documentId = await upsertLocalDocument({
    db,
    accountId,
    fullDoc,
    documentExternalId,
    config,
    storeExternalId,
    masterId,
    invoiceDateMs,
  });
  if (commit.document_id !== documentId) {
    await writeLeased(db, lease, { document_id: documentId });
    commit.document_id = documentId;
  }
  const kgByProduct = new Map(wanted.map((line) => [String(line.externalProductId), line.kg]));
  const submittedAmounts = new Map<string, number | null>();
  boItems.forEach((item, index) => {
    const kg = kgByProduct.get(externalProductId(item) ?? "");
    if (kg !== undefined) submittedAmounts.set(externalItemId(item, index), kg);
  });
  // Сверку ядро пропускает (skipDriftCheck) — значит, и строки само не
  // перечитает: снимок итогов должен взять расчёт Quick Resto отсюда.
  const refreshed = await refreshLocalInventoryDocumentFromPayload({
    admin: db,
    accountId,
    documentId,
    document: { ...fullDoc, effectedItems: boItems },
    keepStatus: true,
    submittedAmounts,
  });
  if (refreshed.skippedEmptyPayload) {
    throw new CommitStepError("Quick Resto не вернул позиции акта взвешивания — повторим позже");
  }
  // Расчёт пришёл — акт готов к проведению, даже если синхронизация успела
  // пометить его «Итоги требуют проверки».
  await transitionDocumentStatus({
    admin: db,
    accountId,
    documentId,
    from: ["results_blocked"],
    finalized: "open",
    patch: { status: "ready_for_review" },
  });

  // 5. Проведение и снимок итогов — общей функцией от имени мастера.
  await heartbeat(db, lease);
  const core = await finalizeInventoryDocumentCore({
    admin: db,
    accountId,
    documentId,
    actorUserId: masterId,
    source: "weighing",
    skipDriftCheck: true,
  });
  if (core.error) throw new Error(core.error);
  try {
    revalidateInventoryResultPages(documentId);
  } catch {
    // Вне запроса (фоновый тик) обновлять нечего — страницы динамические.
  }

  // 6. «Готово»; отчёт отправит отдельная фаза.
  await finishDone(ctx, config);
}

/**
 * Проведение закончено. Отчёт в Telegram ставится в свою очередь (pending), а
 * не шлётся здесь: так падение между отправкой и записью «готово» не может
 * отправить его второй раз.
 */
async function finishDone(ctx: Ctx, config: CountConfig) {
  const hasChat = Boolean(config.telegramChatId);
  await writeLeased(ctx.db, ctx.lease, {
    status: "done",
    last_error: null,
    next_attempt_at: new Date().toISOString(),
    telegram_status: hasChat ? "pending" : "skipped",
    telegram_attempts: 0,
    telegram_next_attempt_at: hasChat ? new Date().toISOString() : null,
  });
}

async function connectionOrFail(accountId: string): Promise<QuickRestoConnection> {
  const connection = await getConnection(accountId);
  if (!connection) throw new CommitStepError("Quick Resto не подключён — проверьте интеграцию в настройках");
  return connection;
}

async function loadStoreExternalId(db: LooseDb, accountId: string, storeId: string): Promise<number> {
  const { data, error } = await db
    .from<{ id: string; external_id: string | null }>("stores")
    .select("id, external_id")
    .eq("id", storeId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const externalId = Number(data?.external_id);
  if (!data?.external_id || !Number.isFinite(externalId)) {
    throw new CommitStepError("Склад взвешивания не связан с Quick Resto — проверьте настройку задачи", {
      terminal: true,
    });
  }
  return externalId;
}

async function loadSectionLines(
  db: LooseDb,
  accountId: string,
  config: CountConfig,
  netKg: Record<string, number>,
): Promise<SectionLine[]> {
  const ids = config.sections.map((section) => section.productId);
  const { data, error } = await db
    .from<Array<{ id: string; name: string; external_id: string | null; kind: string | null }>>("ingredients")
    .select("id, name, external_id, kind")
    .eq("account_id", accountId)
    .in("id", ids);
  if (error) throw new Error(error.message);
  const byId = new Map((data ?? []).map((row) => [row.id, row]));
  const lines = config.sections.map((section) => {
    const row = byId.get(section.productId);
    const externalProductId = Number(row?.external_id);
    if (!row?.external_id || !Number.isFinite(externalProductId)) {
      throw new CommitStepError(
        `Позиция раздела «${section.title}» не связана с Quick Resto — проверьте настройку задачи`,
        { terminal: true },
      );
    }
    return {
      section,
      ingredient: { id: row.id, name: row.name, kind: row.kind ?? "ingredient" },
      externalProductId,
      kg: netKg[section.key] ?? 0,
    };
  });
  if (new Set(lines.map((line) => line.externalProductId)).size !== lines.length) {
    throw new CommitStepError("Два раздела взвешивания ссылаются на одну позицию — проверьте настройку задачи", {
      terminal: true,
    });
  }
  return lines;
}

/**
 * Образец строки акта: последняя строка этой позиции из прежних актов. Quick
 * Resto создаёт строку по полному объекту товара, а не по id.
 */
async function loadSample(db: LooseDb, accountId: string, line: SectionLine): Promise<QuickRestoInventoryItem2> {
  const { data, error } = await db
    .from<Array<{ raw_payload: QuickRestoInventoryItem2 | null }>>("document_items")
    .select("raw_payload, updated_at")
    .eq("account_id", accountId)
    .eq("external_product_id", String(line.externalProductId))
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const sample = (data ?? [])
    .map((row) => row.raw_payload)
    .find(
      (raw): raw is QuickRestoInventoryItem2 =>
        Boolean(raw?.product) && nomenclatureKind(raw as QuickRestoInventoryItem2) === line.ingredient.kind,
    );
  if (!sample) {
    throw new CommitStepError(
      `Нет образца позиции «${line.ingredient.name}»: сначала загрузите прежние акты склада`,
      { terminal: true },
    );
  }
  return sample;
}

/** Связанный акт должен быть нашим: тот же склад и маркер задания. */
function assertOwnDocument(doc: QuickRestoInventoryDocument2, marker: string, storeExternalId: number) {
  const storeId = doc.store?.id;
  const wrongStore = typeof storeId === "number" && storeId !== storeExternalId;
  const wrongMarker = typeof doc.comment === "string" && !doc.comment.includes(marker);
  if (wrongStore || wrongMarker) {
    throw new CommitStepError("Связанный акт Quick Resto не относится к этому взвешиванию — проверьте акт", {
      terminal: true,
    });
  }
}

async function findDocumentByMarker(input: {
  apiAuth: { layerName: string; login: string; password: string };
  marker: string;
  storeExternalId: number;
  invoiceDateMs: number;
  heartbeat: () => Promise<void>;
}): Promise<QuickRestoInventoryDocument2 | null> {
  // Без ответа Quick Resto отсутствие акта не доказано: ошибка → повтор, а не
  // создание второго акта.
  const list = await listInventoryDocuments(input.apiAuth);
  const candidates = markerSearchCandidates(list, {
    storeExternalId: input.storeExternalId,
    invoiceDateMs: input.invoiceDateMs,
  });
  const withComment = candidates.filter((doc) => typeof doc.comment === "string");
  const unknown = candidates.filter((doc) => typeof doc.comment !== "string");
  if (unknown.length > MAX_MARKER_READS) {
    throw new CommitStepError("Не удалось проверить, создан ли уже акт взвешивания в Quick Resto");
  }
  const read: QuickRestoInventoryDocument2[] = [];
  for (const doc of unknown) {
    read.push(await readInventoryDocument({ ...input.apiAuth, objectId: doc.id }));
    await input.heartbeat();
  }
  const found = findMarkedDocument([...withComment, ...read], input.marker);
  if (!found) return null;
  // Склад в списке мог не прийти — сверяем по полному акту.
  const full = await readInventoryDocument({ ...input.apiAuth, objectId: found.id });
  assertOwnDocument(full, input.marker, input.storeExternalId);
  return full;
}

/** Откат пустого свежесозданного акта: в Quick Resto не должно оставаться пустышек. */
async function removeEmptyDocument(input: {
  db: LooseDb;
  lease: Lease;
  connection: QuickRestoConnection;
  apiAuth: { layerName: string; login: string; password: string };
  qrAuth: { layerName: string; baseUrl: string | null };
  documentExternalId: number;
}): Promise<boolean> {
  try {
    const doc = await readInventoryDocument({ ...input.apiAuth, objectId: input.documentExternalId });
    await withBackOfficeSession({
      connection: input.connection,
      admin: input.db,
      run: (authorization) => removeInventoryDocumentBackOffice({ ...input.qrAuth, authorization, document: doc }),
    });
    await writeLeased(input.db, input.lease, { qr_document_id: null });
    return true;
  } catch (error) {
    // Не удалили — повтор возьмёт этот же акт по qr_document_id или маркеру.
    console.error("[stock-count commit] откат пустого акта не удался", {
      documentExternalId: input.documentExternalId,
      error: rawMessage(error),
    });
    return false;
  }
}

const COUNTED_BEFORE_SUBMIT = ["synced", "assigned", "in_progress"];

async function upsertLocalDocument(input: {
  db: LooseDb;
  accountId: string;
  fullDoc: QuickRestoInventoryDocument2;
  documentExternalId: number;
  config: CountConfig;
  storeExternalId: number;
  masterId: string;
  invoiceDateMs: number;
}): Promise<string> {
  const { db, accountId } = input;
  const externalId = String(input.documentExternalId);
  const { data: existing, error } = await db
    .from<{ id: string; status: string }>("documents")
    .select("id, status")
    .eq("account_id", accountId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // submitted_at / submitted_by у documents удалены миграцией 233: кто сдал —
  // видно по исполнителю и журналу акта.
  const ownership = { assigned_to: input.masterId };
  if (existing) {
    // Акт могла успеть загрузить синхронизация. Сданным он становится только
    // из статусов «до сдачи»; проведённый и зафиксированный не трогаем.
    if (COUNTED_BEFORE_SUBMIT.includes(existing.status)) {
      await transitionDocumentStatus({
        admin: db,
        accountId,
        documentId: existing.id,
        from: [existing.status],
        finalized: "open",
        patch: { status: "ready_for_review", ...ownership },
      });
    }
    return existing.id;
  }
  const { data: created, error: insertError } = await db
    .from<{ id: string }>("documents")
    .upsert(
      {
        account_id: accountId,
        external_id: externalId,
        document_kind: "inventory",
        document_number: inventoryDocumentNumber(input.fullDoc),
        invoice_date: dateText(input.fullDoc.invoiceDate) ?? new Date(input.invoiceDateMs).toISOString(),
        store_id: input.config.storeId,
        external_store_id: String(input.storeExternalId),
        status: "ready_for_review",
        processed: false,
        results_has_line_amounts: false,
        comment: typeof input.fullDoc.comment === "string" ? input.fullDoc.comment : null,
        synced_at: new Date().toISOString(),
        ...ownership,
      },
      { onConflict: "account_id,external_id" },
    )
    .select("id")
    .single();
  if (insertError || !created?.id) throw new Error(insertError?.message ?? "documents: акт не сохранён");
  return created.id;
}

/**
 * Отчёт в Telegram по проведённому акту — своя фаза с повторами (1, 5, 15,
 * 60 минут, всего 5 попыток), как у сообщений задач. Проведение уже `done`, и
 * сбой отчёта его не трогает.
 *
 * Защита от двойной отправки: захват ставит следующую попытку не раньше чем
 * через срок аренды (долгое скачивание PDF не даст второму воркеру начать ту же
 * отправку), а прямо перед вызовом Telegram статус становится `sending`. Упали
 * после этого — дошло ли сообщение, неизвестно, и отчёт не повторяется.
 */
async function runTelegram(occurrenceId: string): Promise<"sent" | "failed" | "skipped"> {
  const db = asLooseDb(createAdminClient());
  let row: CommitRow | null;
  let step: ReturnType<typeof telegramStep>;
  try {
    row = await readCommit(db, occurrenceId);
    step = row ? telegramStep(row, new Date()) : null;
  } catch (error) {
    console.error("[stock-count telegram] чтение очереди не удалось", { occurrenceId, error: rawMessage(error) });
    return "failed";
  }
  if (!row || !step) return "skipped";

  if (step === "abandon") {
    const closed = await casUpdate(db, row, {
      telegram_status: "failed",
      telegram_next_attempt_at: null,
      updated_at: new Date().toISOString(),
    }).catch(() => null);
    if (closed) {
      console.warn("[stock-count telegram] отправка прервалась посередине — не повторяем", { occurrenceId });
      await notifyReportFailure(db, closed, "отчёт мог не дойти до чата Telegram — проверьте чат");
    }
    return "failed";
  }

  const now = new Date();
  const attempt = row.telegram_attempts + 1;
  const token = randomUUID();
  const claimed = await casUpdate(db, row, {
    telegram_attempts: attempt,
    telegram_next_attempt_at: new Date(now.getTime() + LEASE_STALE_MS).toISOString(),
    lease_token: token,
    updated_at: now.toISOString(),
  }).catch((error) => {
    console.error("[stock-count telegram] захват не удался", { occurrenceId, error: rawMessage(error) });
    return null;
  });
  if (!claimed) return "skipped";
  const lease: Lease = { id: claimed.id, token, phase: "done" };

  let sent = false;
  try {
    await sendReport(db, lease, claimed);
    sent = true;
    await writeLeased(db, lease, { telegram_status: "sent", telegram_next_attempt_at: null });
    return "sent";
  } catch (error) {
    if (sent || error instanceof LeaseLostError) {
      // Отправлено, но не записано / строку забрали: состояние допишет тот, у
      // кого аренда, или зависший `sending` закроется без повтора.
      console.error("[stock-count telegram] итог отправки не записан", { occurrenceId, error: rawMessage(error) });
      return sent ? "sent" : "skipped";
    }
    console.error("[stock-count telegram] отчёт не отправлен", { occurrenceId, attempt, error: rawMessage(error) });
    const next = nextAttemptAt(attempt, new Date());
    try {
      await writeLeased(db, lease, {
        telegram_status: "failed",
        telegram_next_attempt_at: next ? next.toISOString() : null,
      });
    } catch (writeError) {
      console.error("[stock-count telegram] неудача не записана", { occurrenceId, error: rawMessage(writeError) });
      return "failed";
    }
    if (!next) await notifyReportFailure(db, claimed, "отчёт не отправлен в Telegram после 5 попыток");
    return "failed";
  }
}

async function sendReport(db: LooseDb, lease: Lease, commit: CommitRow): Promise<void> {
  const { data: occurrence, error: occurrenceError } = await db
    .from<OccurrenceRow>("schedule_task_occurrences")
    .select(OCCURRENCE_COLUMNS)
    .eq("id", commit.occurrence_id)
    .eq("account_id", commit.account_id)
    .maybeSingle();
  if (occurrenceError || !occurrence) throw new Error(occurrenceError?.message ?? "задание не найдено");
  const input = validateCommitInput({
    status: occurrence.status,
    userId: occurrence.user_id,
    snapshot: occurrence.snapshot,
    answers: occurrence.answers,
    submittedAt: occurrence.submitted_at,
  });
  if (!input.ok) throw new Error(input.error);
  const { config, netKg } = input;
  const chatId = config.telegramChatId;
  const documentId = commit.document_id;
  const qrId = qrDocumentIdOf(commit);
  if (!chatId) throw new Error("чат Telegram не указан");
  if (!documentId || qrId === null) throw new Error("нет акта для отчёта");
  const connection = await connectionOrFail(commit.account_id);
  const bot = await loadTelegramBot(db, commit.account_id);
  if (!bot) throw new Error("Telegram не настроен");

  const { data: doc } = await db
    .from<{ document_number: string }>("documents")
    .select("document_number")
    .eq("id", documentId)
    .eq("account_id", commit.account_id)
    .maybeSingle();
  const documentNumber = doc?.document_number ?? `QR-${qrId}`;
  const { data: rows } = await db
    .from<
      Array<{
        external_product_id: string | null;
        finalized_difference_amount: number | null;
        finalized_difference_sum: number | null;
        difference_amount: number | null;
        difference_sum: number | null;
      }>
    >("document_items")
    .select("external_product_id, finalized_difference_amount, finalized_difference_sum, difference_amount, difference_sum")
    .eq("account_id", commit.account_id)
    .eq("document_id", documentId);
  const { data: ingredients } = await db
    .from<Array<{ id: string; external_id: string | null }>>("ingredients")
    .select("id, external_id")
    .eq("account_id", commit.account_id)
    .in("id", config.sections.map((section) => section.productId));
  const externalByIngredient = new Map((ingredients ?? []).map((row) => [row.id, row.external_id]));
  const lines = config.sections.map((section) => {
    const ext = externalByIngredient.get(section.productId);
    const row = (rows ?? []).find((r) => ext && r.external_product_id === String(ext));
    return {
      title: section.title,
      kg: netKg[section.key] ?? 0,
      deltaKg: row ? row.finalized_difference_amount ?? row.difference_amount : null,
      deltaSum: row ? row.finalized_difference_sum ?? row.difference_sum : null,
    };
  });
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://sheerly.app").replace(/\/$/, "");
  const caption = buildWeighingCaption({
    documentNumber,
    employeeName: occurrence.employee_name?.trim() || "Сотрудник",
    lines,
    url: `${base}/documents/inventory/${documentId}`,
  });
  // Перед самим вызовом Telegram — отметка «отправляется» (см. runTelegram).
  const markSending = () => writeLeased(db, lease, { telegram_status: "sending" });
  await sendWeighingReport({
    bot: {
      sendDocument: async (...args) => {
        await markSending();
        return bot.sendDocument(...args);
      },
      sendMessage: async (...args) => {
        await markSending();
        return bot.sendMessage(...args);
      },
    },
    chatId,
    filename: `Взвешивание-${documentNumber}.pdf`,
    caption,
    download: () =>
      withBackOfficeSession({
        connection,
        admin: db,
        run: (authorization) =>
          downloadInventoryResultsPdfBackOffice({
            layerName: connection.login,
            baseUrl: connection.backoffice_base_url,
            authorization,
            documentId: qrId,
          }),
      }),
  });
}

async function notifyReportFailure(db: LooseDb, commit: CommitRow, reason: string) {
  if (!commit.document_id) return;
  try {
    const { data: occurrence } = await db
      .from<{ employee_name: string | null; business_date: string }>("schedule_task_occurrences")
      .select("employee_name, business_date")
      .eq("id", commit.occurrence_id)
      .maybeSingle();
    const recipients = await reviewerIds(db, commit.venue_id);
    const who = occurrence?.employee_name?.trim() || "Сотрудник";
    const date = occurrence?.business_date ? occurrence.business_date.split("-").reverse().slice(0, 2).join(".") : null;
    for (const userId of recipients) {
      await notifyInventoryDocumentEvent({
        admin: db,
        recipientId: userId,
        actorId: null,
        venueId: commit.venue_id,
        documentId: commit.document_id,
        type: "inventory.weighing_failed",
        title: "Отчёт о взвешивании не отправлен",
        body: `${who}${date ? `, взвешивание за ${date}` : ""}: акт проведён, но ${reason}`,
      });
    }
  } catch (error) {
    console.error("[stock-count telegram] уведомление не отправлено", {
      occurrenceId: commit.occurrence_id,
      error: rawMessage(error),
    });
  }
}

function rawMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function failCommit(input: {
  db: LooseDb;
  lease: Lease;
  commit: CommitRow;
  occurrence: OccurrenceRow | null;
  error: unknown;
}): Promise<Outcome> {
  const { db, lease, commit, occurrence, error } = input;
  console.error("[stock-count commit] попытка не удалась", {
    occurrenceId: commit.occurrence_id,
    attempt: commit.attempts,
    error: rawMessage(error),
  });
  const now = new Date();
  const terminal = error instanceof CommitStepError && error.terminal;
  const next = terminal ? null : nextAttemptAt(commit.attempts, now);
  const text = commitErrorText(error);
  try {
    await writeLeased(db, lease, {
      status: next ? "pending" : "failed",
      last_error: text,
      next_attempt_at: (next ?? now).toISOString(),
    });
  } catch (writeError) {
    // Строка останется processing и через 10 минут вернётся в работу.
    console.error("[stock-count commit] не удалось записать неудачу", {
      occurrenceId: commit.occurrence_id,
      error: rawMessage(writeError),
    });
    return "retry";
  }
  if (next) return "retry";
  await notifyFailure({ db, commit, occurrence, text });
  return "failed";
}

/** Пользователи заведения с правом проверять задачи — им сообщаем об ошибке проведения. */
async function reviewerIds(db: LooseDb, venueId: string): Promise<string[]> {
  const perm = await db.from<Array<{ id: string }>>("permissions").select("id").eq("code", "schedule.review");
  if (perm.error) throw new Error(perm.error.message);
  const permissionIds = (perm.data ?? []).map((p) => p.id);
  if (permissionIds.length === 0) return [];
  // Начинаем с участников заведения: роли других аккаунтов в выборку не попадают.
  const members = await fetchAllRows<{ user_id: string; role_id: string }>(() =>
    db
      .from<Array<{ user_id: string; role_id: string }>>("user_venue_roles")
      .select("user_id, role_id")
      .eq("venue_id", venueId)
      .eq("status", "active")
      .is("fired_at", null),
  );
  const venueRoleIds = [...new Set(members.map((m) => m.role_id))];
  if (venueRoleIds.length === 0) return [];
  const grantedRoles = new Set<string>();
  for (const part of chunk(venueRoleIds, 100)) {
    const granted = await db
      .from<Array<{ role_id: string }>>("role_permissions")
      .select("role_id")
      .in("role_id", part)
      .in("permission_id", permissionIds)
      .eq("granted", true);
    if (granted.error) throw new Error(granted.error.message);
    for (const r of granted.data ?? []) grantedRoles.add(r.role_id);
  }
  return [...new Set(members.filter((m) => grantedRoles.has(m.role_id)).map((m) => m.user_id))];
}

async function notifyFailure(input: {
  db: LooseDb;
  commit: CommitRow;
  occurrence: OccurrenceRow | null;
  text: string;
}) {
  const { db, commit, occurrence, text } = input;
  try {
    const recipients = await reviewerIds(db, commit.venue_id);
    if (recipients.length === 0) return;
    const who = occurrence?.employee_name?.trim() || "Сотрудник";
    const date = occurrence?.business_date
      ? occurrence.business_date.split("-").reverse().slice(0, 2).join(".")
      : null;
    const title = "Взвешивание не проведено";
    const body = `${who}${date ? `, взвешивание за ${date}` : ""}: ${text}`;
    if (commit.document_id) {
      for (const userId of recipients) {
        await notifyInventoryDocumentEvent({
          admin: db,
          recipientId: userId,
          actorId: null,
          venueId: commit.venue_id,
          documentId: commit.document_id,
          type: "inventory.weighing_failed",
          title,
          body,
        });
      }
      return;
    }
    const link = occurrence?.business_date
      ? `/schedule?showTasks=1&date=${occurrence.business_date}`
      : "/schedule?showTasks=1";
    const { error } = await db.from("notifications").insert(
      recipients.map((userId) => ({
        user_id: userId,
        venue_id: commit.venue_id,
        type: "schedule.weighing_failed",
        category: "schedule",
        title,
        body,
        link,
        actor_user_id: null,
        entity_type: "schedule_task_occurrence",
        entity_id: commit.occurrence_id,
      })),
    );
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error("[stock-count commit] уведомление об ошибке не отправлено", {
      occurrenceId: commit.occurrence_id,
      error: rawMessage(error),
    });
  }
}

/**
 * Тик очереди: созревшие `pending`, брошенные упавшим воркером `processing`, а
 * затем отчёты в Telegram проведённых актов. По одному за раз, не дольше бюджета
 * тика. `failed` — попытки, закончившиеся ошибкой (в том числе ушедшие на повтор),
 * включая отчёты.
 */
export async function processStockCountCommits(limit = 3): Promise<{ done: number; failed: number }> {
  const db = asLooseDb(createAdminClient());
  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - LEASE_STALE_MS).toISOString();
  const ids = (rows: { data: Array<{ occurrence_id: string }> | null; error: { message: string } | null }) => {
    if (rows.error) throw new Error(rows.error.message);
    return (rows.data ?? []).map((row) => row.occurrence_id);
  };
  const [due, stale, telegramDue, telegramStuck] = await Promise.all([
    db
      .from<Array<{ occurrence_id: string }>>("stock_count_commits")
      .select("occurrence_id")
      .eq("status", "pending")
      .lte("next_attempt_at", nowIso)
      .order("next_attempt_at", { ascending: true })
      .limit(limit),
    db
      .from<Array<{ occurrence_id: string }>>("stock_count_commits")
      .select("occurrence_id")
      .eq("status", "processing")
      .lt("updated_at", staleIso)
      .limit(limit),
    db
      .from<Array<{ occurrence_id: string }>>("stock_count_commits")
      .select("occurrence_id")
      .eq("status", "done")
      .in("telegram_status", ["pending", "failed"])
      .lt("telegram_attempts", MAX_COMMIT_ATTEMPTS)
      .lte("telegram_next_attempt_at", nowIso)
      .order("telegram_next_attempt_at", { ascending: true })
      .limit(limit),
    db
      .from<Array<{ occurrence_id: string }>>("stock_count_commits")
      .select("occurrence_id")
      .eq("status", "done")
      .eq("telegram_status", "sending")
      .lt("updated_at", staleIso)
      .limit(limit),
  ]);
  const commits = [...new Set([...ids(stale), ...ids(due)])].slice(0, limit);
  const reports = [...new Set([...ids(telegramStuck), ...ids(telegramDue)])].slice(0, limit);
  const started = Date.now();
  let done = 0;
  let failed = 0;
  for (const id of commits) {
    if (Date.now() - started > TICK_BUDGET_MS) break;
    const outcome = await runCommit(id);
    if (outcome === "done") done += 1;
    if (outcome === "retry" || outcome === "failed") failed += 1;
  }
  for (const id of reports) {
    if (Date.now() - started > TICK_BUDGET_MS) break;
    if ((await runTelegram(id)) === "failed") failed += 1;
  }
  return { done, failed };
}
