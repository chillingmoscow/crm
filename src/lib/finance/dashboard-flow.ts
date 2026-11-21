/**
 * Сводка денежного потока за период: доходы, расходы и расходы по статьям.
 * Чистая функция над строками операций — без Supabase, чтобы её можно было
 * проверить тестом.
 */

export type FlowRow = {
  type: "income" | "expense" | "transfer";
  amount: number | string;
  category_id: string | null;
};

export type FlowSummary = {
  income: number;
  expense: number;
  /** Доходы минус расходы. Переводы в поток не входят. */
  net: number;
  incomeCount: number;
  expenseCount: number;
};

export type ExpenseCategoryShare = {
  /** `null` — операции без статьи. */
  category_id: string | null;
  amount: number;
  count: number;
  /** Доля от всех расходов периода, 0…1. */
  share: number;
};

export type FlowBreakdown = {
  summary: FlowSummary;
  /** Крупнейшие статьи расходов по убыванию суммы. */
  top: ExpenseCategoryShare[];
  /** Всё, что не вошло в `top`, одной строкой; `null`, если таких статей нет. */
  rest: { amount: number; count: number; categories: number; share: number } | null;
};

/** Расходы одной статьи за период — как их отдаёт база. */
export type ExpenseCategoryTotal = {
  category_id: string | null;
  amount: number;
  count: number;
};

/**
 * Разбивка по готовым итогам: доли от всех расходов, крупнейшие статьи и
 * хвост «Остальные». Итоги считает база (`finance_period_flow`), сюда
 * приходят уже суммы — без строк операций.
 */
export function buildFlowBreakdown(
  summary: FlowSummary,
  categories: ExpenseCategoryTotal[],
  topN = 5,
): FlowBreakdown {
  const { expense } = summary;
  const share = (amount: number) => (expense > 0 ? amount / expense : 0);
  const all = categories
    .map((c) => ({ category_id: c.category_id, amount: c.amount, count: c.count, share: share(c.amount) }))
    .sort((a, b) => b.amount - a.amount);
  // «Остальные · 1 статья» хуже, чем сама эта статья: одну лишнюю показываем.
  const top = all.slice(0, all.length === topN + 1 ? all.length : Math.max(0, topN));
  const tail = all.slice(top.length);
  const rest = tail.length
    ? tail.reduce(
        (acc, c) => ({
          amount: acc.amount + c.amount,
          count: acc.count + c.count,
          categories: acc.categories + 1,
          share: 0,
        }),
        { amount: 0, count: 0, categories: 0, share: 0 },
      )
    : null;
  if (rest) rest.share = share(rest.amount);

  return { summary, top, rest };
}

/** Та же разбивка по строкам операций. */
export function aggregateFlow(rows: FlowRow[], topN = 5): FlowBreakdown {
  let income = 0;
  let expense = 0;
  let incomeCount = 0;
  let expenseCount = 0;
  const buckets = new Map<string | null, { amount: number; count: number }>();

  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    if (row.type === "income") {
      income += amount;
      incomeCount += 1;
    } else if (row.type === "expense") {
      expense += amount;
      expenseCount += 1;
      const bucket = buckets.get(row.category_id) ?? { amount: 0, count: 0 };
      bucket.amount += amount;
      bucket.count += 1;
      buckets.set(row.category_id, bucket);
    }
  }

  return buildFlowBreakdown(
    { income, expense, net: income - expense, incomeCount, expenseCount },
    [...buckets.entries()].map(([category_id, b]) => ({ category_id, ...b })),
    topN,
  );
}

// ─── Ответ базы ─────────────────────────────────────────────────────────────

type DbTotals = {
  income?: unknown;
  expense?: unknown;
  income_count?: unknown;
  expense_count?: unknown;
};

/** Ответ `finance_period_flow` (миграция 376). */
export type PeriodFlowPayload = DbTotals & {
  categories?: { category_id?: unknown; amount?: unknown; count?: unknown }[] | null;
  elapsed?: DbTotals | null;
};

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function summaryOf(totals: DbTotals): FlowSummary {
  const income = num(totals.income);
  const expense = num(totals.expense);
  return {
    income,
    expense,
    net: income - expense,
    incomeCount: num(totals.income_count),
    expenseCount: num(totals.expense_count),
  };
}

/**
 * Разбор ответа `finance_period_flow`: итоги периода с разбивкой по статьям
 * и итоги по прошедшие дни (`elapsed`), если база их считала.
 */
export function parsePeriodFlow(
  payload: PeriodFlowPayload,
  topN = 5,
): { flow: FlowBreakdown; elapsed: FlowSummary | null } {
  const categories = (payload.categories ?? []).map((c) => ({
    category_id: typeof c.category_id === "string" ? c.category_id : null,
    amount: num(c.amount),
    count: num(c.count),
  }));
  return {
    flow: buildFlowBreakdown(summaryOf(payload), categories, topN),
    elapsed: payload.elapsed ? summaryOf(payload.elapsed) : null,
  };
}
