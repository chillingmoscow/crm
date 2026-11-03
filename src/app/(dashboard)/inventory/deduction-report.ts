import "server-only";

// Данные сличающего отчёта по удержанию за недостачу. ТОЛЬКО ЧТЕНИЕ.
//
// Не "use server": это модуль для серверной страницы, из браузера он недоступен.
// Ничего не пишет и не ставит строк в ведомость. Единственный путь записи остаётся прежним -
// server action recalculateInventoryDeduction (_actions/deduction.ts), его вызывает кнопка
// пересчёта на странице.
//
// Сторона Sheerly - расчёт месяца, выполненный прямо сейчас (buildMonthlySnapshot +
// allocateMonthlyShortage), с отметкой момента расчёта. Рядом - то, что последний раз
// записано в ведомость (inventory_deduction_snapshots), чтобы было видно, не ушёл ли расчёт
// вперёд записанного. Проверки те же, что у пересчёта: аккаунт сессии, заведение в аккаунте,
// право ставить удержания в этом заведении.

import { createAdminClient } from "@/lib/supabase/admin";
import { asLooseDb } from "@/lib/supabase/loose";
import { assertVenueInAccount } from "@/lib/stock/deduction-guard";
import { buildDeductionLines, monthLabel } from "@/lib/stock/deduction-posting";
import { allocateMonthlyShortage } from "@/lib/stock/monthly-shortage";
import { buildMonthlySnapshot } from "@/lib/stock/monthly-snapshot";
import { groupMissing, documentItem, type MissingGroup, type MissingItem } from "@/lib/stock/deduction-missing";
import { stockCalendarDate } from "@/lib/stock/writeoffs";
import { actionErrorMessage, getActiveContext } from "./actions-shared";

export type ReportEmployee = { id: string; name: string; active: boolean };

export type ReportRecorded = {
  /** Момент расчёта, который лёг в ведомость. */
  capturedAt: string;
  employeesTotal: number;
  shortageTotal: number;
  reversed: boolean;
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
  recorded: ReportRecorded | null;
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
    const ctx = await getActiveContext();
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
    const can = await asLooseDb(ctx.supabase).rpc("can_post_inventory_deduction", { p_venue: venueId });
    if (can.error || can.data !== true)
      return {
        ok: false,
        error: "Нет доступа к удержаниям по недостаче в этом заведении. Обратитесь к владельцу аккаунта.",
        forbidden: true,
      };

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
    const docIds = new Set<string>([
      ...snapshot.dataProblems.undatedActs,
      ...snapshot.dataProblems.actsWithoutVenue,
      ...alloc.unresolved.filter((r) => r.startsWith("inventory:")).map((r) => r.slice("inventory:".length)),
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
      { title: "Акты без бизнес-даты: ни к какому месяцу не отнести", ids: snapshot.dataProblems.undatedActs },
      { title: "Акты без заведения: склад не привязан, ни в чьих пулах не учтены", ids: snapshot.dataProblems.actsWithoutVenue },
    ]
      .filter((p) => p.ids.length > 0)
      .map((p) => ({ title: p.title, items: p.ids.map((id) => documentItem(id, lookup)) }));

    let recorded: ReportRecorded | null = null;
    if (recordedRow.data) {
      const r = recordedRow.data;
      const [recordedRule, author] = await Promise.all([
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
      ]);
      const authorName = [author.data?.first_name, author.data?.last_name].filter(Boolean).join(" ");
      recorded = {
        capturedAt: r.captured_at,
        employeesTotal: Number(r.employees_total),
        shortageTotal: Number(r.shortage_total),
        reversed: r.reversed_at !== null,
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
      },
    };
  } catch (error) {
    return { ok: false, error: actionErrorMessage(error, "Не удалось построить отчёт") };
  }
}
