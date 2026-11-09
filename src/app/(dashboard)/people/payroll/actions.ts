"use server";
import {
  createClient,
  getCachedPermissions,
  getCachedActiveAccountId,
  getCachedUser,
} from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { queuePayroll } from "@/lib/payroll/sync";
import { validateRates, tipBatch, tipMatch } from "@/lib/payroll/calculate";
import { validDate, addDays, businessDate } from "@/lib/sales/time";
import type {
  PayrollData,
  PaySettings,
  Payment,
  Rates,
} from "@/lib/payroll/types";
import { z } from "zod";
async function scope(permission?: string) {
  const client = await createClient();
  const [user, permissions, accountId, venue] = await Promise.all([
    getCachedUser(),
    getCachedPermissions(),
    getCachedActiveAccountId(),
    client.rpc("get_active_venue_id"),
  ]);
  if (!user) throw new Error("Войдите в аккаунт");
  if (!accountId || !venue.data) throw new Error("Выберите заведение");
  if (permission && !permissions.includes(permission))
    throw new Error("Нет доступа к этому действию");
  return {
    client,
    db: asLooseDb(client),
    admin: asLooseDb(createAdminClient()),
    accountId,
    venueId: venue.data as string,
    user,
    permissions,
  };
}
export async function loadPayroll(): Promise<PayrollData> {
  return loadPayrollData(false);
}

export async function loadPayrollOverview(): Promise<PayrollData> {
  return loadPayrollData(true);
}

async function loadPayrollData(overview: boolean): Promise<PayrollData> {
  const s = await scope();
  const manager = s.permissions.includes("payroll.view");
  const employeesRequest = (async () => {
    const { data, error } = await s.db
      .from<PayrollData["employees"]>("payroll_employees")
      .select("*")
      .eq("venue_id", s.venueId);
    if (error) throw new Error(error.message);
    const employees = data ?? [];
    const profileIds = [...new Set(employees.flatMap((e) => e.local_user_id ? [e.local_user_id] : []))];
    if (!profileIds.length) return employees;
    const photos = await s.client.from("profiles").select("id,avatar_url").in("id", profileIds);
    if (photos.error) throw new Error(photos.error.message);
    const avatars = new Map((photos.data ?? []).map((p) => [p.id, p.avatar_url]));
    return employees.map((e) => ({ ...e, avatar_url: avatars.get(e.local_user_id ?? "") ?? null }));
  })();

  const tables = {
    attendanceRules: "payroll_attendance_rules",
    transfers: "payroll_transfers",
    salaryLinks: "payroll_payment_accruals",
    scheduleReviews: "payroll_schedule_reviews",
    assignments: "payroll_employee_models",
    legacyPayments: "payroll_legacy_payments",
    plannedShifts: "schedule_shifts",
    models: "payroll_models",
    rules: "payroll_rule_versions",
    attendance: "payroll_attendance",
    accruals: "payroll_accruals",
    periods: "payroll_periods",
    adjustments: "payroll_adjustments",
    cashbox: "payroll_cashbox",
    payments: "payroll_payments",
    allocations: "payroll_allocations",
    events: "payroll_events",
  } as const;
  // The monthly overview uses accruals and payments, including history for opening balances.
  // Raw attendance and rules are read by the detailed screens.
  const overviewTables = new Set(["transfers", "legacyPayments", "accruals", "adjustments", "payments", "allocations"]);
  const entriesRequest = Promise.all(
    Object.entries(tables).map(async ([key, table]) => {
      if (overview && !overviewTables.has(key)) return [key, []];
      if (
        !manager &&
        [
          "plannedShifts",
          "models",
          "rules",
          "periods",
          "cashbox",
          "payments",
          "events",
        ].includes(key)
      )
        return [key, []];
      const rows: unknown[] = [];
      for (let start = 0; start < 20000; start += 1000) {
        const { data, error } = await s.db
          .from<unknown[]>(table)
          .select("*")
          .eq("venue_id", s.venueId)
          .order(key === "salaryLinks" ? "accrual_id" : "id")
          .range(start, start + 999);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if ((data ?? []).length < 1000) return [key, rows];
      }
      throw new Error("Слишком большая история. Обратитесь к администратору");
    }),
  );
  const metadataRequest = Promise.all([
    s.admin.from<{ day_start_hour: number }>("sales_settings")
      .select("day_start_hour").eq("account_id", s.accountId).eq("venue_id", s.venueId).maybeSingle(),
    s.client.from("venues").select("timezone").eq("id", s.venueId).single(),
    s.client.from("roles").select("id,name").eq("venue_id", s.venueId).is("archived_at", null),
  ]);
  const managerRequest = manager ? loadPayrollManagerData(s, overview) : null;

  const [entries, employees, [hours, venue, roleRows], managerData] = await Promise.all([
    entriesRequest, employeesRequest, metadataRequest, managerRequest,
  ]);
  if (hours.error) throw new Error(hours.error.message);
  if (roleRows.error) throw new Error(roleRows.error.message);
  const result = Object.fromEntries(entries) as Pick<
    PayrollData,
    keyof typeof tables
  >;
  if (!manager) {
    const ids = [...new Set(result.allocations.map((a) => a.payment_id))];
    if (ids.length) {
      const r = await s.admin
        .from<Payment[]>("payroll_payments")
        .select("id,kind,state,created_at,occurred_at")
        .eq("account_id", s.accountId)
        .eq("venue_id", s.venueId)
        .in("id", ids);
      if (r.error) throw new Error(r.error.message);
      result.payments = (r.data ?? []).map((p) => ({
        ...p,
        transaction_id: null,
        cashbox_id: null,
        note: "Выплата сотруднику",
        amount: result.allocations
          .filter((a) => a.payment_id === p.id)
          .reduce((sum, a) => sum + Number(a.amount), 0),
      }));
    }
  }
  const settings = managerData?.settings ?? null;
  // Own-salary access needs only this public policy date, not finance settings.
  let experienceStartsOn = settings?.experience_starts_on ?? null;
  if (!overview && !manager && employees.length) {
    const policy = await s.admin.from<{ experience_starts_on: string | null }>("payroll_settings")
      .select("experience_starts_on").eq("account_id",s.accountId).eq("venue_id",s.venueId).maybeSingle();
    if (policy.error) throw new Error(policy.error.message);
    experienceStartsOn = policy.data?.experience_starts_on ?? null;
  }
  return {
    roles: roleRows.data ?? [],
    experienceStartsOn,
    asOfDate: businessDate(new Date(), venue.data?.timezone ?? "Europe/Moscow", hours.data?.day_start_hour ?? 9),
    venueId: s.venueId,
    userId: s.user.id,
    timezone: venue.data?.timezone ?? "Europe/Moscow",
    dayStartHour: hours.data?.day_start_hour ?? 9,
    permissions: s.permissions,
    settings,
    employees: employees.map(e => ({ ...e, role_name: roleRows.data?.find(r => r.id === e.role_id)?.name ?? e.role_name })),
    ...result,
    sources: managerData?.sources ?? [],
    banks: managerData?.banks ?? [],
    categories: managerData?.categories ?? [],
    staff: managerData?.staff ?? [],
    financeTransactions: managerData?.financeTransactions ?? [],
  };
}
async function loadPayrollManagerData(s: Awaited<ReturnType<typeof scope>>, overview: boolean) {
  const [settings, sources, banks, categories, staff, financeTransactions] = await Promise.all([
    s.db.from<PaySettings>("payroll_settings").select("*").eq("venue_id", s.venueId).maybeSingle(),
    overview ? null : s.admin.from<PayrollData["sources"]>("payroll_source_days")
      .select("business_date,state,error,synced_at,missing_shifts:source->missing_shifts")
      .eq("account_id", s.accountId).eq("venue_id", s.venueId).order("business_date", { ascending: false }),
    s.client.from("bank_accounts").select("id,name,legal_entity_id")
      .eq("account_id", s.accountId).eq("is_active", true).eq("currency", "RUB")
      .or(`venue_id.is.null,venue_id.eq.${s.venueId}`),
    overview ? null : s.client.from("finance_categories").select("id,name")
      .eq("account_id", s.accountId).eq("type", "expense").is("archived_at", null),
    !overview && s.permissions.includes("payroll.configure") ? loadPayrollStaff(s) : [],
    loadPayrollFinanceTransactions(s),
  ]);
  for (const result of [settings, sources, banks, categories]) {
    if (result?.error) throw new Error(result.error.message);
  }
  return {
    settings: settings.data,
    sources: sources?.data ?? [],
    banks: banks.data ?? [],
    categories: categories?.data ?? [],
    staff,
    financeTransactions,
  };
}

async function loadPayrollStaff(s: Awaited<ReturnType<typeof scope>>): Promise<PayrollData["staff"]> {
  const members = await s.client
    .from("user_venue_roles").select("user_id")
    .eq("venue_id", s.venueId).eq("status", "active").is("fired_at", null);
  const ids = (members.data ?? []).map((row) => row.user_id);
  if (!ids.length) return [];
  const profiles = await s.client.from("profiles").select("id,first_name,last_name").in("id", ids);
  return (profiles.data ?? []).map((row) => ({
    user_id: row.id,
    name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
  }));
}

async function loadPayrollFinanceTransactions(s: Awaited<ReturnType<typeof scope>>): Promise<NonNullable<PayrollData["financeTransactions"]>> {
  const categories = await s.db.from<{ id: string; name: string }[]>("finance_categories")
    .select("id,name,finance_category_groups!inner()")
    .eq("account_id", s.accountId).eq("finance_category_groups.account_id", s.accountId)
    .eq("finance_category_groups.is_payroll", true);
  if (categories.error) throw new Error(categories.error.message);
  const names = new Map((categories.data ?? []).map((row) => [row.id, row.name]));
  if (!names.size) return [];

  const rows: NonNullable<PayrollData["financeTransactions"]> = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const transactions = await s.db.from<Omit<(typeof rows)[number], "category_name">[]>("transactions")
      .select("id,date,amount,description,deleted_at,category_id")
      .eq("account_id", s.accountId).eq("venue_id", s.venueId).eq("type", "expense")
      .in("category_id", [...names.keys()]).order("id").range(offset, offset + 999);
    if (transactions.error) throw new Error(transactions.error.message);
    rows.push(...(transactions.data ?? []).map((row) => ({
      ...row, category_name: names.get(row.category_id ?? "") ?? "ФОТ",
    })));
    if ((transactions.data?.length ?? 0) < 1000) return rows;
  }
  throw new Error("Слишком большая история финансовых операций");
}

export async function saveExperienceStart(input: {
  startsOn: string;
  version: number;
  requestKey: string;
  reason: string;
  venueId: string;
}) {
  const parsed = z.object({
    startsOn: z.string().refine(validDate, "Проверьте дату начала начисления"),
    version: z.number().int().min(0),
    requestKey: z.string().uuid(),
    reason: z.string().trim().min(3).max(1000),
    venueId: z.string().uuid(),
  }).parse(input);
  const s = await scope("payroll.configure");
  if (s.venueId !== parsed.venueId) throw new Error("Заведение изменилось. Откройте настройки заново");
  const result = await s.db.rpc("payroll_set_experience_start", {
    p_date: parsed.startsOn,
    p_version: parsed.version,
    p_request: parsed.requestKey,
    p_reason: parsed.reason,
    p_expected_venue: parsed.venueId,
  });
  if (result.error) throw new Error(result.error.message);
}

export async function payrollCommand(
  action: string,
  input: Record<string, unknown>,
) {
  const permissions: Record<string, string> = {
    employee: "payroll.configure",
    rule: "payroll.configure",
    initialize: "payroll.configure",
    model: "payroll.configure",
    new_employee: "payroll.configure",
    settings: "payroll.configure",
    attendance: "payroll.review",
    missing_shift: "payroll.review",
    adjustment: "payroll.review",
    approve_adjustment: "payroll.approve",
    period: "payroll.approve",
  };
  if (!permissions[action]) throw new Error("Неизвестное действие");
  const s = await scope(permissions[action]);
  if (action === "rule") validateRates(input.rates as Rates);
  const r = await s.db.rpc("payroll_command", {
    p_action: action,
    p_input: input,
  });
  if (r.error) throw new Error(r.error.message);
  // The opening balance is used by the statement, not by daily accruals.
  if (
    action === "employee" &&
    ("opening_balance" in input || "opening_confirmed" in input) &&
    Object.keys(input).every((key) =>
      ["id", "opening_balance", "opening_confirmed"].includes(key),
    )
  ) return r.data;
  if (
    [
      "attendance",
      "missing_shift",
      "adjustment",
      "approve_adjustment",
      "employee",
      "rule",
      "settings",
      "new_employee",
    ].includes(action)
  ) {
    const [days, periods] = await Promise.all([
      s.admin
        .from<{ business_date: string }[]>("payroll_source_days")
        .select("business_date")
        .eq("venue_id", s.venueId)
        .eq("account_id", s.accountId)
        .eq("state", "complete"),
      s.admin
        .from<{ month: string; status: string }[]>("payroll_periods")
        .select("month,status")
        .eq("venue_id", s.venueId)
        .eq("account_id", s.accountId),
    ]);
    if (days.error || periods.error)
      throw new Error(
        "Изменение сохранено, но пересчёт не поставлен в очередь. Обновите период вручную.",
      );
    let target = ["adjustment", "missing_shift"].includes(action)
      ? String(input.date)
      : null;
    if (action === "attendance" || action === "approve_adjustment") {
      const item = await s.admin
        .from<{ business_date: string }>(
          action === "attendance"
            ? "payroll_attendance"
            : "payroll_adjustments",
        )
        .select("business_date")
        .eq("id", input.id)
        .eq("venue_id", s.venueId)
        .eq("account_id", s.accountId)
        .single();
      if (item.error)
        throw new Error("Изменение сохранено. Обновите период вручную.");
      target = item.data?.business_date ?? null;
    }
    const cutoff = String(input.valid_from ?? input.hired_on ?? "");
    const dates = (days.data ?? [])
      .filter(
        (d) =>
          (!target ||
            d.business_date === target ||
            (action === "attendance" &&
              d.business_date === addDays(target, 1))) &&
          (!cutoff || d.business_date >= cutoff) &&
          !(periods.data ?? []).some(
            (p) =>
              p.status !== "draft" &&
              p.month.slice(0, 7) === d.business_date.slice(0, 7),
          ),
      )
      .map((d) => d.business_date);
    await queuePayroll(s.accountId, s.venueId, dates);
  }
  return r.data;
}
export async function refreshPayroll(from: string, to: string) {
  const s = await scope("payroll.sync");
  const sales = await s.admin
    .from<{ timezone: string; day_start_hour: number }>("sales_settings")
    .select("timezone,day_start_hour")
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .single();
  if (sales.error || !sales.data)
    throw new Error("Настройте финансовые смены заведения");
  const today = businessDate(
    new Date(),
    sales.data.timezone,
    sales.data.day_start_hour,
  );
  if (validDate(to) && to > today) to = today;
  if (!validDate(from) || !validDate(to) || from > to || to > today)
    throw new Error("Укажите прошедший период");
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    dates.push(d);
    if (dates.length > 366) throw new Error("Не более 366 дней за запуск");
  }
  await queuePayroll(s.accountId, s.venueId, dates);
  return dates.length;
}
const paymentSchema = z.object({
  request_key: z.string().uuid(),
  kind: z.enum(["salary", "advance"]),
  bank_account_id: z.string().uuid(),
  category_id: z.string().uuid(),
  date: z.string().datetime({ offset: true }),
  note: z.string().max(2000),
  amount: z.number().positive().max(1e9),
  allocations: z
    .array(
      z.object({
        employee_id: z.string().uuid(),
        month: z.string().regex(/^\d{4}-\d{2}-01$/),
        amount: z.number().nonnegative(),
        settled_amount: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(500),
});
export async function postPayrollPayment(input: unknown) {
  const s = await scope("payroll.pay"),
    p = paymentSchema.parse(input);
  const r = await s.db.rpc("payroll_post_payment", { p_input: p });
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
const individualPaymentsSchema = z
  .object({
    request_key: z.string().uuid(),
    bank_account_id: z.string().uuid(),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}-01$/)
      .optional(),
    date: z.string().datetime({ offset: true }),
    note: z.string().max(2000),
    recipients: z
      .array(
        z.object({
          employee_id: z.string().uuid(),
          month: z
            .string()
            .regex(/^\d{4}-\d{2}-01$/)
            .optional(),
          amount: z
            .number()
            .positive()
            .max(1e9)
            .refine(
              (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
              "Не больше двух знаков после запятой",
            ),
        }),
      )
      .min(1)
      .max(500),
  })
  .refine(
    (value) => value.recipients.every((r) => r.month || value.month),
    "Укажите месяц расчёта для каждого сотрудника",
  );
export async function recordIndividualPayments(input: unknown) {
  const s = await scope("payroll.pay"),
    p = individualPaymentsSchema.parse(input);
  const result = await s.db.rpc("payroll_record_payments", { p_input: p });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export async function reconcileTips(
  date: string,
  bankId: string,
  categoryId: string,
  reason = "",
) {
  const s = await scope("payroll.pay");
  z.string().uuid().parse(bankId);
  z.string().uuid().parse(categoryId);
  if (!validDate(date)) throw new Error("Некорректный день");
  const d = await loadPayroll();
  const accruals = d.accruals.filter(
      (a) => a.business_date === date && a.tips > 0,
    ),
    cash = d.cashbox.filter(
      (c) => c.business_date === date && ["review", "ready"].includes(c.state),
    );
  if (!d.settings || !cash.length) throw new Error("Нет инкассации чаевых");
  if (
    d.sources.find((x) => x.business_date === date)?.state !== "complete" ||
    d.attendance.some(
      (a) =>
        a.business_date === date &&
        !["confirmed", "ignored"].includes(a.status),
    )
  )
    throw new Error("Сначала проверьте состав команды");
  const totalCash = cash.reduce((sum, c) => sum + Number(c.amount), 0),
    match = tipMatch(accruals, totalCash, Number(d.settings.tip_tolerance));
  if (
    (!match.matches || cash.some((c) => c.recognition === "ambiguous")) &&
    reason.trim().length < 3
  )
    throw new Error("Расхождение требует подтверждения с причиной");
  if (!accruals.length || accruals.some((a) => a.issues.length))
    throw new Error("Начисления ещё не проверены");
  if (
    d.payments.some(
      (p) =>
        p.kind === "tips" &&
        p.state === "posted" &&
        d.allocations.some(
          (a) =>
            a.payment_id === p.id &&
            accruals.some((c) => c.id === a.accrual_id),
        ),
    )
  )
    throw new Error(
      "Чаевые за этот день уже учтены; дополнительную инкассацию нужно сверить отдельно",
    );
  // One database transaction posts all withdrawals for the day. The final withdrawal
  // carries the daily rounding difference so the tolerance is never applied per receipt.
  const batch = tipBatch(
    date,
    accruals,
    cash,
    () => bankId,
    categoryId,
    reason,
  );
  const r = await s.db.rpc("payroll_post_tip_batch", {
    p_input: { date, payments: batch, reason },
  });
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
export async function cancelPayrollPayment(paymentId: string) {
  const s = await scope("payroll.pay");
  z.string().uuid().parse(paymentId);
  const r = await s.db.rpc("payroll_cancel_payment", { p_id: paymentId });
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export async function confirmLegacyPayment(
  id: string,
  bankId: string,
  categoryId: string,
) {
  const s = await scope("payroll.pay");
  if (!s.permissions.includes("payroll.approve"))
    throw new Error("Нет доступа к подтверждению истории");
  for (const value of [id, bankId, categoryId]) z.string().uuid().parse(value);
  const r = await s.db
    .from<import("@/lib/payroll/types").LegacyPayment>(
      "payroll_legacy_payments",
    )
    .select("*")
    .eq("id", id)
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .single();
  if (r.error || !r.data) throw new Error("Запись недоступна");
  const p = r.data;
  const posted = await s.db.rpc("payroll_post_payment", {
    p_input: {
      request_key: p.id,
      legacy_evidence_id: p.id,
      kind: p.kind,
      amount: Number(p.amount),
      bank_account_id: bankId,
      category_id: categoryId,
      date: p.occurred_at,
      note: `Подтверждённая выплата за ${p.month.slice(0, 7)}`,
      allocations: [
        {
          employee_id: p.employee_id,
          month: p.month,
          amount: Number(p.amount),
          settled_amount: Number(p.amount),
        },
      ],
    },
  });
  if (posted.error) throw new Error(posted.error.message);
  return posted.data;
}

// Rule configuration is independent of access to employees' earnings and payments.
export async function loadPayrollRules(): Promise<PayrollData> {
  const s = await scope("payroll.configure");
  const results = await Promise.all([
    s.admin
      .from<PayrollData["models"]>("payroll_models")
      .select("*")
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId),
    s.admin
      .from<PayrollData["rules"]>("payroll_rule_versions")
      .select("*")
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId),
    s.admin
      .from<PayrollData["employees"]>("payroll_employees")
      .select(
        "id,account_id,venue_id,quickresto_id,name,local_user_id,role_id,role_name,model_id,hired_on,experience_offset_months,active",
      )
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId),
    s.admin
      .from<PaySettings>("payroll_settings")
      .select("*")
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId)
      .maybeSingle(),
    s.admin
      .from<{ kkm_id: number }[]>("payroll_cashbox")
      .select("kkm_id")
      .eq("account_id", s.accountId)
      .eq("venue_id", s.venueId),
    s.db
      .from<PayrollData["banks"]>("bank_accounts")
      .select("id,name,legal_entity_id")
      .eq("account_id", s.accountId)
      .eq("is_active", true),
    s.db
      .from<PayrollData["categories"]>("finance_categories")
      .select("id,name")
      .eq("account_id", s.accountId)
      .eq("type", "expense")
      .is("archived_at", null),
    s.admin
      .from<{ user_id: string }[]>("user_venue_roles")
      .select("user_id")
      .eq("venue_id", s.venueId)
      .eq("status", "active")
      .is("fired_at", null),
  ]);
  for (const r of results) if (r.error) throw new Error(r.error.message);
  const members = results[7].data ?? [];
  let staff: PayrollData["staff"] = [];
  if (members.length) {
    const profiles = await s.admin
      .from<
        { id: string; first_name: string | null; last_name: string | null }[]
      >("profiles")
      .select("id,first_name,last_name")
      .in(
        "id",
        members.map((m) => m.user_id),
      );
    if (profiles.error) throw new Error(profiles.error.message);
    staff = (profiles.data ?? []).map((p) => ({
      user_id: p.id,
      name: `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(),
    }));
  }
  const roleRows = await s.client.from("roles").select("id,name").eq("venue_id",s.venueId).is("archived_at",null);
  if(roleRows.error) throw new Error(roleRows.error.message);
  return {
    roles: roleRows.data ?? [],
    venueId: s.venueId,
    timezone: "Europe/Moscow",
    dayStartHour: 9,
    scheduleReviews: [],
    userId: s.user.id,
    permissions: s.permissions,
    models: results[0].data ?? [],
    rules: results[1].data ?? [],
    employees: (results[2].data ?? []).map((e) => ({
      ...e,
      role_name:roleRows.data?.find(r=>r.id===e.role_id)?.name??e.role_name,
      opening_balance: 0,
      opening_confirmed: false,
    })),
    settings: results[3].data,
    staff,
    banks: results[5].data ?? [],
    categories: results[6].data ?? [],
    cashbox: [...new Set((results[4].data ?? []).map((c) => c.kkm_id))].map(
      (kkm_id) => ({ kkm_id }) as PayrollData["cashbox"][number],
    ),
    assignments: [],
    salaryLinks: [],
    attendance: [],
    accruals: [],
    transfers: [],
    adjustments: [],
    periods: [],
    payments: [],
    legacyPayments: [],
    allocations: [],
    sources: [],
    events: [],
    plannedShifts: [],
  };
}

export async function transferPayroll(input: Record<string, unknown>) {
  const s = await scope("payroll.review");
  const result = await s.db.rpc("payroll_transfer", { p_input: input });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export async function cancelPayrollTransfer(id: string) {
  const s = await scope("payroll.review");
  const result = await s.db.rpc("payroll_cancel_transfer", { p_id: id });
  if (result.error) throw new Error(result.error.message);
}

export async function loadPayrollTransactionDetails(id: string) {
  z.string().uuid().parse(id);
  const s = await scope("payroll.view");
  const result = await s.client
    .from("transactions")
    .select(
      "id,public_id,date,amount,currency,description,bank_account_id,category_id,deleted_at",
    )
    .eq("id", id)
    .eq("account_id", s.accountId)
    .eq("venue_id", s.venueId)
    .eq("type", "expense")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("Транзакция недоступна");
  const tx = result.data;
  const [bank, category] = await Promise.all([
    s.client
      .from("bank_accounts")
      .select("name")
      .eq("id", tx.bank_account_id)
      .eq("account_id", s.accountId)
      .maybeSingle(),
    tx.category_id
      ? s.client
          .from("finance_categories")
          .select("name")
          .eq("id", tx.category_id)
          .eq("account_id", s.accountId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (bank.error || category.error)
    throw new Error(bank.error?.message ?? category.error?.message);
  return {
    ...tx,
    bankName: bank.data?.name ?? "Счёт недоступен",
    categoryName: category.data?.name ?? "Без статьи",
  };
}

async function queueChangedConditions(s:Awaited<ReturnType<typeof scope>>,from:string) {
 const [days,periods]=await Promise.all([
 s.admin.from<{business_date:string}[]>("payroll_source_days").select("business_date").eq("account_id",s.accountId).eq("venue_id",s.venueId).eq("state","complete"),
 s.admin.from<{month:string;status:string}[]>("payroll_periods").select("month,status").eq("account_id",s.accountId).eq("venue_id",s.venueId)]);
 if(days.error||periods.error) throw new Error("Условия сохранены. Не удалось запланировать пересчёт: обновите период вручную.");
 await queuePayroll(s.accountId,s.venueId,(days.data??[]).filter(d=>d.business_date>=from&&!(periods.data??[]).some(p=>p.status!=="draft"&&p.month.slice(0,7)===d.business_date.slice(0,7))).map(d=>d.business_date));
}
export async function saveRoleCompensation(roleId:string,input:Record<string,unknown>,expectedRuleId:string|null) {
 const s=await scope("payroll.configure");
 if(!validDate(String(input.valid_from))) throw new Error("Укажите дату начала действия");
 validateRates(input.rates as Rates);
 const result=await s.db.rpc("payroll_save_role_rule",{p_role_id:roleId,p_input:input,p_expected_rule_id:expectedRuleId});
 if(result.error) throw new Error(result.error.message);
 await queueChangedConditions(s,String(input.valid_from));
 return result.data;
}
export async function assignPayrollPosition(employeeId:string,roleId:string,from:string) {
 const data=await assignPayrollPositionOnly(employeeId,roleId,from);
 await requeuePayrollFrom(from);
 return data;
}
/** Только запись должности (RPC) без постановки пересчёта: вызывающий сам решает, что делать при сбое очереди. */
export async function assignPayrollPositionOnly(employeeId:string,roleId:string,from:string) {
 const s=await scope("payroll.configure");
 if(!validDate(from)) throw new Error("Укажите дату начала действия");
 const result=await s.db.rpc("payroll_assign_position",{p_employee_id:employeeId,p_role_id:roleId,p_valid_from:from});
 if(result.error) throw new Error(result.error.message);
 return result.data;
}
export async function requeuePayrollFrom(from:string) {
 const s=await scope("payroll.configure");
 await queueChangedConditions(s,from);
}

export async function setPayrollAttendanceSource(employeeId:string,source:"quickresto"|"schedule"|"excluded",from:string,reason:string,expectedRuleId:string|null) {
 const s=await scope("payroll.configure");
 if(!validDate(from))throw new Error("Укажите дату начала действия");
 const result=await s.db.rpc("payroll_set_attendance_source",{p_employee_id:employeeId,p_source:source,p_valid_from:from,p_reason:reason,p_expected_rule_id:expectedRuleId});
 if(result.error)throw new Error(result.error.message);
 await queueChangedConditions(s,from);
 return result.data;
}
