import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import {
  effectiveMetrics,
  salesSettingsColumns,
  type SalesDay,
  type SalesSettings,
} from "@/lib/sales/types";
import { businessDate, addDays } from "@/lib/sales/time";
import type { Shift } from "@/lib/schedule/types";
import type {
  PayEmployee,
  PayModel,
  PayRule,
  PaySettings,
  Attendance,
  Adjustment,
  Qualification,
  Accrual,
  Cashbox,
  PayAssignment,
} from "./types";
import { readPayrollDay, extraBonuses } from "./source";
import { reconcileAttendance, blocksPayrollAttendance, attendanceRuleAtDate } from "./attendance";
import {
  computeAccrual,
  hasShiftPay,
  mergeMonthlyAccrual,
  selectRule,
  effectivePayModel,
  employeeAtDate,
  recognizeTipComment,
  tipMatch,
  tipBatch,
} from "./calculate";
import { previewPayrollBonuses } from "./bonus-preview";
import { enqueueDay } from "@/lib/sales/sync";
const db = () => asLooseDb(createAdminClient());
export async function queuePayroll(
  accountId: string,
  venueId: string,
  dates: string[],
) {
  const admin = db();
  const { data: settings } = await admin
    .from<PaySettings>("payroll_settings")
    .select("*")
    .eq("account_id", accountId)
    .eq("venue_id", venueId)
    .single();
  if (!settings || !settings.enabled)
    throw new Error("Включите обработку зарплаты в настройках заведения");
  for (const date of dates) {
    if (date < settings.starts_on || (settings.historical_through && date <= settings.historical_through)) continue;
    const old = await admin
      .from<{ state: string }>("payroll_source_days")
      .select("state")
      .eq("venue_id", venueId)
      .eq("business_date", date)
      .maybeSingle();
    if (old.data?.state === "loading") continue;
    const { error } = await admin.from("payroll_source_days").upsert(
      {
        account_id: accountId,
        venue_id: venueId,
        business_date: date,
        state: "pending",
        error: null,
      },
      { onConflict: "venue_id,business_date" },
    );
    if (error) throw new Error(error.message);
  }
}
export async function processPayrollDay() {
  const admin = db(),
    claimed = await admin.rpc("payroll_claim_day");
  if (claimed.error) throw new Error(claimed.error.message);
  const job = claimed.data as {
    account_id: string;
    venue_id: string;
    date: string;
    lease_token: string;
  } | null;
  if (!job) return { idle: true };
  const { account_id: accountId, venue_id: venueId, date, lease_token } = job;
  try {
    const results = await Promise.all([
      admin
        .from<PaySettings>("payroll_settings")
        .select("*")
        .eq("venue_id", venueId)
        .single(),
      admin
        .from<SalesSettings>("sales_settings")
        .select(salesSettingsColumns)
        .eq("venue_id", venueId)
        .single(),
      admin
        .from<PayEmployee[]>("payroll_employees")
        .select("*")
        .eq("venue_id", venueId),
      admin
        .from<PayModel[]>("payroll_models")
        .select("*")
        .eq("venue_id", venueId),
      admin
        .from<PayRule[]>("payroll_rule_versions")
        .select("*")
        .eq("venue_id", venueId),
      admin
        .from<Shift[]>("schedule_shifts")
        .select("*")
        .eq("venue_id", venueId),
      admin
        .from<Attendance[]>("payroll_attendance")
        .select("*")
        .eq("venue_id", venueId)
        .eq("business_date", date),
      admin
        .from<Adjustment[]>("payroll_adjustments")
        .select("*")
        .eq("venue_id", venueId)
        .eq("business_date", date),
      admin
        .from<Qualification[]>("payroll_qualifications")
        .select("*")
        .eq("venue_id", venueId),
      admin
        .from<SalesDay>("sales_days")
        .select("*")
        .eq("venue_id", venueId)
        .eq("business_date", date)
        .maybeSingle(),
    ]);
    for (const r of results) if (r.error) throw new Error(r.error.message);
    const [
      settingsResult,
      salesResult,
      employeesResult,
      modelsResult,
      rulesResult,
      shiftsResult,
      priorResult,
      adjustmentsResult,
      qualificationsResult,
      dayResult,
    ] = results;
    const settings = settingsResult.data!,
      sales = salesResult.data!,
      employees = employeesResult.data ?? [],
      models = modelsResult.data ?? [],
      rules = rulesResult.data ?? [],
      shifts = shiftsResult.data ?? [],
      prior = priorResult.data ?? [],
      adjustments = (adjustmentsResult.data ?? []).filter(
        (a) => !a.deleted_at && (!a.medium || a.medium === "money"),
      ),
      qualifications = qualificationsResult.data ?? [],
      day = dayResult.data;
    const reviewsResult = await admin
      .from<import("./types").ScheduleReview[]>("payroll_schedule_reviews")
      .select("*")
      .eq("account_id", accountId)
      .eq("venue_id", venueId)
      .eq("business_date", date);
    if (reviewsResult.error) throw new Error(reviewsResult.error.message);
    const scheduleReviews = reviewsResult.data ?? [];
    const assignmentsResult = await admin
      .from<PayAssignment[]>("payroll_employee_models")
      .select("*")
      .eq("venue_id", venueId);
    if (assignmentsResult.error)
      throw new Error(assignmentsResult.error.message);
    for (let i = 0; i < employees.length; i++)
      employees[i] = employeeAtDate(
        employees[i],
        assignmentsResult.data ?? [],
        models,
        date,
      );
    const roleRows=await admin.from<{id:string;name:string}[]>("roles").select("id,name").eq("venue_id",venueId);
    if(roleRows.error) throw new Error(roleRows.error.message);
    const positionName=(modelId:string|null)=>roleRows.data?.find(r=>r.id===models.find(m=>m.id===modelId)?.role_id)?.name;
    const attendanceRules=await admin.from<import("./types").AttendanceRule[]>("payroll_attendance_rules").select("*").eq("account_id",accountId).eq("venue_id",venueId);
    if(attendanceRules.error) throw new Error(attendanceRules.error.message);
    for(const employee of employees) employee.attendance_source=attendanceRuleAtDate(attendanceRules.data??[],employee.id,date)?.source??"quickresto";
    const source = await readPayrollDay(
      settings,
      date,
      sales.timezone,
      sales.day_start_hour,
    );
    const linksResult = await admin
      .from<{ external_id: string; local_id: string }[]>(
        "external_entity_links",
      )
      .select("external_id,local_id")
      .eq("account_id", accountId)
      .eq("provider", "quickresto")
      .eq("entity_type", "staff");
    const membersResult = await admin
      .from<{ user_id: string }[]>("user_venue_roles")
      .select("user_id")
      .eq("venue_id", venueId)
      .eq("status", "active")
      .is("fired_at", null);
    if (linksResult.error || membersResult.error)
      throw new Error("Не удалось сопоставить сотрудников с графиком");
    for (const item of source.attendance) {
      const qrId = Number((item.owner as { id: number })?.id);
      if (!Number.isSafeInteger(qrId)) continue;
      let employee = employees.find((e) => Number(e.quickresto_id) === qrId);
      const userId = linksResult.data?.find(
          (l) => Number(l.external_id) === qrId,
        )?.local_id,
        linked =
          userId && membersResult.data?.some((m) => m.user_id === userId)
            ? userId
            : null;
      if (!employee) {
        const created = await admin
          .from<PayEmployee>("payroll_employees")
          .insert({
            account_id: accountId,
            venue_id: venueId,
            quickresto_id: qrId,
            name: String(
              (item.owner as { title?: string })?.title ??
                `Сотрудник Quick Resto №${qrId}`,
            ),
            local_user_id: linked,
            role_name: "Не назначена",
          })
          .select("*")
          .single();
        if (created.error || !created.data)
          throw new Error("Не удалось добавить нового участника смены");
        employee = created.data;
        employees.push(employee);
      } else if (!employee.local_user_id && linked) {
        const updated = await admin
          .from("payroll_employees")
          .update({ local_user_id: linked })
          .eq("id", employee.id)
          .eq("venue_id", venueId);
        if (updated.error) throw new Error("Не удалось связать график и факт");
        employee.local_user_id = linked;
      }
    }
    const rows = source.attendance.filter(r=>!employees.some(e=>e.attendance_source==="schedule"&&e.quickresto_id!==null&&e.quickresto_id===Number((r.owner as {id:number})?.id))).map((r) => ({
      id: Number(r.id),
      owner: { id: Number((r.owner as { id: number })?.id) },
      startTime: Number(r.startTime),
      endTime: r.endTime ? Number(r.endTime) : null,
    }));
    if (
      rows.some(
        (r) =>
          !Number.isSafeInteger(r.id) ||
          !Number.isFinite(r.startTime) ||
          !Number.isSafeInteger(r.owner.id),
      )
    )
      throw new Error("Некорректные отметки Quick Resto");
    const own = rows.filter(
      (r) =>
        businessDate(
          new Date(r.startTime),
          sales.timezone,
          sales.day_start_hour,
        ) === date,
    );
    const crossBoundary = rows.filter((r) => !own.includes(r));
    const checkedBoundary = crossBoundary.length
      ? await admin
          .from<Attendance[]>("payroll_attendance")
          .select("*")
          .eq("account_id", accountId)
          .eq("venue_id", venueId)
          .in(
            "external_id",
            crossBoundary.map((r) => r.id),
          )
      : { data: [] as Attendance[], error: null };
    if (checkedBoundary.error) throw new Error(checkedBoundary.error.message);
    const unresolvedBoundary = crossBoundary.filter(
      (r) =>
        !checkedBoundary.data?.some(
          (saved) =>
            saved.external_id === r.id &&
            saved.employee_id ===
              employees.find((e) => e.quickresto_id === r.owner.id)?.id &&
            saved.reviewed_by &&
            ["confirmed", "ignored"].includes(saved.status) &&
            Date.parse(saved.starts_at) === r.startTime &&
            (saved.ends_at ? Date.parse(saved.ends_at) : null) === r.endTime,
        ),
    );
    const reconciled = reconcileAttendance(
      own,
      employees,
      shifts,
      date,
      sales.timezone,
      sales.day_start_hour,
    );
    const unresolvedMissing = reconciled.missing.filter(
      ({ shift }) =>
        !scheduleReviews.some(
          (review) =>
            review.shift_id === shift.id &&
            review.snapshot.user_id === shift.user_id &&
            Date.parse(review.snapshot.starts_at) ===
              Date.parse(shift.starts_at) &&
            Date.parse(review.snapshot.ends_at) === Date.parse(shift.ends_at),
        ),
    );
    const attendance = reconciled.items.map((r) => {
      const old = prior.find((o) => o.external_id === r.external_id);
      return old?.reviewed_by &&
        old.employee_id === r.employee_id &&
        old.starts_at === r.starts_at &&
        old.ends_at === r.ends_at
        ? { ...r, status: old.status, reviewed_by: old.reviewed_by }
        : r;
    });
    const primaryEmployees = employees.map(e => ({...e}));
    const positionIssues = new Map<string,string>();
    // The planned duty changes shift earnings, never the primary monthly salary.
    for (let i = 0; i < employees.length; i++) {
      const planned = shifts.filter(
        (s) =>
          (s.payroll_employee_id === employees[i].id || Boolean(employees[i].local_user_id && s.user_id === employees[i].local_user_id)) &&
          s.published &&
          Date.parse(s.ends_at) <= Date.now() &&
          businessDate(
            new Date(s.starts_at),
            sales.timezone,
            sales.day_start_hour,
          ) === date,
      );
      const ids = [...new Set(planned.map((s) => s.payroll_model_id ?? (s.role_id ? models.find(m=>m.role_id===s.role_id && m.is_role_default)?.id ?? null : employees[i].model_id)))];
      if (ids.length > 1) positionIssues.set(employees[i].id,"За рабочий день указаны разные должности. Уточните должность смены");
      if (planned.length && ids.includes(null)) positionIssues.set(employees[i].id,"Для должности смены не настроена оплата");
      if (ids.length) {
        const modelId = ids.length === 1 ? (ids[0] ?? null) : null;
        const selectedModel = models.find((m) => m.id === modelId);
        employees[i] = {
          ...employees[i],
          model_id: modelId,
          role_name: selectedModel?.role_name ?? employees[i].role_name,
        };
      }
    }
    const present = [
      ...new Set(
        attendance
          .filter((r) => r.status !== "ignored" && r.employee_id)
          .map((r) => r.employee_id!),
      ),
    ].map((id) => employees.find((e) => e.id === id)!);
    const extras = extraBonuses(source.masters, source.bar),
      metrics = day ? effectiveMetrics(day) : {};
    if (!day) await enqueueDay(accountId, venueId, date);
    const benefits = settings.benefits_mode;
    const tipRecipients = present.filter(
      (e) =>
        effectivePayModel(
          models.find((m) => m.id === e.model_id) ?? null,
          selectRule(rules, e, date),
        )?.tips,
    ).length;
    const accruals: Record<string, unknown>[] = present
      .filter((e) => hasShiftPay(models.find((m) => m.id === e.model_id) ?? null, selectRule(rules,e,date)))
      .map((e) => {
        const rule = selectRule(rules, e, date),
          originalModel = effectivePayModel(
            models.find((m) => m.id === e.model_id) ?? null,
            rule,
          );
        const model = originalModel
          ? {
              ...originalModel,
              experience: benefits === "active" && originalModel.experience,
              knowledge_amount:
                benefits === "active" ? originalModel.knowledge_amount : 0,
            }
          : null;
        const employeeAttendance = attendance.filter(
          (a) => a.employee_id === e.id && a.status !== "ignored",
        );
        const attendanceIssues = employeeAttendance
          .filter(blocksPayrollAttendance)
          .map((a) => a.issue ?? "Проверьте выход");
        if (positionIssues.has(e.id)) attendanceIssues.push(positionIssues.get(e.id)!);
        if (unresolvedBoundary.length)
          attendanceIssues.push(
            "Персональная смена пересекает границу рабочего дня: проверьте состав команды",
          );
        if (attendance.some((a) => !a.employee_id))
          attendanceIssues.push(
            "Не все участники смены связаны с сотрудниками",
          );
        if (!day || day.status !== "complete")
          attendanceIssues.push("Финансовая смена ещё не завершена");
        if (
          benefits === "review" &&
          (originalModel?.experience || originalModel?.knowledge_amount)
        )
          attendanceIssues.push(
            "Надбавка за стаж требует подтверждения правил",
          );
        const result = computeAccrual({
          employee: e,
          model,
          rule,
          date,
          roleCount: present.filter((p) => p.role_name === e.role_name).length,
          tipRecipients,
          metrics: metrics as Record<string, number | null>,
          extra:
            e.role_name === "Мастер"
              ? extras.masters
              : e.role_name === "Бармен"
                ? extras.bar
                : 0,
          attendanceIssues,
          adjustments: adjustments.filter((a) => a.employee_id === e.id),
          qualification: qualifications
            .filter(
              (q) =>
                q.employee_id === e.id &&
                q.valid_from <= date &&
                (!q.valid_until || q.valid_until >= date),
            )
            .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0],
          cleanerPresent: present.some((p) => p.role_name === "Клиннер"),
        });
        return {
          employee_id: e.id,
          rule_version_id: rule?.id ?? null,
          ...result,
          status: result.issues.length ? "review" : "ready",
          calculation_snapshot: {
            role: e.role_name,
            position_name:positionName(e.model_id),
            model: originalModel,
            rule,
            financial_day_id: day?.id,
            financial_day_version: day?.version,
            extra: extras,
            source: employeeAttendance.some((a) => a.external_id < 0)
              ? "schedule"
              : "quickresto",
            schedule_shifts: shifts
              .filter((s) =>
                employeeAttendance.some((a) => a.shift_id === s.id),
              )
              .map((s) => ({
                id: s.id,
                version: s.version,
                model_id: s.payroll_model_id ?? null,
              })),
            attendance_ids: employeeAttendance.map((a) => a.external_id),
          },
        };
      });
    // Monthly salaries are accrued once, independently of POS attendance.
    for (const e of primaryEmployees.filter(
      (e) =>
        e.active &&
        (!e.hired_on || e.hired_on <= date) &&
        date === [`${date.slice(0, 7)}-01`, e.hired_on ?? "", settings.historical_through ? addDays(settings.historical_through, 1) : ""].sort().at(-1),
    )) {
      const rule = selectRule(rules, e, date);
      const model = effectivePayModel(models.find((m) => m.id === e.model_id) ?? null,rule);
      if (!model?.monthly_amount) continue;
      const existing = accruals.find(a=>a.employee_id===e.id);
      if (existing) {
        Object.assign(existing,mergeMonthlyAccrual(existing as unknown as Parameters<typeof mergeMonthlyAccrual>[0],model.monthly_amount,rule,date));
        continue;
      }
      const
        monthlyIssues = [
          ...(!rule ? ["Не задано действующее правило оклада"] : []),

        ],
        manual = adjustments.filter((a) => a.employee_id === e.id),
        approved = manual.filter((a) => a.approved);
      accruals.push({
        employee_id: e.id,
        rule_version_id: rule?.id ?? null,
        salary:
          Number(rule?.monthly_amount ?? model.monthly_amount) +
          approved.reduce((s, a) => s + Number(a.amount), 0),
        tips: 0,
        components: [
          {
            kind: "monthly",
            label: "Оклад за месяц",
            amount: Number(rule?.monthly_amount ?? model.monthly_amount),
            basis: date.slice(0, 7),
            source: "Индивидуальные условия оплаты",
          },
          ...approved.map((a) => ({
            kind: a.kind,
            label: a.reason,
            amount: Number(a.amount),
            basis: "Корректировка",
            source: a.source_ref ?? "Подтверждение управляющим",
          })),
        ],
        issues: [
          ...monthlyIssues,
          ...manual
            .filter((a) => !a.approved)
            .map((a) => `Не подтверждено: ${a.reason}`),
        ],
        status:
          monthlyIssues.length || manual.some((a) => !a.approved)
            ? "review"
            : "ready",
        calculation_snapshot: {
          kind: "monthly",
          model,
          rule,
          source: "sheerly",
          role: e.role_name,
          position_name:positionName(e.model_id),
          financial_day_id: undefined,
          financial_day_version: undefined,
          extra: extras,
          attendance_ids: [],
        },
      });
    }
    for (const e of employees) {
      if (accruals.some((a) => a.employee_id === e.id)) continue;
      const manual = adjustments.filter((a) => a.employee_id === e.id);
      if (!manual.length) continue;
      const approved = manual.filter((a) => a.approved),
        issues = manual
          .filter((a) => !a.approved)
          .map((a) => `Не подтверждено: ${a.reason}`);
      accruals.push({
        employee_id: e.id,
        rule_version_id: null,
        salary: approved.reduce((s, a) => s + Number(a.amount), 0),
        tips: 0,
        components: approved.map((a) => ({
          kind: a.kind,
          label: a.reason,
          amount: Number(a.amount),
          basis: "Отдельная корректировка",
          source: a.source_ref ?? "Подтверждение управляющим",
        })),
        issues,
        status: issues.length ? "review" : "ready",
        calculation_snapshot: { kind: "adjustment" },
      });
    }
    const cashbox = source.cashbox
      .filter((r) => r.typeTransaction === "cashOut" && Number(r.amount) > 0)
      .flatMap((r) => {
        const recognition = recognizeTipComment(
          String(r.comment ?? ""),
          settings.tip_comments,
        );
        if (!recognition) return [];
        return [
          {
            external_id: Number(r.id),
            amount: Number(r.amount),
            occurred_at: new Date(Number(r.timeEncashment)).toISOString(),
            comment: String(r.comment ?? ""),
            kkm_id: Number((r.kkm as { id: number })?.id),
            recognition,
          },
        ];
      });
    const committed = await admin.rpc("payroll_commit_day", {
      p_input: {
        account_id: accountId,
        venue_id: venueId,
        date,
        lease_token,
        attendance,
        accruals,
        cashbox,
        source: {
          attendance_count: own.length,
          schedule_attendance_count:attendance.filter(a=>a.external_id<0).length,
          missing_shifts: unresolvedMissing.map((m) => m.shift.id),
          cross_boundary_ids: unresolvedBoundary.map((r) => r.id),
          cashbox_count: source.cashbox.length,
          extras,
          timeZone: source.timeZone,
          window: source.window,
        },
      },
    });
    if (committed.error) throw new Error(committed.error.message);
    // A balance read failure leaves bonus fines visibly on review; it does not fail a valid salary day.
    try {
      await previewPayrollBonuses(accountId, venueId);
    } catch {
      /* retry on the next completed day */
    }
    // Verified QR withdrawals are accounting evidence. Only configured cash accounts
    // and fully reviewed participants allow automatic financial posting.
    if (settings.tip_category_id) {
      const a = await admin
        .from<Accrual[]>("payroll_accruals")
        .select("*")
        .eq("venue_id", venueId)
        .eq("business_date", date);
      const c = await admin
        .from<Cashbox[]>("payroll_cashbox")
        .select("*")
        .eq("venue_id", venueId)
        .eq("business_date", date);
      if (a.error || c.error)
        throw new Error("Не удалось проверить выдачу чаевых");
      const recipients = (a.data ?? []).filter((a) => a.tips > 0),
        cash = (c.data ?? []).filter((c) =>
          ["review", "ready"].includes(c.state),
        );
      if (
        cash.length &&
        !(c.data ?? []).some((c) =>
          ["posted", "cancelled"].includes(c.state),
        ) &&
        cash.every(
          (c) =>
            c.recognition === "exact" &&
            !c.source_error &&
            settings.cashbox_accounts[String(c.kkm_id)],
        ) &&
        tipMatch(
          recipients,
          cash.reduce((sum, c) => sum + Number(c.amount), 0),
          Number(settings.tip_tolerance),
        ).matches
      ) {
        const payments = tipBatch(
          date,
          recipients,
          cash,
          (c) => settings.cashbox_accounts[String(c.kkm_id)],
          settings.tip_category_id,
        );
        const posted = await admin.rpc("payroll_auto_tips", {
          p_input: { account_id: accountId, venue_id: venueId, date, payments },
        });
        if (posted.error)
          throw new Error("Выдача чаевых требует сверки финансовых настроек");
      }
    }
    return { idle: false, date, employees: accruals.length };
  } catch (e) {
    if (e instanceof Error && /429|частот|rate.limit/i.test(e.message)) {
      const retryAt = new Date(Date.now() + 60000).toISOString();
      await admin
        .from("sales_settings")
        .update({ provider_retry_at: retryAt })
        .eq("venue_id", venueId)
        .eq("account_id", accountId);
      await admin
        .from("payroll_source_days")
        .update({
          state: "pending",
          error:
            "Quick Resto ограничил частоту запросов. Продолжим автоматически.",
        })
        .eq("venue_id", venueId)
        .eq("business_date", date)
        .eq("lease_token", lease_token);
      return {
        idle: false,
        date,
        error: "Ожидаем разрешения Quick Resto на следующий запрос",
      };
    }
    const reason =
      e instanceof Error && /^Quick Resto.*(403|401)/.test(e.message)
        ? "Нет доступа интеграционной учётки Quick Resto"
        : e instanceof Error && !/Ответ:|Bearer|Basic/i.test(e.message)
          ? e.message.slice(0, 240)
          : "Не удалось прочитать источник зарплаты";
    await admin
      .from("payroll_source_days")
      .update({
        state: "error",
        error: reason,
        synced_at: new Date().toISOString(),
      })
      .eq("venue_id", venueId)
      .eq("business_date", date)
      .eq("lease_token", lease_token);
    return { idle: false, date, error: reason };
  }
}
export async function schedulePayroll() {
  const admin = db();
  const { data: settings } = await admin
    .from<(PaySettings & { sales_settings?: SalesSettings })[]>(
      "payroll_settings",
    )
    .select("*")
    .eq("enabled", true);
  for (const s of settings ?? []) {
    const { data: sales } = await admin
      .from<SalesSettings>("sales_settings")
      .select(salesSettingsColumns)
      .eq("venue_id", s.venue_id)
      .single();
    if (!sales) continue;
    const today = businessDate(
      new Date(),
      sales.timezone,
      sales.day_start_hour,
    );
    const existing = await admin
      .from<{ business_date: string }[]>("payroll_source_days")
      .select("business_date")
      .eq("venue_id", s.venue_id)
      .eq("account_id", s.account_id)
      .or(`business_date.gte.${today.slice(0, 7)}-01`);
    if (existing.error) throw new Error(existing.error.message);
    const known = new Set((existing.data ?? []).map((d) => d.business_date)),
      missing: string[] = [];
    for (
      let date = `${today.slice(0, 7)}-01`;
      date <= today;
      date = addDays(date, 1)
    )
      if (date >= s.starts_on && !known.has(date)) missing.push(date);
    if (missing.length) await queuePayroll(s.account_id, s.venue_id, missing);
    for (const date of [today, addDays(today, -1)]) {
      if (date < s.starts_on) continue;
      const row = await admin
        .from<{
          state: string;
          synced_at: string | null;
        }>("payroll_source_days")
        .select("state,synced_at")
        .eq("venue_id", s.venue_id)
        .eq("business_date", date)
        .maybeSingle();
      if (row.data?.state === "loading" || row.data?.state === "pending")
        continue;
      const age = row.data?.synced_at
        ? Date.now() - Date.parse(row.data.synced_at)
        : Infinity;
      if (age > (date === today ? 15 * 60000 : 60 * 60000))
        await queuePayroll(s.account_id, s.venue_id, [date]);
    }
  }
}
