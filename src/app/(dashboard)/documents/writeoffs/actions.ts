"use server";
import { z } from "zod";
import { actionResult } from "@/lib/actions/result";
import {
  createClient,
  getCachedUser,
  getCachedPermissions,
  getCachedActiveAccountId,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import type {
  StoredWriteoff,
  WriteoffArchive,
  WriteoffRules,
} from "@/lib/stock/writeoffs";
import type { WriteoffPoolAssignment } from "@/lib/stock/writeoff-pools";
import type { WriteoffSuggestionRuleVersion } from "@/lib/stock/writeoff-pool-suggestion";
import type { PostedWriteoffDeduction } from "@/lib/stock/writeoff-deduction-status";
import type { WriteoffBulkResult } from "@/lib/stock/writeoff-journal";
import { autoRecalculateInventoryDeduction } from "@/app/(dashboard)/inventory/deduction-service";
import { isDeductionAutopostEnabled } from "@/lib/stock/deduction-flag";
export type WriteoffPoolTargets = {
  departments: Array<{ id: string; name: string; archived: boolean }>;
  employees: Array<{
    id: string;
    name: string;
    active: boolean;
    /** ID в Quick Resto: по нему акт «Сотрудник» подсказывает, кого выбрать. */
    quickrestoId?: number | null;
  }>;
};
export type WriteoffJobStatus = {
  id: string;
  month: string;
  state: "pending" | "running" | "ready" | "error";
  cursor: number;
  total: number | null;
  last_error: string | null;
  completed_at: string | null;
};
export type WriteoffData = {
  venueId: string;
  permissions: string[];
  documents: StoredWriteoff[];
  archives: WriteoffArchive[];
  jobs: WriteoffJobStatus[];
  /** Кто платит за акт; ключ - внешний ID акта Quick Resto. */
  assignments: WriteoffPoolAssignment[];
  /** Имена для подписей; полный список для выбора - только у того, кто разносит. */
  targets: WriteoffPoolTargets;
  rules: WriteoffRules | null;
  /**
   * Группы правил удержаний по версиям: по ним акт «Кальянные мастера»
   * подсказывает подразделение. Только у того, кто разносит.
   */
  ruleGroups: WriteoffSuggestionRuleVersion[];
  origin: Record<string, unknown>;
  providerOrigin: string | null;
  connected: boolean;
  currentMonth: string;
  timezone: string;
  /**
   * Пересчитывается ли удержание само после разнесения (INVENTORY_DEDUCTION_AUTOPOST).
   * Нет - после смены плательщика в посчитанном месяце страница просит пересчитать вручную.
   */
  autopost: boolean;
};
async function scope(expected?: string) {
  const [client, user, permissions, accountId] = await Promise.all([
    createClient(),
    getCachedUser(),
    getCachedPermissions(),
    getCachedActiveAccountId(),
  ]);
  const db = asLooseDb(client),
    venue = await db.rpc("get_active_venue_id");
  if (
    !user ||
    !accountId ||
    venue.error ||
    !venue.data ||
    !permissions.includes("inventory.view_results")
  )
    throw new Error("Нет доступа к списаниям");
  if (expected && venue.data !== z.string().uuid().parse(expected))
    throw new Error("Заведение изменилось. Обновите страницу");
  return {
    client,
    db,
    user,
    accountId,
    permissions,
    venueId: String(venue.data),
  };
}
type Scope = Awaited<ReturnType<typeof scope>>;
async function pagedRows<T>(
  s: Scope,
  table: string,
  cols: string,
  order: string,
) {
  const result: T[] = [];
  for (let start = 0; start < 100000; start += 1000) {
    const r = await s.db
      .from<T[]>(table)
      .select(cols)
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId)
      .order(order, { ascending: false })
      .order("id")
      .range(start, start + 999);
    if (r.error) throw new Error("Не удалось загрузить журнал списаний");
    result.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) return result;
  }
  throw new Error("Не удалось загрузить журнал целиком");
}
type AssignmentRow = {
  venue_id: string;
  external_id: number;
  pool: WriteoffPoolAssignment["pool"];
  department_id: string | null;
  employee_id: string | null;
};
const toAssignment = (r: AssignmentRow): WriteoffPoolAssignment => ({
  venue_id: r.venue_id,
  external_id: Number(r.external_id),
  pool: r.pool,
  key: r.pool === "department" ? r.department_id : r.employee_id,
});
/** Только то, что нужно подсказке: ID, название и подразделения групп. */
function ruleGroupsOf(r: {
  version: number;
  valid_from: string;
  groups: unknown;
}): WriteoffSuggestionRuleVersion {
  const groups = Array.isArray(r.groups) ? r.groups : [];
  return {
    version: Number(r.version),
    valid_from: String(r.valid_from),
    groups: groups.flatMap((g) => {
      if (!g || typeof g !== "object") return [];
      const x = g as { id?: unknown; name?: unknown; departmentIds?: unknown };
      if (typeof x.id !== "string" || typeof x.name !== "string") return [];
      return [
        {
          id: x.id,
          name: x.name,
          departmentIds: Array.isArray(x.departmentIds)
            ? x.departmentIds.filter((d): d is string => typeof d === "string")
            : undefined,
        },
      ];
    }),
  };
}
async function loadWriteoffsImpl(expected?: string): Promise<WriteoffData> {
  const s = await scope(expected);
  const rows = <T>(table: string, cols: string, order: string) =>
    pagedRows<T>(s, table, cols, order);
  const canAssign = s.permissions.includes("inventory.assign_writeoff_pool");
  const [documents, archives, source, jobs, connection, marks, targets, rules] =
    await Promise.all([
      rows<StoredWriteoff>(
        "stock_writeoff_documents",
        "id,venue_id,business_date,external_id,payload,source_hash,captured_at,version,missing_at",
        "business_date",
      ),
      rows<WriteoffArchive>(
        "stock_writeoff_archive",
        "id,venue_id,business_date,legacy_ref,name,quantity,total,correspondent,kind,document_number,document_url,category,deleted,delete_reason,period_total_raw,issues,origin,captured_at",
        "captured_at",
      ),
      s.db
        .from<{
          enabled: boolean;
          config: WriteoffRules;
          origin: Record<string, unknown>;
        }>("stock_writeoff_sources")
        .select("enabled,config,origin")
        .eq("account_id", s.accountId)
        .eq("venue_id", s.venueId)
        .maybeSingle(),
      s.db.rpc("stock_writeoff_job_status", { p_expected_venue: s.venueId }),
      asLooseDb(createAdminClient())
        .from<{ login: string }>("integration_connections")
        .select("login")
        .eq("account_id", s.accountId)
        .eq("provider", "quickresto")
        .eq("status", "active")
        .maybeSingle(),
      rows<AssignmentRow>(
        "writeoff_pool_assignments",
        "id,venue_id,external_id,pool,department_id,employee_id",
        "assigned_at",
      ),
      s.db.rpc("writeoff_pool_targets"),
      canAssign
        ? s.db
            .from<Array<{ version: number; valid_from: string; groups: unknown }>>(
              "stock_deduction_rules",
            )
            .select("version,valid_from,groups:config->groups")
            .eq("account_id", s.accountId)
            .eq("venue_id", s.venueId)
            .order("version", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (source.error || jobs.error || connection.error || targets.error)
    throw new Error("Не удалось загрузить состояние списаний");
  const check = await s.db.rpc("get_active_venue_id");
  if (check.error || check.data !== s.venueId)
    throw new Error("Заведение изменилось. Обновите страницу");
  const timezone = source.data?.config.timezone ?? "Europe/Moscow";
  return {
    venueId: s.venueId,
    permissions: s.permissions,
    documents,
    archives,
    jobs: (jobs.data ?? []) as WriteoffJobStatus[],
    assignments: marks.map(toAssignment),
    targets: (targets.data as WriteoffPoolTargets | null) ?? {
      departments: [],
      employees: [],
    },
    rules: source.data?.config ?? null,
    // Подсказка - не расчёт: правила, которые не прочитались, просто не подсказывают.
    ruleGroups: rules.error ? [] : (rules.data ?? []).map(ruleGroupsOf),
    origin: source.data?.origin ?? {},
    providerOrigin:
      connection.data && /^[-a-z0-9]+$/.test(connection.data.login)
        ? `https://${connection.data.login}.quickresto.ru`
        : null,
    connected: !!source.data?.enabled && !!connection.data,
    currentMonth: new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
    })
      .format(new Date())
      .slice(0, 7),
    timezone,
    autopost: isDeductionAutopostEnabled(process.env),
  };
}
async function requestWriteoffsImpl(venueId: string, month: string) {
  const s = await scope(venueId);
  z.string()
    .regex(/^20\d{2}-(0[1-9]|1[0-2])$/)
    .parse(month);
  if (!s.permissions.includes("inventory.sync_quickresto"))
    throw new Error("Нет доступа к обновлению Quick Resto");
  const r = await s.db.rpc("stock_request_writeoff_month", {
    p_expected_venue: s.venueId,
    p_month: month + "-01",
  });
  if (r.error) throw new Error(r.error.message);
  return loadWriteoffsImpl(venueId);
}
/**
 * Поставить, сменить или снять (pool = null) плательщика за акт. Право отдельное
 * от просмотра журнала: пометка двигает деньги сотрудников. Возвращает пометку
 * этого акта после записи (null, если её нет), а не весь список: так запись не
 * тянет заново всё разнесение заведения. `notice` - пояснение об удержании по недостаче
 * (пересчёт месяца после пометки), если автоматический пересчёт включён.
 */
async function assignWriteoffPoolImpl(
  venueId: string,
  externalId: number,
  pool: WriteoffPoolAssignment["pool"] | null,
  key: string | null,
): Promise<{ mark: WriteoffPoolAssignment | null; notice: string | null }> {
  const s = await scope(venueId);
  if (!s.permissions.includes("inventory.assign_writeoff_pool"))
    throw new Error("Нет права разносить списания");
  if (!z.number().int().positive().safe().safeParse(externalId).success)
    throw new Error("Проверьте номер акта");
  if (
    !z
      .enum(["shared", "department", "personal", "excluded"])
      .nullable()
      .safeParse(pool).success
  )
    throw new Error("Проверьте, кто платит");
  if (!z.string().uuid().nullable().safeParse(key).success)
    throw new Error("Проверьте выбранного сотрудника или подразделение");
  const r = await s.db.rpc("set_writeoff_pool", {
    p_external_id: String(externalId),
    p_pool: pool,
    p_key: key,
  });
  if (r.error) throw new Error(r.error.message);
  // Плательщик за акт меняет результат месяца. Выключено по умолчанию (INVENTORY_DEDUCTION_AUTOPOST);
  // сбой пересчёта пометку не отменяет - она уже записана.
  const notice = await autoRecalculateInventoryDeduction({
    kind: "writeoff",
    venueId,
    externalId,
  });
  const mark = await s.db
    .from<AssignmentRow>("writeoff_pool_assignments")
    .select("venue_id,external_id,pool,department_id,employee_id")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("external_id", externalId)
    .maybeSingle();
  if (mark.error) throw new Error("Не удалось загрузить разнесение");
  return { mark: mark.data ? toAssignment(mark.data) : null, notice };
}
const poolSchema = z.enum(["shared", "department", "personal", "excluded"]);

/**
 * Один плательщик для многих актов («Кто платит» в панели массовых действий).
 * Разносятся только проведённые акты, которые есть в Quick Resto; остальные и
 * уже разнесённые на этого плательщика пропускаются и возвращаются счётчиками.
 * В журнал - одна строка на команду (RPC set_writeoff_pool_bulk). Пересчёт
 * удержания (если включён) - один раз на каждый затронутый месяц, а не на акт.
 */
async function assignWriteoffPoolBulkImpl(
  venueId: string,
  externalIds: number[],
  pool: WriteoffPoolAssignment["pool"],
  key: string | null,
): Promise<
  WriteoffBulkResult & {
    marks: WriteoffPoolAssignment[];
    /** Месяцы (`YYYY-MM-01`), где у актов сменился плательщик. */
    months: string[];
    notice: string | null;
  }
> {
  const s = await scope(venueId);
  if (!s.permissions.includes("inventory.assign_writeoff_pool"))
    throw new Error("Нет права разносить списания");
  const ids = z
    .array(z.number().int().positive().safe())
    .min(1, "Выберите акты списания")
    .max(1000, "За один раз можно разнести не больше 1000 актов")
    .safeParse(externalIds);
  if (!ids.success)
    throw new Error(ids.error.issues[0]?.message ?? "Проверьте выбранные акты");
  if (!poolSchema.safeParse(pool).success)
    throw new Error("Проверьте, кто платит");
  if (!z.string().uuid().nullable().safeParse(key).success)
    throw new Error("Проверьте выбранного сотрудника или подразделение");
  const unique = [...new Set(ids.data)];
  const r = await s.db.rpc("set_writeoff_pool_bulk", {
    p_external_ids: unique.map(String),
    p_pool: pool,
    p_key: key,
  });
  if (r.error) throw new Error(r.error.message);
  const out = (r.data ?? {}) as Partial<WriteoffBulkResult> & {
    months?: unknown;
  };
  const months = Array.isArray(out.months)
    ? out.months.filter(
        (m): m is string => typeof m === "string" && /^\d{4}-\d{2}-01$/.test(m),
      )
    : [];
  // Разнесение уже записано: сбой пересчёта его не отменяет (как у одного акта).
  const notice = months.length
    ? await autoRecalculateInventoryDeduction({
        kind: "months",
        items: months.map((month) => ({ venueId: s.venueId, month })),
      })
    : null;
  const marks: WriteoffPoolAssignment[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    const page = await s.db
      .from<AssignmentRow[]>("writeoff_pool_assignments")
      .select("venue_id,external_id,pool,department_id,employee_id")
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId)
      .in("external_id", unique.slice(i, i + 200));
    if (page.error) throw new Error("Не удалось загрузить разнесение");
    marks.push(...(page.data ?? []).map(toAssignment));
  }
  return {
    applied: Number(out.applied ?? 0),
    unchanged: Number(out.unchanged ?? 0),
    notCounted: Number(out.notCounted ?? 0),
    notFound: Number(out.notFound ?? 0),
    marks,
    months,
    notice,
  };
}

/**
 * Последний расчёт удержания по недостаче за месяц: когда посчитан и какие акты
 * списания в него вошли (для сравнения с текущим разнесением). Снимки видит
 * только тот, кто ставит удержания или видит зарплату (RLS 309); остальным
 * `visible: false` - страница статус не показывает и о расчёте ничего не говорит.
 */
async function loadWriteoffDeductionImpl(
  venueId: string,
  month: string,
): Promise<{ visible: boolean; posted: PostedWriteoffDeduction | null }> {
  const s = await scope(venueId);
  if (!/^20\d{2}-(0[1-9]|1[0-2])-01$/.test(month))
    throw new Error("Проверьте месяц");
  if (
    !s.permissions.includes("inventory.post_deductions") &&
    !s.permissions.includes("payroll.view")
  )
    return { visible: false, posted: null };
  const r = await s.db
    .from<{
      captured_at: string;
      reversed_at: string | null;
      sources: unknown;
    }>("inventory_deduction_snapshots")
    .select("captured_at,reversed_at,sources:snapshot->sources")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("month", month)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (r.error) throw new Error("Не удалось проверить удержание за месяц");
  return {
    visible: true,
    posted: r.data
      ? {
          capturedAt: r.data.captured_at,
          reversedAt: r.data.reversed_at,
          sources: r.data.sources,
        }
      : null,
  };
}

export type WriteoffHistory = {
  id: string;
  action: string;
  created_at: string;
  before_payload: StoredWriteoff["payload"] | null;
  after_payload: StoredWriteoff["payload"] | null;
  actor_id: string | null;
  actor_name?: string;
};
async function loadWriteoffHistoryImpl(
  venueId: string,
  id: string,
): Promise<WriteoffHistory[]> {
  const s = await scope(venueId);
  z.string().uuid().parse(id);
  const result: WriteoffHistory[] = [];
  for (let start = 0; start < 100000; start += 1000) {
    const r = await s.db
      .from<WriteoffHistory[]>("stock_writeoff_history")
      .select("id,action,created_at,before_payload,after_payload,actor_id")
      .eq("account_id", s.accountId)
      .eq("venue_id", venueId)
      .eq("document_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range(start, start + 999);
    if (r.error) throw new Error("Не удалось загрузить историю акта");
    result.push(...(r.data ?? []));
    if ((r.data ?? []).length < 1000) {
      const ids = [
        ...new Set(result.flatMap((h) => (h.actor_id ? [h.actor_id] : []))),
      ];
      const profiles = ids.length
        ? await s.client
            .from("profiles")
            .select("id,first_name,last_name")
            .in("id", ids)
        : null;
      if (profiles?.error)
        throw new Error("Не удалось загрузить авторов истории");
      const people = new Map(
        (profiles?.data ?? []).map((p) => [
          p.id,
          [p.first_name, p.last_name].filter(Boolean).join(" "),
        ]),
      );
      return result.map((h) => ({
        ...h,
        actor_name: h.actor_id
          ? people.get(h.actor_id) || "Пользователь"
          : "Система",
      }));
    }
  }
  throw new Error("Не удалось загрузить историю целиком");
}

// Действия возвращают ошибку текстом, а не исключением: в рабочей сборке Next.js
// заменяет текст брошенного исключения английской заглушкой (см. lib/actions/result).
export async function loadWriteoffs(expected?: string) {
  return actionResult(() => loadWriteoffsImpl(expected), "Не удалось загрузить списания");
}
export async function requestWriteoffs(venueId: string, month: string) {
  return actionResult(() => requestWriteoffsImpl(venueId, month), "Не удалось обновить списания");
}
export async function assignWriteoffPool(
  venueId: string,
  externalId: number,
  pool: WriteoffPoolAssignment["pool"] | null,
  key: string | null,
) {
  return actionResult(
    () => assignWriteoffPoolImpl(venueId, externalId, pool, key),
    "Не удалось сохранить, кто платит",
  );
}
export async function assignWriteoffPoolBulk(
  venueId: string,
  externalIds: number[],
  pool: WriteoffPoolAssignment["pool"],
  key: string | null,
) {
  return actionResult(
    () => assignWriteoffPoolBulkImpl(venueId, externalIds, pool, key),
    "Не удалось разнести акты",
  );
}
export async function loadWriteoffDeduction(venueId: string, month: string) {
  return actionResult(
    () => loadWriteoffDeductionImpl(venueId, month),
    "Не удалось проверить удержание за месяц",
  );
}
export async function loadWriteoffHistory(venueId: string, id: string) {
  return actionResult(
    () => loadWriteoffHistoryImpl(venueId, id),
    "Не удалось загрузить историю акта",
  );
}
