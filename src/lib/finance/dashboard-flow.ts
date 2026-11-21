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

  const share = (amount: number) => (expense > 0 ? amount / expense : 0);
  const all = [...buckets.entries()]
    .map(([category_id, b]) => ({ category_id, amount: b.amount, count: b.count, share: share(b.amount) }))
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

  return {
    summary: { income, expense, net: income - expense, incomeCount, expenseCount },
    top,
    rest,
  };
}
