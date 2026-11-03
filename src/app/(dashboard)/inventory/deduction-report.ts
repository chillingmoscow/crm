import "server-only";

// Данные сличающего отчёта по удержанию за недостачу. ТОЛЬКО ЧТЕНИЕ.
//
// Не "use server": это модуль для серверной страницы, из браузера он недоступен.
// Ничего не пишет и не ставит строк в ведомость. Единственный путь записи остаётся прежним -
// server action recalculateInventoryDeduction (_actions/deduction.ts), его вызывает кнопка
// пересчёта на странице.
//
// Две стороны Sheerly. «Записано» - то, что реально стоит в ведомости: живые строки
// payroll_adjustments, поставленные снимком месяца (inventory_deduction_snapshots); именно
// это число платили, поэтому сличение идёт с ним. «Расчёт сейчас» - расчёт месяца прямо
// сейчас (buildMonthlySnapshot + allocateMonthlyShortage); разрыв между ними означает, что
// исходные данные поменяли после постановки. Оба с отметкой момента.
//
// Просмотр требует inventory.view_results И payroll.view (суммы по людям - зарплатные данные;
// страница читает их серверным клиентом мимо RLS, поэтому право проверяется здесь) и права ставить не даёт: право ставить удержания
// (can_post_inventory_deduction) нужно только кнопке пересчёта, страница лишь сообщает,
// есть ли оно. Остальные проверки: аккаунт сессии, заведение в аккаунте.

import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { assertVenueInAccount } from "@/lib/stock/deduction-guard";
import { buildDeductionLines, monthLabel } from "@/lib/stock/deduction-posting";
import { allocateMonthlyShortage } from "@/lib/stock/monthly-shortage";
import { buildMonthlySnapshot } from "@/lib/stock/monthly-snapshot";
import { groupMissing, documentItem, bareDocumentId, type MissingGroup, type MissingItem } from "@/lib/stock/deduction-missing";
import { stockCalendarDate } from "@/lib/stock/writeoffs";
import { actionErrorMessage, getActiveContext } from "./actions-shared";

export type ReportEmployee = { id: string; name: string; active: boolean };

export type ReportRecorded = {
  /** Момент расчёта, который лёг в ведомость. */
  capturedAt: string;
  /** Сколько реально удержано с сотрудников: сумма живых строк ведомости. */
  employeesTotal: number;
  shortageTotal: number;
  /** Живые строки ведомости этого месяца по сотрудникам (положительные суммы). */
  lines: Array<{ employeeId: string; amount: number }>;
  ruleVersion: number | null;
  ruleValidFrom: string | null;
  authorName: string | null;
};

export type DeductionReportData = {
  venueId: string;
  timezone: string;
  /** Первое число месяца, `YYYY-MM-01`. */
  month: string;
  /** «октябрь 2026». */
  monthLabel: string;
  /** Предыдущий и текущий месяц заведения: границы выбора. */
  currentMonth: string;
  calc: {
    state: "ready" | "incomplete" | "disabled";
    /** Момент, когда расчёт Sheerly снят. */
    capturedAt: string;
    ruleVersion: number | null;
    ruleValidFrom: string | null;
    shortageTotal: number;
    companyTotal: number;
    employeesTotal: number;
    lines: Array<{ employeeId: string; amount: number }>;
    missing: MissingGroup[];
    dataProblems: Array<{ title: string; items: MissingItem[] }>;
  };
  employees: ReportEmployee[];
  /** Расчёт, поставленный в ведомость; `null`, если месяц не поставлен или сторнирован. */
  recorded: ReportRecorded | null;
  /** Месяц ставили, но потом сторнировали без замены: в ведомости ничего нет. */
  recordedReversedAt: string | null;
  /** Есть право ставить удержания: только от него зависит кнопка пересчёта. */
  canRecalculate: boolean;
};

export type DeductionReportResult =
  | { ok: true; data: DeductionReportData }
  | { ok: false; error: string; forbidden?: boolean };

const MONTH_RE = /^\d{4}-\d{2}-01$/;

function previousMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function loadDeductionReport(requestedMonth: string | null): Promise<DeductionReportResult> {
  try {
    // Суммы по сотрудникам - зарплатные данные, а читаются серверным клиентом в обход RLS, поэтому
    // нужны оба права: итоги склада и payroll.view (то же право, что просит RLS таблицы снимков).
    const ctx = await getActiveContext(["inventory.view_results", "payroll.view"]);
    if (ctx.error === "Недостаточно прав")
      return { ok: false, error: "Нет доступа к отчёту об удержаниях. Обратитесь к владельцу аккаунта.", forbidden: true };
    if (ctx.error || !ctx.user || !ctx.accountId) return { ok: false, error: ctx.error ?? "Не авторизован" };
    if (!ctx.venueId) return { ok: false, error: "Не выбрано заведение" };
    const accountId = ctx.accountId;
    const venueId = ctx.venueId;

    const admin = asLooseDb(createAdminClient());
    try {
      await assertVenueInAccount(admin, accountId, venueId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Заведение недоступно", forbidden: true };
    }
    // Право ставить удержания нужно только кнопке пересчёта; просмотр его не требует.
    const can = await asLooseDb(ctx.supabase).rpc("can_post_inventory_deduction", { p_venue: venueId });
    const canRecalculate = !can.error && can.data === true;

    const venue = await admin
      .from<{ timezone: string | null }>("venues")
      .select("timezone")
      .eq("id", venueId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (venue.error || !venue.data?.timezone) return { ok: false, error: "У заведения не задана таймзона" };
    const timezone = venue.data.timezone;
    const today = stockCalendarDate(new Date().toISOString(), timezone);
    const currentMonth = `${today.slice(0, 7)}-01`;
    const month =
      requestedMonth && MONTH_RE.test(requestedMonth) && requestedMonth <= currentMonth
        ? requestedMonth
        : previousMonth(today);

    const snapshot = await buildMonthlySnapshot(admin, { accountId, venueId, month });
    const alloc = allocateMonthlyShortage(snapshot);
    const lines =
      alloc.state === "ready"
        ? buildDeductionLines(alloc.pools).map((l) => ({ employeeId: l.employeeId, amount: l.amount }))
        : [];

    const [employeeRows, ruleRow, recordedRow] = await Promise.all([
      admin
        .from<Array<{ id: string; name: string; active: boolean }>>("payroll_employees")
        .select("id, name, active")
        .eq("account_id", accountId)
        .eq("venue_id", venueId)
        .order("name", { ascending: true })
        .limit(2000),
      admin
        .from<{ version: number; valid_from: string }>("stock_deduction_rules")
        .select("version, valid_from")
        .eq("id", snapshot.ruleVersionId)
        .eq("account_id", accountId)
        .maybeSingle(),
      admin
        .from<{
          captured_at: string;
          employees_total: number | string;
          shortage_total: number | string;
          reversed_at: string | null;
          rule_version_id: string;
          created_by: string;
        }>("inventory_deduction_snapshots")
        .select("captured_at, employees_total, shortage_total, reversed_at, rule_version_id, created_by")
        .eq("account_id", accountId)
        .eq("venue_id", venueId)
        .eq("month", month)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (employeeRows.error) throw new Error(`Не удалось прочитать сотрудников: ${employeeRows.error.message}`);
    if (recordedRow.error) throw new Error(`Не удалось прочитать записанный расчёт: ${recordedRow.error.message}`);
    const employees: ReportEmployee[] = employeeRows.data ?? [];

    // Названия актов для перечня «чего не хватает».
    // Снимок отдаёт акты с префиксом; в фильтр по documents.id и в documentItem
    // идёт голый id, иначе запрос падает на неверном UUID и отчёт не грузится.
    const undatedDocIds = snapshot.dataProblems.undatedActs.map(bareDocumentId);
    const docIds = new Set<string>([
      ...undatedDocIds,
      ...alloc.unresolved.filter((r) => r.startsWith("inventory:")).map(bareDocumentId),
    ]);
    const docRows =
      docIds.size === 0
        ? { data: [] as Array<{ id: string; document_number: string | null; invoice_date: string | null }>, error: null }
        : await admin
            .from<Array<{ id: string; document_number: string | null; invoice_date: string | null }>>("documents")
            .select("id, document_number, invoice_date")
            .eq("account_id", accountId)
            .in("id", [...docIds]);
    if (docRows.error) throw new Error(`Не удалось прочитать акты: ${docRows.error.message}`);
    const lookup = {
      documents: new Map(
        (docRows.data ?? []).map((d) => [d.id, { number: d.document_number, date: d.invoice_date }] as const),
      ),
      employees: new Map(employees.map((e) => [e.id, e.name] as const)),
    };

    const dataProblems = [
      { title: "Акты без бизнес-даты: ни к какому месяцу не отнести", ids: undatedDocIds },
    ]
      .filter((p) => p.ids.length > 0)
      .map((p) => ({ title: p.title, items: p.ids.map((id) => documentItem(id, lookup)) }));

    let recorded: ReportRecorded | null = null;
    let recordedReversedAt: string | null = null;
    if (recordedRow.data && recordedRow.data.reversed_at) recordedReversedAt = recordedRow.data.reversed_at;
    else if (recordedRow.data) {
      const r = recordedRow.data;
      const [recordedRule, author, snapshotIds] = await Promise.all([
        admin
          .from<{ version: number; valid_from: string }>("stock_deduction_rules")
          .select("version, valid_from")
          .eq("id", r.rule_version_id)
          .eq("account_id", accountId)
          .maybeSingle(),
        admin
          .from<{ first_name: string | null; last_name: string | null }>("profiles")
          .select("first_name, last_name")
          .eq("id", r.created_by)
          .maybeSingle(),
        admin
          .from<Array<{ id: string }>>("inventory_deduction_snapshots")
          .select("id")
          .eq("account_id", accountId)
          .eq("venue_id", venueId)
          .eq("month", month),
      ]);
      if (snapshotIds.error) throw new Error(`Не удалось прочитать снимки месяца: ${snapshotIds.error.message}`);
      // Что реально стоит в ведомости: живые строки всех снимков месяца. Снимок, совпавший с уже
      // поставленным, новых строк не пишет, поэтому смотреть только на последний снимок нельзя.
      const live = await admin
        .from<Array<{ employee_id: string; amount: number | string }>>("payroll_adjustments")
        .select("employee_id, amount")
        .eq("account_id", accountId)
        .eq("venue_id", venueId)
        .eq("origin", "inventory_deduction")
        .is("deleted_at", null)
        .in("inventory_snapshot_id", (snapshotIds.data ?? []).map((x) => x.id));
      if (live.error) throw new Error(`Не удалось прочитать строки ведомости: ${live.error.message}`);
      const cents = new Map<string, number>();
      for (const row of live.data ?? [])
        cents.set(row.employee_id, (cents.get(row.employee_id) ?? 0) + Math.round(Math.abs(Number(row.amount)) * 100));
      const lines = [...cents.entries()]
        .map(([employeeId, c]) => ({ employeeId, amount: c / 100 }))
        .filter((l) => l.amount > 0);
      const authorName = [author.data?.first_name, author.data?.last_name].filter(Boolean).join(" ");
      recorded = {
        capturedAt: r.captured_at,
        employeesTotal: lines.reduce((sum, l) => sum + Math.round(l.amount * 100), 0) / 100,
        shortageTotal: Number(r.shortage_total),
        lines,
        ruleVersion: recordedRule.data?.version ?? null,
        ruleValidFrom: recordedRule.data?.valid_from ?? null,
        authorName: authorName || null,
      };
    }

    return {
      ok: true,
      data: {
        venueId,
        timezone,
        month,
        monthLabel: monthLabel(month),
        currentMonth,
        calc: {
          state: alloc.state,
          capturedAt: snapshot.capturedAt,
          ruleVersion: ruleRow.data?.version ?? null,
          ruleValidFrom: ruleRow.data?.valid_from ?? null,
          shortageTotal: alloc.total,
          companyTotal: alloc.company,
          employeesTotal: alloc.employees,
          lines,
          missing: alloc.state === "incomplete" ? groupMissing(alloc.unresolved, lookup) : [],
          dataProblems,
        },
        employees,
        recorded,
        recordedReversedAt,
        canRecalculate,
      },
    };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Не удалось построить отчёт") };
  }
}
